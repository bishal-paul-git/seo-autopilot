// Index status in the hosted engine (D57): a daily `index_inspect` job inspects a small rotating batch of pages with
// Google's URL Inspection API, stores the CLI's inspect shape in site memory, handles a refusal (Restricted access) and
// Google's quota cleanly, and feeds the router, the priorities and the agents. Mocked Google; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeInspectHandler, inspectBatch, inspectDue, boundResults, inspectForAgents, INSPECT_PER_DAY } from "../src/god/inspect.mjs";
import { plannerReports, prioritiesDue } from "../src/god/insights.mjs";
import { makeHandlers } from "../src/god/handlers.mjs";
import { routeAgents } from "../src/analysis/agent-router.mjs";
import { agentInput } from "../src/god/agent-runner.mjs";
import { MemoryStore } from "../src/god/stores.mjs";
import { tick } from "../src/god/tick.mjs";

const NOW = "2026-11-30T12:00:00Z", SITE = { id: "A", name: "P", url: "https://www.plumber.test/" };
const jsonRes = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
const SC = { kind: "report", key: "search_console", value: { property: "sc-domain:plumber.test", generatedAt: "2026-11-30T06:00:00Z", to: "2026-11-27", pages: [
  { url: "https://www.plumber.test/boilers", clicks: 9, impressions: 400 }, { url: "https://www.plumber.test/a", clicks: 2, impressions: 50 },
  { url: "https://evil.test/x", clicks: 99, impressions: 999 }] } };
const AUDIT = { kind: "report", key: "audit", value: { generatedAt: NOW, issues: [], crawled: ["https://www.plumber.test/", "https://www.plumber.test/c", "https://www.plumber.test/d"] } };
const result = (coverage, extra = {}) => jsonRes({ inspectionResult: { indexStatusResult: { verdict: /indexed/i.test(coverage) && !/not indexed/i.test(coverage) ? "PASS" : "NEUTRAL", coverageState: coverage, indexingState: "INDEXING_ALLOWED", robotsTxtState: "ALLOWED", pageFetchState: "SUCCESSFUL", googleCanonical: null, userCanonical: null, lastCrawlTime: "2026-11-20T00:00:00Z", ...extra } } }, 200);

function google(answer = () => result("Submitted and indexed")) {
  const calls = [];
  const fetchImpl = async (url, o) => { const b = JSON.parse(o.body); calls.push({ url, b, auth: o.headers.Authorization }); return answer(b.inspectionUrl, calls.length); };
  return { fetchImpl, calls };
}
const handler = (store, g, extra = {}) => makeInspectHandler({ store, siteOf: async () => SITE, getToken: async () => "sa-token", fetchImpl: g.fetchImpl, now: () => NOW, ...extra });

test("batch: important pages first (home, top by impressions), then never-inspected pages, then the oldest; same host only; capped", () => {
  const b = inspectBatch({ siteUrl: SITE.url, memory: [SC, AUDIT], max: 20, now: NOW });
  assert.deepEqual(b, ["https://www.plumber.test/", "https://www.plumber.test/boilers", "https://www.plumber.test/a", "https://www.plumber.test/c", "https://www.plumber.test/d"]);
  const seen = { kind: "report", key: "inspect", value: { generatedAt: NOW, results: {
    "https://www.plumber.test/": { checkedAt: "2026-11-29T00:00:00Z" }, "https://www.plumber.test/boilers": { checkedAt: "2026-11-01T00:00:00Z" },
    "https://www.plumber.test/a": { checkedAt: "2026-11-28T00:00:00Z" }, "https://www.plumber.test/c": { checkedAt: "2026-11-02T00:00:00Z" } } } };
  assert.deepEqual(inspectBatch({ siteUrl: SITE.url, memory: [SC, AUDIT, seen], max: 3, now: NOW }), ["https://www.plumber.test/boilers", "https://www.plumber.test/d", "https://www.plumber.test/c"],
    "an important page inspected 29 days ago is due again; a recent one is not; then a new page; then the oldest");
  assert.equal(INSPECT_PER_DAY, 20, "far below Google's 2,000 a day per property");
});

test("inspection job: the bound property, the CLI's inspect shape (compact), previous state kept per page; priorities due again", async () => {
  const store = new MemoryStore(); store.writeMemory("A", [SC, AUDIT]);
  const g = google((u) => result(u.endsWith("/d") ? "Crawled - currently not indexed" : "Submitted and indexed"));
  const out = await handler(store, g, { boundOf: async () => ({ gscProperty: "https://www.plumber.test/" }) })({ siteId: "A" });
  assert.equal(g.calls.length, 5);
  assert.ok(g.calls.every((c) => c.b.siteUrl === "https://www.plumber.test/" && c.auth === "Bearer sa-token" && /urlInspection\/index:inspect$/.test(c.url)));
  assert.match(out.evidence[0], /URL inspection https:\/\/www\.plumber\.test\/: 5 of 5 pages inspected today; 4 of 5 known pages indexed/);
  const r = store.readMemory("A").find((m) => m.key === "inspect").value;
  assert.equal(r.results["https://www.plumber.test/d"].coverage, "Crawled - currently not indexed");
  assert.equal(r.results["https://www.plumber.test/d"].prev, undefined, "first inspection: nothing to compare with");
  assert.ok(!("googleCanonical" in r.results["https://www.plumber.test/d"]), "empty fields are left out");
  assert.deepEqual(r.counts, { known: 5, indexed: 4, notIndexed: 1 });
  assert.equal(r.blocked, null);
  // The ranking is its own free job: due now, and it puts the unindexed page on the list.
  const h = makeHandlers({ store, siteOf: async () => SITE });
  assert.ok(prioritiesDue(store.readMemory("A")));
  await h.priorities({ siteId: "A" });
  assert.ok(store.readMemory("A").find((m) => m.key === "priorities").value.items.some((i) => i.id === "indexing:request"), "priorities include the unindexed page");
  assert.equal(prioritiesDue(store.readMemory("A")), null, "not again until new data");
  // The next day, the same page drops out: its previous state is kept for the alert detector.
  const later = "2026-12-08T12:00:00Z";
  await makeInspectHandler({ store, siteOf: async () => SITE, getToken: async () => "t", fetchImpl: google(() => result("Crawled - currently not indexed")).fetchImpl, now: () => later, boundOf: async () => ({ gscProperty: "https://www.plumber.test/" }) })({ siteId: "A" });
  const r2 = store.readMemory("A").find((m) => m.key === "inspect").value;
  assert.equal(r2.results["https://www.plumber.test/"].prev.coverage, "Submitted and indexed");
  assert.equal(r2.results["https://www.plumber.test/"].coverage, "Crawled - currently not indexed");
  assert.equal(r2.results["https://www.plumber.test/"].changedAt, later, "when the state changed (the alert reacts to that day only)");
  assert.equal(r2.results["https://www.plumber.test/d"].changedAt, undefined, "unchanged page: no change recorded");
  assert.ok(prioritiesDue(store.readMemory("A")), "new inspection data: re-rank");
});

test("inspection job: Restricted access (403) is recorded once as 'needs Full permission' and not planned again for a week", async () => {
  const store = new MemoryStore(); store.writeMemory("A", [SC, AUDIT]);
  const g = google(() => jsonRes({ error: { code: 403, message: "User does not have sufficient permission for site" } }, 403));
  const out = await handler(store, g)({ siteId: "A" });
  assert.match(out.evidence[0], /refused for sc-domain:plumber\.test \(HTTP 403\): the service account needs Full permission/);
  assert.ok(!out.escalate, "not a stopped job: the agency sees it in the digest and the alerts");
  assert.ok(g.calls.length <= 4, "every lane stops at the first refusal");
  const r = store.readMemory("A").find((m) => m.key === "inspect").value;
  assert.equal(r.blocked.reason, "needs Full permission");
  const mem = store.readMemory("A");
  assert.equal(inspectDue(mem, NOW), false);
  assert.equal(inspectDue(mem, "2026-12-06T12:00:00Z"), false, "6 days later: still not");
  assert.equal(inspectDue(mem, "2026-12-08T12:00:00Z"), true, "after a week: asked again (access may have changed)");
  assert.match(inspectForAgents(r).note, /refused URL inspection.*do not guess/);
});

test("inspection job: Google's quota (429) stops the batch and keeps what was inspected; other errors are counted", async () => {
  const store = new MemoryStore(); store.writeMemory("A", [SC, AUDIT]);
  const g = google((u, n) => (n === 1 ? result("Submitted and indexed") : n === 2 ? jsonRes({ error: { code: 500, message: "backend" } }, 500) : jsonRes({ error: { code: 429, message: "Quota exceeded" } }, 429)));
  const out = await makeInspectHandler({ store, siteOf: async () => SITE, getToken: async () => "t", fetchImpl: g.fetchImpl, now: () => NOW })({ siteId: "A" });
  assert.match(out.evidence[0], /1 of 5 pages inspected today.*stopped at Google's quota.*1 could not be inspected/);
  const r = store.readMemory("A").find((m) => m.key === "inspect").value;
  assert.equal(r.lastBatch.stopped, "quota"); assert.equal(Object.keys(r.results).length, 1); assert.equal(r.blocked, null);
});

test("inspection job: waits for the snapshot (it names the property) and never runs without access", async () => {
  const store = new MemoryStore(); store.writeMemory("A", [AUDIT]);
  let tokens = 0;
  const wait = await makeInspectHandler({ store, siteOf: async () => SITE, getToken: async () => { tokens++; return "t"; }, fetchImpl: async () => { throw new Error("no call expected"); } })({ siteId: "A" });
  assert.match(wait.evidence[0], /waits for the first Search Console snapshot/);
  const off = await makeInspectHandler({ store, siteOf: async () => SITE, getToken: async () => { tokens++; return "t"; }, allowed: async () => false, fetchImpl: async () => { throw new Error("no call expected"); } })({ siteId: "A" });
  assert.match(off.evidence[0], /platform admin has not confirmed/);
  const noKey = await makeInspectHandler({ store, siteOf: async () => SITE, getToken: null })({ siteId: "A" });
  assert.match(noKey.evidence[0], /no Google key/);
  assert.equal(tokens, 0);
});

test("results stay bounded: important pages are always kept, otherwise the most recent", () => {
  const results = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`https://p.test/${i}`, { checkedAt: `2026-11-${String(10 + i).padStart(2, "0")}` }]));
  const kept = boundResults(results, new Set(["p.test/0"]), 3);
  assert.deepEqual(Object.keys(kept).sort(), ["https://p.test/0", "https://p.test/8", "https://p.test/9"]);
});

test("the router, the planner and the agents read the inspection (it was missing from hosted memory)", async () => {
  const insp = { kind: "report", key: "inspect", value: { generatedAt: NOW, property: "sc-domain:plumber.test", results: { "https://www.plumber.test/d": { checkedAt: NOW, coverage: "Crawled - currently not indexed", prev: { coverage: "Submitted and indexed" } } } } };
  const reports = plannerReports([insp, AUDIT, { kind: "report", key: "profile", value: { mode: "advise" } }]);
  assert.equal(reports.inspect["https://www.plumber.test/d"].coverage, "Crawled - currently not indexed");
  const plan = routeAgents({ profile: reports.profile, audit: reports.audit, inspect: reports.inspect });
  assert.ok(plan.steps.some((s) => s.agent === "seo-indexing-monitor" && s.evidence.some((e) => /\/d: Crawled/.test(e))));
  const data = JSON.parse(agentInput({ kind: "agent:seo-indexing-monitor", inputs: {}, title: "t" }, [insp], SITE).split("\n")[1]);
  assert.equal(data.indexStatus.notIndexed[0].was, "Submitted and indexed");
  // Planning: once a day, only with access, after the snapshot (priority 2).
  const store = new MemoryStore(); store.clock = () => NOW;
  const g = google();
  const handlers = { index_inspect: handler(store, g), priorities: makeHandlers({ store, siteOf: async () => SITE }).priorities };
  handlers.index_inspect.applies = async () => true;
  store.writeMemory("A", [SC, AUDIT]);
  const r = await tick({ store, sites: [SITE], handlers, now: NOW, maxJobs: 0 });
  assert.ok(r.sites[0].queued.some((q) => q.kind === "index_inspect"));
  assert.ok(r.sites[0].queued.some((q) => q.kind === "priorities"), "the ranking is planned once the snapshot exists (free)");
  handlers.index_inspect.applies = async () => false;
  const none = await tick({ store: new MemoryStore(), sites: [SITE], handlers, now: NOW, maxJobs: 0 });
  assert.ok(!none.sites[0].queued.some((q) => q.kind === "index_inspect"), "no access: never planned");
});
