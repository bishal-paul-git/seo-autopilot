// Scans websites connected by address (D25). pg_cron (every 10 minutes) and the portal ("Add website", "Scan now") call
// it with the shared secret from Vault. It answers at once, then, in the background, claims due sites one at a time,
// crawls each with the product's own crawler and audit rules (src/hosted/scan.mjs, copied into ./lib by
// cloud/portal/build-scan.mjs) and stores the snapshot. Reads public pages only; writes only through the RPCs.
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
const BUDGET_MS = 100_000; // stop claiming new sites after this; the platform's own limit is 150 s on the free plan

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
  const started = Date.now();
  const work = (async () => {
    while (Date.now() - started < BUDGET_MS) {
      const site = await rpc("claim_scan").catch(() => null);
      if (!site) break;
      try {
        const { snapshot } = await scanSite(site, { maxPages: 60, concurrency: 6, ...google });
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
