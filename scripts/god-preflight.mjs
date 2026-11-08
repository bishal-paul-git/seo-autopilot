#!/usr/bin/env node
// Go-live preflight for the hosted SEO God (docs/cloudflare/README.md). Read-only: checks which setup steps are done
// and says what to do next for each one that is not. Sends the service key only to your own Supabase project.
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> [WORKER_URL=https://seo-god.<you>.workers.dev] \
//     node scripts/god-preflight.mjs
// Exit code 0 when every required check passes, 1 otherwise. Optional checks warn but do not fail.

/** Functions each migration adds (one representative per migration file, in order). */
export const MIGRATIONS = [
  ["20261104000000_portal_url_sites", "scan_secret_ok"],
  ["20261108000000_r1_contracts", "approve_job"],
  ["20261108010000_r1_memory", "remember"],
  ["20261108020000_r1_scheduler", "record_job_output"],
  ["20261108030000_cloudflare_execution", "god_paused"],
  ["20261108040000_agency_console", "god_console"],
  ["20261108050000_client_portal", "agency_inbox"],
  ["20261108060000_learning", "god_console"],
  ["20261108070000_operations", "platform_health"],
];

/** Runs every check. deps: { env, fetchImpl, now }. Returns [{ id, ok, required, detail, fix }]. */
export async function preflight({ env = process.env, fetchImpl = (...a) => fetch(...a), now = Date.now() } = {}) {
  const out = [];
  const add = (id, ok, detail, fix, required = true) => out.push({ id, ok: !!ok, required, detail, fix: ok ? null : fix });
  const url = String(env.SUPABASE_URL || "").replace(/\/$/, ""), key = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) { add("config", false, "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to check anything", "Export both (the service role key is in Supabase → Project Settings → API) and run again."); return out; }
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (path) => { const r = await fetchImpl(`${url}/rest/v1/${path}`, { headers: { ...h, Accept: "application/openapi+json" } }); return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }; };
  const rpc = async (fn, args = {}) => { const r = await fetchImpl(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify(args) }); const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch { b = t; } return { ok: r.ok, status: r.status, body: b }; };

  // 1. Migrations: the API's own description lists every function the service role can call.
  const api = await get("").catch(() => ({ ok: false }));
  if (!api.ok) { add("supabase", false, `Supabase API not reachable or key refused (HTTP ${api.status ?? "?"})`, "Check SUPABASE_URL and that the key is the service_role key."); return out; }
  const fns = new Set(Object.keys(api.body?.paths || {}).filter((p) => p.startsWith("/rpc/")).map((p) => p.slice(5)));
  const missing = MIGRATIONS.filter(([, fn]) => !fns.has(fn)).map(([m]) => m);
  add("migrations", !missing.length, missing.length ? `not applied: ${missing.join(", ")}` : `all ${MIGRATIONS.length} migrations applied`, "Apply the missing migrations in order (README step 2).");
  if (missing.length) return out;

  // 2. Scheduler switch and recent runs.
  const paused = await rpc("god_paused");
  add("pause-switch", paused.ok, paused.ok ? `database switch: ${paused.body ? "paused" : "running"}` : `god_paused failed (HTTP ${paused.status})`, "Re-apply 20261108030000_cloudflare_execution.sql.");
  const runs = await get("god_runs?select=started_at,paused,errors&order=started_at.desc&limit=1");
  const last = runs.ok && runs.body?.[0];
  const age = last ? Math.round((now - Date.parse(last.started_at)) / 60000) : null;
  add("scheduler-runs", last && age <= 30, last ? `last run ${age} min ago${last.paused ? " (paused)" : ""}${(last.errors || []).length ? `, errors: ${last.errors.join("; ")}` : ""}` : "no scheduler run recorded yet",
    "Deploy the Worker (README step 5); its Cron Trigger runs every 15 minutes. No run in 30 minutes means the trigger is missing or failing (Workers dashboard → Logs).");

  // 3. A platform admin exists (needed for the Operations health card and the pause button).
  const admins = await get("platform_admins?select=user_id&limit=1");
  add("platform-admin", admins.ok && admins.body?.length > 0, admins.ok && admins.body?.length ? "at least one platform admin" : "no platform admin yet", "Run the insert from README step 2 with your own email.", false);

  // 4. The scan function is deployed and checks its secret (a wrong secret must be refused, not crash).
  const scanUrl = env.SCAN_FUNCTION_URL || `${url}/functions/v1/scan`;
  const scan = await fetchImpl(scanUrl, { method: "POST", headers: { "content-type": "application/json", "x-scan-secret": "preflight-wrong-secret" }, body: JSON.stringify({ mode: "job", site: { id: "preflight", url: "https://example.com/" } }) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })).catch((e) => ({ status: 0, body: { error: e.message } }));
  add("scan-function", scan.status === 403, scan.status === 403 ? "deployed; refuses a wrong secret" : scan.status === 500 ? `deployed but not configured: ${scan.body?.error || ""}` : `HTTP ${scan.status} ${scan.body?.error || ""}`.trim(),
    scan.status === 500 ? "Create the Vault secrets scan_url and scan_secret (README step 3)." : "Redeploy the scan function from this branch (README step 4).");

  // 5. The Worker answers (optional: only when WORKER_URL is given).
  if (env.WORKER_URL) {
    const w = await fetchImpl(`${String(env.WORKER_URL).replace(/\/$/, "")}/health`).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) })).catch(() => ({ ok: false }));
    add("worker", w.ok && w.body?.service === "seo-god", w.ok ? `seo-god ${w.body?.version || ""} answers` : "the Worker does not answer /health", "Deploy it: cd cloud/worker && npm ci && npm run deploy (README step 5).");
    const internal = await fetchImpl(`${String(env.WORKER_URL).replace(/\/$/, "")}/internal/run-job`, { method: "POST" }).then((r) => r.status).catch(() => 0);
    add("worker-auth", internal === 403, internal === 403 ? "internal routes refuse calls without the token" : `internal route answered HTTP ${internal} without a token`, "Set the INTERNAL_TOKEN secret and redeploy; never leave it empty.");
  } else add("worker", true, "skipped (set WORKER_URL to check the Worker)", null, false);
  return out;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const res = await preflight();
  for (const r of res) console.log(`${r.ok ? "ok  " : r.required ? "FAIL" : "warn"}  ${r.id.padEnd(15)} ${r.detail}${r.fix ? `\n      → ${r.fix}` : ""}`);
  const failed = res.filter((r) => !r.ok && r.required).length;
  console.log(failed ? `\n${failed} required check(s) failed.` : "\nAll required checks passed.");
  process.exit(failed ? 1 : 0);
}
