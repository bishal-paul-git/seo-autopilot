// SEO God execution Worker (Cloudflare, D30): the logic; src/worker.mjs is the entry module. A stateless scheduler and dispatcher: Supabase holds every job, approval,
// memory row, lease and cost; this Worker only decides what to do next and calls the existing engine code.
//
// Workers Free allows 10 ms CPU and 50 outbound requests per invocation. So one Cron run does very little itself. It
// checks the pause switch, recovers expired leases, then hands each site's planning and each job to a NEW invocation of
// this same Worker through a service binding (SELF). Each of those gets its own 10 ms and 50 requests. Measured CPU
// (scripts/cf-measure.mjs, Node V8): planning a site 0.6-2.5 ms, building an agent prompt 0.6-1.1 ms. Crawling is
// 13-27 ms per page, so it never runs here: the scan job calls the Supabase `scan` function (2 s CPU) in job mode.
//
// Nothing here approves work. The database refuses any move that needs the agency's approval (private.move_job).
import { SupabaseStore } from "../../../src/god/stores.mjs";
import { makeHandlers } from "../../../src/god/handlers.mjs";
import { makeAgentHandler, makeClientRequestHandler } from "../../../src/god/agent-runner.mjs";
import { tick } from "../../../src/god/tick.mjs";
import { makeSearchConsoleHandler, googleToken } from "../../../src/god/search-console.mjs";
import { runOnce } from "../../../src/god/worker.mjs";
import { PROMPTS } from "./agents.generated.mjs";

export const VERSION = "0.1.0";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Settings from the Worker's vars and secrets, with safe defaults (pause on anything unclear). */
export function settings(env) {
  const n = (v, d, min, max) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d; };
  return {
    paused: String(env.SEO_GOD_PAUSED ?? "true").toLowerCase() !== "false", // explicit "false" is required to run
    sitesPerRun: n(env.SITES_PER_RUN, 5, 1, 25), jobsPerRun: n(env.JOBS_PER_RUN, 4, 0, 20),
    dailyBudgetUsd: n(env.SEO_GOD_DAILY_BUDGET_USD, 0, 0, 1000), agentRunUsd: n(env.SEO_GOD_AGENT_RUN_USD, 0.5, 0, 50),
    minSiteAgeHours: n(env.SITE_MIN_AGE_HOURS, 6, 1, 168), scanMaxPages: n(env.SCAN_MAX_PAGES, 40, 1, 40),
  };
}

/** Constant-time comparison of the internal token (fails closed when the secret is unset). */
export function tokenOk(given, expected) {
  if (!expected || typeof given !== "string" || given.length !== expected.length) return false;
  let d = 0;
  for (let i = 0; i < given.length; i++) d |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return d === 0;
}

/** fetch that counts outbound requests, so each invocation can report what it used. */
export function countingFetch(base = (...a) => fetch(...a)) {
  const f = (...a) => { f.count++; return base(...a); };
  f.count = 0;
  return f;
}

/** The scan job's crawler: the Supabase `scan` function in job mode, one site per request. */
export function remoteScan(env, fetchImpl, maxPages) {
  return async (site) => {
    if (!env.SCAN_FUNCTION_URL || !env.SCAN_SECRET) throw new Error("scan function not configured");
    const r = await fetchImpl(env.SCAN_FUNCTION_URL, { method: "POST", headers: { "content-type": "application/json", "x-scan-secret": env.SCAN_SECRET }, body: JSON.stringify({ mode: "job", site: { id: site.id, name: site.name, url: site.url }, maxPages }) });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body?.ok) throw new Error(`scan function: ${body?.error || `HTTP ${r.status}`}`.slice(0, 300));
    return { discovered: body.discovered || {}, profile: body.profile || {}, audit: body.audit };
  };
}

/** The store, handlers and site lookup for one invocation. */
export function context(env, fetchImpl) {
  const s = settings(env);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase is not configured");
  const store = new SupabaseStore({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl });
  let sites = null;
  const siteOf = async (id) => (sites ??= await store.listSites()).find((x) => x.id === id) || null;
  const handlers = makeHandlers({ store, siteOf, scan: remoteScan(env, fetchImpl, s.scanMaxPages) });
  // Agent jobs only with the user's own key (rule 6); otherwise the planner reports them as deferred, never queued.
  if (env.ANTHROPIC_API_KEY) handlers["agent:*"] = handlers.client_request = makeAgentHandler({ store, siteOf, apiKey: env.ANTHROPIC_API_KEY, model: env.SEO_GOD_MODEL || "claude-opus-5-5", effort: env.SEO_GOD_EFFORT || "medium", fetchImpl, promptOf: (name) => PROMPTS[name] || null, baseUrl: env.ANTHROPIC_BASE_URL || "https://api.anthropic.com" });
  // Search Console only with a service account key (GOOGLE_KEY_JSON); without it the measurement is never queued.
  if (env.GOOGLE_KEY_JSON) { let tok = null; handlers.search_console = makeSearchConsoleHandler({ store, siteOf, fetchImpl, getToken: () => (tok ??= googleToken(env.GOOGLE_KEY_JSON, { fetchImpl })) }); }
  if (handlers.client_request) handlers.client_request = makeClientRequestHandler({ store, agentHandler: handlers["agent:*"] });
  return { s, store, siteOf, handlers };
}

/** Plan ONE site (its own invocation). The site comes from the scheduler, never from a public request. */
export async function tickSite(env, site, fetchImpl) {
  const { s, store, handlers } = context(env, fetchImpl);
  const r = await tick({ store, sites: [site], handlers, maxJobs: 0, dailyBudgetUsd: s.dailyBudgetUsd, agentRunUsd: s.agentRunUsd });
  const e = r.sites[0] || {};
  const outcome = { strategy: e.strategy ?? null, queued: (e.queued || []).length, deferred: (e.deferred || []).length, waiting: (e.waiting || []).length, error: e.error || null };
  await rpc(env, fetchImpl, "record_site_tick", { p_site: site.id, p_outcome: outcome });
  return outcome;
}

/** Run ONE queued job, if any (its own invocation). Approval gates are enforced by the database on every move. */
export async function runJob(env, fetchImpl, workerId) {
  const { store, siteOf, handlers } = context(env, fetchImpl);
  const r = await runOnce({ store, handlers, worker: workerId, timeoutMs: 170_000, siteHostOf: async (job) => { const site = await siteOf(job.siteId); try { return site ? new URL(site.url).hostname : null; } catch { return null; } } });
  return r || { idle: true };
}

async function rpc(env, fetchImpl, fn, args = {}) {
  const r = await fetchImpl(`${String(env.SUPABASE_URL).replace(/\/$/, "")}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch { /* text */ } throw new Error(`${fn}: ${m}`.slice(0, 300)); }
  return t ? JSON.parse(t) : null;
}

/**
 * One scheduler run (Cron). dispatch(path, body) sends work to a new invocation (the SELF service binding in production).
 * Returns the run record that is also stored in public.god_runs.
 */
export async function schedule(env, { dispatch, fetchImpl = countingFetch(), now = () => new Date().toISOString(), runner = "cloudflare-cron" } = {}) {
  const s = settings(env), run = { runner, startedAt: now(), sitesPlanned: 0, jobsRun: 0, jobsRecovered: 0, invocations: 1, subrequests: 0, errors: [], paused: false, jobs: [] };
  const finish = async () => {
    run.subrequests += fetchImpl.count || 0;
    try { await rpc(env, fetchImpl, "record_god_run", { p_run: run }); } catch (e) { run.errors.push(`record: ${e.message}`); }
    return run;
  };
  if (s.paused || (await rpc(env, fetchImpl, "god_paused").catch(() => true))) { run.paused = true; return finish(); }
  run.jobsRecovered = await rpc(env, fetchImpl, "reap_expired_leases", { p_limit: 20 }).catch((e) => { run.errors.push(`reap: ${e.message}`); return 0; });
  const due = await rpc(env, fetchImpl, "god_due_sites", { p_limit: s.sitesPerRun, p_min_age: `${s.minSiteAgeHours} hours` }).catch((e) => { run.errors.push(`due: ${e.message}`); return []; });
  // Planning fan-out, at most 4 at a time (Workers allow 6 open connections per invocation).
  for (let i = 0; i < due.length; i += 4) {
    const out = await Promise.all(due.slice(i, i + 4).map((site) => dispatch("/internal/tick-site", { site: { id: site.id, name: site.name, url: site.url } })));
    for (const o of out) { run.invocations++; run.subrequests += o?.subrequests || 0; if (o?.ok) run.sitesPlanned++; else run.errors.push(`plan: ${o?.error || "failed"}`.slice(0, 200)); }
  }
  // Jobs one at a time: each is its own invocation; stop as soon as the queue is empty.
  for (let i = 0; i < s.jobsPerRun; i++) {
    const o = await dispatch("/internal/run-job", {});
    run.invocations++; run.subrequests += o?.subrequests || 0;
    if (!o?.ok) { run.errors.push(`job: ${o?.error || "failed"}`.slice(0, 200)); break; }
    if (o.result?.idle) break;
    run.jobsRun++; run.jobs.push({ job: o.result.job, outcome: o.result.outcome });
  }
  return finish();
}

/** Calls a new invocation of this Worker through the SELF service binding, with the internal token. */
export const selfDispatch = (env) => async (path, body) => {
  try {
    const r = await env.SELF.fetch(`https://seo-god.internal${path}`, { method: "POST", headers: { "content-type": "application/json", "x-god-token": env.INTERNAL_TOKEN }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
};

export const handler = {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(schedule(env, { dispatch: selfDispatch(env) }).then((r) => console.log(JSON.stringify({ msg: "god run", ...r, jobs: undefined }))));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "seo-god", version: VERSION });
    if (!url.pathname.startsWith("/internal/")) return json({ error: "not found" }, 404);
    if (req.method !== "POST" || !tokenOk(req.headers.get("x-god-token") || "", env.INTERNAL_TOKEN || "")) return json({ error: "forbidden" }, 403);
    const f = countingFetch();
    try {
      if (url.pathname === "/internal/tick-site") {
        const { site } = await req.json();
        if (!site || typeof site.id !== "string" || typeof site.url !== "string") return json({ ok: false, error: "site required" }, 400);
        return json({ ok: true, outcome: await tickSite(env, site, f), subrequests: f.count });
      }
      if (url.pathname === "/internal/run-job") return json({ ok: true, result: await runJob(env, f, `cf-${crypto.randomUUID().slice(0, 8)}`), subrequests: f.count });
      if (url.pathname === "/internal/schedule") return json({ ok: true, run: await schedule(env, { dispatch: selfDispatch(env), runner: "manual" }) });
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ ok: false, error: String(e.message || e).slice(0, 300), subrequests: f.count }, 500);
    }
  },
};
