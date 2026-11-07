import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const W = (p) => fileURLToPath(new URL(`../cloud/worker/${p}`, import.meta.url));
let app;
before(async () => {
  execFileSync(process.execPath, [W("build.mjs")], { stdio: "ignore" }); // generates the bundled prompts and packs
  await import(W("src/packs.generated.mjs"));
  app = await import(W("src/app.mjs"));
});

const ENV = { SEO_GOD_PAUSED: "false", SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "svc", INTERNAL_TOKEN: "t".repeat(32), SCAN_FUNCTION_URL: "https://db.test/functions/v1/scan", SCAN_SECRET: "s" };
const fakeDb = (answers = {}) => {
  const calls = [];
  const f = async (url, o) => { const fn = String(url).split("/").pop(); calls.push({ fn, body: JSON.parse(o.body || "{}"), key: o.headers.Authorization }); const a = answers[fn]; const v = typeof a === "function" ? a(JSON.parse(o.body || "{}")) : a; return new Response(v === undefined ? "" : JSON.stringify(v), { status: 200 }); };
  return { f: app.countingFetch(f), calls };
};

test("runtime matrix is generated from the code and up to date", async () => {
  const { audit, markdown } = await import("../scripts/cf-runtime-audit.mjs");
  const a = audit();
  assert.equal(readFileSync(new URL("../docs/cloudflare/runtime-matrix.json", import.meta.url), "utf8"), JSON.stringify(a, null, 1) + "\n", "run node scripts/cf-runtime-audit.mjs");
  assert.equal(readFileSync(new URL("../docs/cloudflare/runtime-matrix.md", import.meta.url), "utf8"), markdown(a));
  assert.equal(a.summary.total, 58);
  for (const j of a.jobs) if (j.needs.spawns) assert.notEqual(j.path, "worker-candidate", `${j.job} spawns processes: never a Worker job`);
});

test("settings fail safe: paused unless explicitly false; numbers clamped", () => {
  assert.equal(app.settings({}).paused, true);
  assert.equal(app.settings({ SEO_GOD_PAUSED: "FALSE" }).paused, false);
  assert.equal(app.settings({ SEO_GOD_PAUSED: "no" }).paused, true, "only the string false runs it");
  const s = app.settings({ SITES_PER_RUN: "999", JOBS_PER_RUN: "-3", SCAN_MAX_PAGES: "500", SEO_GOD_DAILY_BUDGET_USD: "abc" });
  assert.deepEqual([s.sitesPerRun, s.jobsPerRun, s.scanMaxPages, s.dailyBudgetUsd], [25, 0, 40, 0]);
});

test("internal token: constant-time comparison that fails closed", () => {
  assert.equal(app.tokenOk("abc", "abc"), true);
  assert.equal(app.tokenOk("abd", "abc"), false);
  assert.equal(app.tokenOk("", ""), false, "unset secret never matches");
  assert.equal(app.tokenOk("abc", ""), false);
  assert.equal(app.tokenOk(undefined, "abc"), false);
});

test("HTTP routes: health is public and empty of data; everything else needs the token", async () => {
  const h = app.handler;
  const health = await (await h.fetch(new Request("https://w.test/health"), ENV)).json();
  assert.deepEqual(Object.keys(health).sort(), ["ok", "service", "version"]);
  assert.equal((await h.fetch(new Request("https://w.test/anything"), ENV)).status, 404);
  assert.equal((await h.fetch(new Request("https://w.test/internal/run-job", { method: "POST" }), ENV)).status, 403);
  assert.equal((await h.fetch(new Request("https://w.test/internal/run-job", { method: "POST", headers: { "x-god-token": "" } }), { ...ENV, INTERNAL_TOKEN: "" })).status, 403, "no secret configured: refused");
  assert.equal((await h.fetch(new Request("https://w.test/internal/run-job", { headers: { "x-god-token": ENV.INTERNAL_TOKEN } }), ENV)).status, 403, "GET refused");
  const bad = await h.fetch(new Request("https://w.test/internal/tick-site", { method: "POST", headers: { "x-god-token": ENV.INTERNAL_TOKEN }, body: JSON.stringify({ site: { id: 1 } }) }), ENV);
  assert.equal(bad.status, 400);
});

test("remote scan: one site to the scan function in job mode, errors surfaced, missing config refused", async () => {
  const sent = [];
  const ok = app.remoteScan(ENV, async (url, o) => { sent.push({ url, o }); return new Response(JSON.stringify({ ok: true, discovered: { name: { value: "P" } }, profile: {}, audit: { summary: { pagesCrawled: 3 }, issues: [] } }), { status: 200 }); }, 40);
  const r = await ok({ id: "A", name: "P", url: "https://p.test/", extra: "dropped" });
  assert.equal(r.audit.summary.pagesCrawled, 3);
  assert.equal(sent[0].o.headers["x-scan-secret"], "s");
  assert.deepEqual(JSON.parse(sent[0].o.body), { mode: "job", site: { id: "A", name: "P", url: "https://p.test/" }, maxPages: 40 });
  await assert.rejects(app.remoteScan(ENV, async () => new Response(JSON.stringify({ ok: false, error: "robots.txt disallows" }), { status: 422 }), 40)({ id: "A", url: "https://p.test/" }), /robots/);
  await assert.rejects(app.remoteScan({}, async () => null, 40)({ id: "A", url: "https://p.test/" }), /not configured/);
});

test("scheduler: the Worker switch and the database switch both pause; nothing else runs while paused", async () => {
  const db = fakeDb({ record_god_run: 1 });
  let dispatched = 0;
  const r = await app.schedule({ ...ENV, SEO_GOD_PAUSED: "true" }, { dispatch: async () => { dispatched++; return { ok: true }; }, fetchImpl: db.f });
  assert.equal(r.paused, true); assert.equal(dispatched, 0);
  assert.deepEqual(db.calls.map((c) => c.fn), ["record_god_run"]);
  const db2 = fakeDb({ god_paused: true, record_god_run: 1 });
  const r2 = await app.schedule(ENV, { dispatch: async () => { dispatched++; return { ok: true }; }, fetchImpl: db2.f });
  assert.equal(r2.paused, true); assert.equal(dispatched, 0);
  const db3 = fakeDb({ record_god_run: 1 }); // god_paused unreadable (empty answer counts as unknown): stays paused
  db3.f.count = 0;
  const r3 = await app.schedule(ENV, { dispatch: async () => ({ ok: true }), fetchImpl: app.countingFetch(async () => { throw new Error("db down"); }) });
  assert.equal(r3.paused, true, "database unreachable: do nothing");
});

test("scheduler: recovers leases, fans out planning and jobs to new invocations, records usage and errors", async () => {
  const sites = [1, 2, 3, 4, 5].map((i) => ({ id: `s${i}`, org_id: "o", name: `S${i}`, url: `https://s${i}.test/` }));
  const db = fakeDb({ god_paused: false, reap_expired_leases: 2, god_due_sites: sites, record_god_run: 9 });
  const seen = []; let jobs = 0;
  const dispatch = async (path, body) => {
    seen.push(path);
    if (path === "/internal/tick-site") return body.site.id === "s3" ? { ok: false, error: "boom" } : { ok: true, subrequests: 7 };
    jobs++; return jobs <= 2 ? { ok: true, result: { job: `j${jobs}`, outcome: "completed" }, subrequests: 9 } : { ok: true, result: { idle: true }, subrequests: 1 };
  };
  const r = await app.schedule(ENV, { dispatch, fetchImpl: db.f });
  assert.equal(r.jobsRecovered, 2);
  assert.equal(r.sitesPlanned, 4); assert.equal(r.errors.length, 1);
  assert.equal(r.jobsRun, 2, "stops when the queue is empty");
  assert.equal(seen.filter((p) => p === "/internal/tick-site").length, 5);
  assert.equal(r.invocations, 1 + 5 + 3);
  assert.equal(r.subrequests, 4 * 7 + 2 * 9 + 1 + db.f.count - 1, "fan-out subrequests plus this invocation's own (the final record call is not in its own count)");
  assert.ok(db.calls.every((c) => c.key === "Bearer svc"));
  const rec = db.calls.find((c) => c.fn === "record_god_run").body.p_run;
  assert.equal(rec.sitesPlanned, 4);
  assert.equal(db.calls.find((c) => c.fn === "god_due_sites").body.p_limit, 5);
});

test("wrangler config: safe defaults, one Cron Trigger, no secrets in vars", () => {
  const toml = readFileSync(W("wrangler.toml"), "utf8");
  const vars = toml.split("[vars]")[1].split("\n[")[0];
  assert.match(vars, /SEO_GOD_PAUSED = "true"/);
  assert.doesNotMatch(vars, /SERVICE_ROLE_KEY|INTERNAL_TOKEN|SCAN_SECRET|ANTHROPIC_API_KEY\s*=/);
  assert.equal((toml.match(/crons = \["[^"]+"\]/g) || []).length, 1, "one Cron Trigger (Workers Free allows 5 per account)");
  assert.match(toml, /compatibility_flags = \["nodejs_compat"\]/);
  assert.match(readFileSync(W("src/worker.mjs"), "utf8"), /^export default handler;$/m);
  assert.doesNotMatch(readFileSync(W("src/worker.mjs"), "utf8"), /^export (const|function|async)/m, "workerd treats named exports of the entry as handlers");
});

test("build bundles every agent definition and the vertical packs", async () => {
  const { PROMPTS } = await import(W("src/agents.generated.mjs"));
  assert.equal(Object.keys(PROMPTS).length, 38);
  assert.match(PROMPTS["seo-reporter"], /# SEO reporter/);
  assert.ok(globalThis.SEO_AUTOPILOT_PACKS && Object.keys(globalThis.SEO_AUTOPILOT_PACKS).length > 0);
});
