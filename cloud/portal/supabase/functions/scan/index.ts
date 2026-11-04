// Scans websites connected by address (D25). pg_cron (every 10 minutes) and the portal ("Add website", "Scan now") call
// it with the shared secret from Vault. It answers at once, then, in the background, claims due sites one at a time,
// crawls each with the product's own crawler and audit rules (src/hosted/scan.mjs, copied into ./lib by
// cloud/portal/build-scan.mjs) and stores the snapshot. Reads public pages only; writes only through the RPCs.
import { scanSite } from "./lib/hosted/scan.mjs";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
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

  const started = Date.now();
  const work = (async () => {
    while (Date.now() - started < BUDGET_MS) {
      const site = await rpc("claim_scan").catch(() => null);
      if (!site) break;
      try {
        const { snapshot } = await scanSite(site, { maxPages: 60, concurrency: 6 });
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
