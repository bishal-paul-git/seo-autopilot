import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, SupabaseStore } from "../src/god/stores.mjs";
import { makeHandlers, reportMemory } from "../src/god/handlers.mjs";
import { tick, strategyStatus, estimateCost } from "../src/god/tick.mjs";
import { runOnce } from "../src/god/worker.mjs";

const NOW = "2026-11-08T10:00:00Z";
const SITES = [{ id: "A", name: "Plumber", url: "https://plumber.test/" }, { id: "B", name: "Bakery", url: "https://bakery.test/" }];
const AUDIT = { generatedAt: "2026-11-08T09:00:00Z", summary: { pagesCrawled: 9, bySeverity: { high: 1, medium: 0, low: 0 }, byRule: { "title-missing": 1 } }, issues: [{ rule: "title-missing", severity: "high", url: "https://plumber.test/x" }], pages: [] };
const scanResult = (site) => ({ discovered: { name: { value: site.name, source: site.url }, phones: [], emails: [], addresses: [], hours: [], socials: [], topics: [] }, profile: { mode: "advise", platform: { name: "WordPress" } }, audit: { ...AUDIT }, snapshot: {} });
const setup = () => {
  const store = new MemoryStore(); store.sites = SITES; store.clock = () => NOW;
  const scans = [];
  const handlers = makeHandlers({ store, siteOf: async (id) => SITES.find((s) => s.id === id), scan: async (site) => { scans.push(site.id); return scanResult(site); } });
  return { store, handlers, scans };
};
const statuses = (store, site) => store.listJobs(site).map((j) => `${j.kind}:${j.status}`).sort();

test("tick: the kill switch stops everything", async () => {
  const { store, handlers } = setup();
  const r = await tick({ store, handlers, now: NOW, paused: true });
  assert.equal(r.paused, true);
  assert.equal(store.jobs.size, 0);
});

test("tick: full onboarding flow per site: scan, draft at once, one agency approval adopts it (D35)", async () => {
  const { store, handlers, scans } = setup();
  const r1 = await tick({ store, handlers, now: NOW });
  assert.deepEqual(scans.sort(), ["A", "B"], "each site read once");
  assert.deepEqual(statuses(store, "A"), ["scan:completed", "strategy_proposal:awaiting_approval"]);
  assert.equal(r1.sites[0].strategy, "proposed");
  assert.equal(scans.length, 2, "the draft reused the scan: no second crawl");
  assert.equal(store.readMemory("A", "report").find((m) => m.key === "audit").value.summary.pagesCrawled, 9, "audit summary kept for the next plan");
  const spA = store.listJobs("A").find((j) => j.kind === "strategy_proposal");
  assert.ok(store.get(spA.id).outputs.proposal.firstSteps.length > 0, "the exact draft the agency will adopt is stored on the job");

  const r2 = await tick({ store, handlers, now: NOW });
  assert.equal(r2.runs.length, 0, "a second tick without agency decisions does nothing: no rescan (fresh audit), no duplicate draft");
  assert.ok(r2.sites[0].waiting.some((w) => /approve the result/.test(w.reason)));

  // Asking for changes sends the draft back to be redone (after the agency answers questions, for example).
  store.approve(spA.id, "request_changes", "alice@agency");
  const r3 = await tick({ store, handlers, now: NOW });
  assert.deepEqual(r3.sites[0].moved, [{ job: spA.id, kind: "strategy_proposal", to: "queued" }]);
  assert.ok(r3.runs.some((x) => x.job === spA.id && x.outcome === "awaiting_approval"), "redrafted, back to the agency");
  assert.equal(store.listJobs("B").find((j) => j.kind === "strategy_proposal").status, "awaiting_approval", "site B untouched");

  store.approve(spA.id, "approve", "alice@agency");
  const r4 = await tick({ store, handlers, now: NOW });
  assert.equal(store.get(spA.id).status, "completed");
  assert.equal(store.readMemory("A", "strategy")[0].value.status, "approved");
  assert.equal(r4.sites[0].strategy, "approved");
  assert.ok(r4.sites[0].deferred.every((d) => /no runner/.test(d.reason)), "approved strategy: agent work is planned but not queued without a runner");
  assert.equal(r4.sites[1].strategy, "proposed", "site B still waits");
});

test("tick: daily budget is reserved per site; paid work beyond it is deferred, free work is not", async () => {
  const { store, handlers } = setup();
  store.writeMemory("A", [{ kind: "strategy", key: "initial", value: { status: "approved" }, basis: "verified" }, ...reportMemory(scanResult(SITES[0]))]);
  const runs = [];
  const all = { ...handlers, "agent:*": async (job) => { runs.push(job.kind); return { evidence: ["read the audit"], costUsd: 0.4 }; } };
  const r = await tick({ store, handlers: all, sites: [SITES[0]], now: NOW, dailyBudgetUsd: 1, agentRunUsd: 0.5 });
  const queued = r.sites[0].queued.filter((q) => q.kind.startsWith("agent:"));
  assert.ok(queued.length >= 1 && queued.length <= 2, `at most two $0.50 runs fit a $1 day (got ${queued.length})`);
  if (r.sites[0].deferred.length) assert.ok(r.sites[0].deferred.some((d) => /over today's budget/.test(d.reason)));
  assert.ok(store.spendSince("A", "2026-11-08T00:00:00Z") <= 1);
  const zero = await tick({ store: (() => { const s = setup().store; s.writeMemory("A", [{ kind: "strategy", key: "initial", value: { status: "approved" }, basis: "verified" }, ...reportMemory(scanResult(SITES[0]))]); return s; })(), handlers: all, sites: [SITES[0]], now: NOW });
  assert.equal(zero.sites[0].queued.filter((q) => q.kind.startsWith("agent:")).length, 0, "no budget: no paid work");
  assert.equal(estimateCost("scan"), 0);
});

test("worker: a run that spends more than its budget fails review and is not retried", async () => {
  const store = new MemoryStore(); store.clock = () => NOW;
  const j = store.createJob({ siteId: "A", kind: "agent:seo-reporter", agent: "seo-reporter", title: "Report", risk: "low", budgetUsd: 0.1 });
  store.transition(j.id, "scoped", "god"); store.transition(j.id, "queued", "god");
  const r = await runOnce({ store, handlers: { "agent:*": async () => ({ evidence: ["x"], costUsd: 0.3 }) } });
  assert.equal(r.outcome, "review_fail");
  assert.match(r.reasons.join(), /over budget/);
  assert.equal(store.get(j.id).status, "failed");
  assert.equal(store.spendSince("A", "2026-11-08T00:00:00Z"), 0.3, "the spend is still recorded");
});

test("strategy status: approved memory wins; an open proposal means proposed; a rejected one means none", () => {
  assert.equal(strategyStatus([], [{ kind: "strategy", key: "initial", value: { status: "approved" } }]), "approved");
  assert.equal(strategyStatus([{ kind: "strategy_proposal", status: "awaiting_approval" }], [{ kind: "strategy", key: "initial", value: { status: "proposed" } }]), "proposed");
  assert.equal(strategyStatus([{ kind: "strategy_proposal", status: "rejected" }], [{ kind: "strategy", key: "initial", value: { status: "proposed" } }]), "none");
});

test("SupabaseStore: scheduler RPCs", async () => {
  const calls = [];
  const fetchImpl = async (url, o) => { const fn = url.split("/").pop(); calls.push({ fn, body: JSON.parse(o.body) });
    const body = fn === "site_spend" ? 1.25 : fn === "god_sites" ? [{ id: "A", org_id: "o", name: "P", url: "https://p.test/" }] : fn === "site_jobs" ? [{ id: "j", site_id: "A", kind: "scan", status: "queued", budget_usd: "0.5000", cost_usd: "0.1000", idempotency_key: "scan:2026-11-08" }] : { id: "j", site_id: "A", kind: "scan", status: "queued" };
    return new Response(JSON.stringify(body), { status: 200 }); };
  const s = new SupabaseStore({ url: "https://x.supabase.co", key: "k", fetchImpl });
  assert.equal(await s.spendSince("A", "2026-11-08T00:00:00Z"), 1.25);
  assert.deepEqual(await s.listSites(), [{ id: "A", orgId: "o", name: "P", url: "https://p.test/" }]);
  const [j] = await s.listJobs("A");
  assert.deepEqual([j.budgetUsd, j.costUsd, j.idempotencyKey], [0.5, 0.1, "scan:2026-11-08"]);
  await s.recordOutput("j", { outputs: { proposal: null }, costUsd: 0.2, note: "scan" });
  await s.createJob({ siteId: "A", kind: "agent:x", title: "x", budgetUsd: 0.5 });
  assert.deepEqual(calls.map((c) => c.fn), ["site_spend", "god_sites", "site_jobs", "record_job_output", "create_job"]);
  assert.equal(calls[3].body.p_cost, 0.2);
  assert.equal(calls[4].body.p_budget_usd, 0.5);
});
