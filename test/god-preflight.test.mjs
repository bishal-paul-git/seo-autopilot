import { test } from "node:test";
import assert from "node:assert/strict";
import { preflight, MIGRATIONS } from "../scripts/god-preflight.mjs";

const NOW = Date.parse("2026-11-08T12:00:00Z");
function fake({ fns = MIGRATIONS.map(([, f]) => f), lastRunMin = 10, admins = 1, scan = 403, worker = true, internal = 403 } = {}) {
  const seen = [];
  const fetchImpl = async (url, o = {}) => {
    seen.push({ url: String(url), key: o.headers?.apikey });
    const u = String(url);
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (u.endsWith("/rest/v1/")) return json({ paths: Object.fromEntries(fns.map((f) => [`/rpc/${f}`, {}])) });
    if (u.endsWith("/rpc/god_paused")) return json(false);
    if (u.includes("/god_runs?")) return json(lastRunMin == null ? [] : [{ started_at: new Date(NOW - lastRunMin * 60000).toISOString(), paused: false, errors: [] }]);
    if (u.includes("/platform_admins?")) return json(Array.from({ length: admins }, () => ({ user_id: "u" })));
    if (u.endsWith("/functions/v1/scan")) return json({ error: scan === 403 ? "forbidden" : "not configured" }, scan);
    if (u.endsWith("/health")) return worker ? json({ ok: true, service: "seo-god", version: "0.1.0" }) : json({}, 404);
    if (u.endsWith("/internal/run-job")) return json({ error: "forbidden" }, internal);
    return json({}, 404);
  };
  return { fetchImpl, seen };
}
const env = { SUPABASE_URL: "https://ref.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "svc", WORKER_URL: "https://seo-god.x.workers.dev" };
const byId = (res) => Object.fromEntries(res.map((r) => [r.id, r]));

test("everything set up: every check passes", async () => {
  const f = fake();
  const res = await preflight({ env, fetchImpl: f.fetchImpl, now: NOW });
  assert.ok(res.every((r) => r.ok), JSON.stringify(res.filter((r) => !r.ok)));
  assert.ok(f.seen.filter((s) => s.url.startsWith("https://ref.supabase.co/rest")).every((s) => s.key === "svc"));
  assert.ok(f.seen.filter((s) => !s.url.startsWith("https://ref.supabase.co")).every((s) => s.key === undefined), "the service key never goes to the Worker or anywhere else");
});

test("names the missing migrations and stops there", async () => {
  const res = await preflight({ env, fetchImpl: fake({ fns: ["scan_secret_ok", "approve_job"] }).fetchImpl, now: NOW });
  const m = byId(res).migrations;
  assert.equal(m.ok, false);
  assert.match(m.detail, /20261108010000_r1_memory/);
  assert.equal(res.length, 1);
});

test("each later step reports what to do next", async () => {
  const r = byId(await preflight({ env, fetchImpl: fake({ lastRunMin: 120, admins: 0, scan: 500, worker: true, internal: 200 }).fetchImpl, now: NOW }));
  assert.match(r["scheduler-runs"].fix, /Cron Trigger/);
  assert.equal(r["platform-admin"].ok, false); assert.equal(r["platform-admin"].required, false, "an admin is optional");
  assert.match(r["scan-function"].fix, /Vault secrets/);
  assert.match(r["worker-auth"].detail, /HTTP 200 without a token/);
  const none = byId(await preflight({ env, fetchImpl: fake({ lastRunMin: null }).fetchImpl, now: NOW }));
  assert.match(none["scheduler-runs"].detail, /no scheduler run/);
});

test("without credentials it explains what is needed", async () => {
  const res = await preflight({ env: {}, fetchImpl: async () => { throw new Error("must not call"); } });
  assert.equal(res[0].id, "config");
  assert.match(res[0].fix, /service role key/);
});
