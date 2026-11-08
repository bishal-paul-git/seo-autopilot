// Scans websites connected by address (D25). pg_cron (every 10 minutes) and the portal ("Add website", "Scan now") call
// it with the shared secret from Vault. It answers at once, then, in the background, claims due sites one at a time,
// crawls each with the product's own crawler and audit rules (src/hosted/scan.mjs, copied into ./lib by
// cloud/portal/build-scan.mjs) and stores the snapshot. Reads public pages only; writes only through the RPCs.
// Job mode (D30): the Cloudflare scheduler sends {"mode":"job","site":{...}} and gets the compact result back in the
// response, for one site. A full 60-page audit measured 0.8-1.6 s of CPU in Node, against a 2 s CPU limit per request,
// so every request scans ONE site (the older loop claimed several sites per request and could exceed the limit).
import { scanSite } from "./lib/hosted/scan.mjs";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

// Optional Google access for Search Console: the GOOGLE_KEY_JSON function secret (a service account the site owners add
// as a user in their Search Console). Signed with Web Crypto, so no Node compatibility is needed.
const b64u = (b: ArrayBuffer | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
async function googleTokenFrom(json: string) {
  const key = JSON.parse(json), now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64u(JSON.stringify({ iss: key.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: key.token_uri, iat: now, exp: now + 3600 }))}`;
  const der = Uint8Array.from(atob(String(key.private_key).replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, new TextEncoder().encode(unsigned));
  const r = await fetch(key.token_uri, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64u(sig)}` }) });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google token error");
  return j.access_token as string;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const MAX_PAGES = 40; // keeps a scan well inside the 2 s CPU limit (measured 13-27 ms CPU per page)
// What the Worker needs from a scan (onboarding facts, profile, a compact audit): small, so parsing it costs little CPU.
const compact = (r: any) => ({
  discovered: r.discovered, profile: { mode: r.profile?.mode ?? null, platform: r.profile?.platform?.name ? { name: r.profile.platform.name } : null, rendering: r.profile?.rendering ?? null, inRepository: false },
  audit: { generatedAt: r.audit?.generatedAt ?? new Date().toISOString(), summary: r.audit?.summary ?? {}, issues: (r.audit?.issues ?? []).slice(0, 200).map((i: any) => ({ rule: i.rule, severity: i.severity, url: i.url })), pages: [],
    crawled: (r.audit?.pages ?? []).map((p: any) => p.url).filter(Boolean).slice(0, 100) },
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "not configured" }, 500);
  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    const t = await r.text();
    if (!r.ok) throw new Error(`${fn}: HTTP ${r.status} ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  };
  const secret = req.headers.get("x-scan-secret") || "";
  if (!secret || !(await rpc("scan_secret_ok", { p_secret: secret }).catch(() => false))) return json({ error: "forbidden" }, 403);

  const gJson = Deno.env.get("GOOGLE_KEY_JSON");
  let gToken: Promise<string> | null = null;
  const google = gJson ? { googleEmail: JSON.parse(gJson).client_email as string, googleToken: () => (gToken ??= googleTokenFrom(gJson)) } : {};
  const body = await req.json().catch(() => ({}));
  if (body?.mode === "job") {
    // One site, answered in the response. The site comes from the jobs table through the Worker; the address is checked
    // again here by scanSite (public http(s) only, guarded fetch, robots.txt).
    const s = body.site || {};
    if (typeof s.id !== "string" || typeof s.url !== "string") return json({ error: "site.id and site.url required" }, 400);
    try {
      const r = await scanSite({ id: s.id, name: String(s.name || ""), url: s.url }, { maxPages: Math.min(Number(body.maxPages) || MAX_PAGES, MAX_PAGES), concurrency: 6, ...google });
      // The portal reads snapshots: store this one exactly as the scheduled path does, so the Worker can be the only scheduler.
      const stored = await rpc("finish_scan", { p_site: s.id, p_data: r.snapshot }).then(() => true).catch(() => false);
      return json({ ok: true, snapshotStored: stored, ...compact(r) });
    } catch (e) {
      return json({ ok: false, error: String((e as Error)?.message || e).slice(0, 300) }, 422);
    }
  }
  const work = (async () => {
    {
      const site = await rpc("claim_scan").catch(() => null);
      if (!site) return;
      try {
        const { snapshot } = await scanSite(site, { maxPages: MAX_PAGES, concurrency: 6, ...google });
        await rpc("finish_scan", { p_site: site.id, p_data: snapshot });
        console.log(`scan ok ${site.url} ${snapshot.audit?.pages ?? 0} pages`);
      } catch (e) {
        const msg = String((e as Error)?.message || e).slice(0, 300);
        console.log(`scan failed ${site.url}: ${msg}`);
        await rpc("finish_scan", { p_site: site.id, p_error: msg }).catch(() => {});
      }
    }
  })();
  EdgeRuntime.waitUntil(work);
  return json({ accepted: true });
});
