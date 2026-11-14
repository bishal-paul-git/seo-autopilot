// Fast reaction and search history (D57): a bounded history from the daily Search Console snapshot, the CLI's priority
// engine on hosted data, a pure alert detector with clear thresholds and small-data guards, and the planner queuing the
// matching specialist for the same day (within the budget and approval rules). No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeHistory, weekOverWeek, rankFromHistory, historyForAgents, isoWeek, HISTORY_DAYS, HISTORY_WEEKS, HISTORY_KEYS } from "../src/analysis/search-history.mjs";
import { detectAlerts, unhandledAlerts, ALERT_RULES, urlKey } from "../src/analysis/alerts.mjs";
import { prioritiesFrom, speedResults, plannerReports, prioritiesForAgents } from "../src/god/insights.mjs";
import { reportMemory } from "../src/god/handlers.mjs";
import { routeAgents } from "../src/analysis/agent-router.mjs";
import { planSite } from "../src/god/planner.mjs";
import { agentInput } from "../src/god/agent-runner.mjs";
import { MemoryStore } from "../src/god/stores.mjs";
import { tick } from "../src/god/tick.mjs";

const NOW = "2026-11-30T12:00:00Z", SITE = { id: "A", name: "P", url: "https://plumber.test/" };
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** Daily rows ending `to`: `days` days, the last 7 with `recent` clicks and the 7 before with `before` clicks. */
const dailyRows = (to, { recent = 10, before = 10, days = 14 } = {}) => Array.from({ length: days }, (_, i) => ({ date: addDays(to, -i), clicks: i < 7 ? recent : before, impressions: 200, position: 8 }));
const historyOf = (opts) => mergeHistory(null, { daily: dailyRows("2026-11-27", opts), now: NOW });
const SC = { to: "2026-11-27", from: "2026-10-31", property: "sc-domain:plumber.test", totals: { clicks: 400, impressions: 9000, position: 9 },
  pages: [{ url: "https://plumber.test/", clicks: 200, impressions: 3000, position: 3 }, { url: "https://plumber.test/boilers", clicks: 120, impressions: 4000, position: 6 }, { url: "https://plumber.test/old", clicks: 0, impressions: 3, position: 40 }],
  queries: [{ query: "boiler repair leeds", clicks: 50, impressions: 900, position: 6 }],
  pairs: [{ url: "https://plumber.test/boilers", query: "boiler repair leeds", clicks: 50, impressions: 900, position: 6.2 }, { url: "https://plumber.test/boilers", query: "combi boiler service", clicks: 2, impressions: 400, position: 12 }] };

test("history: daily totals and weekly points per query and page, bounded in size; a re-fetched day replaces the saved one", () => {
  let h = mergeHistory(null, { daily: dailyRows("2026-11-27", { days: 200 }), snapshot: SC, now: NOW });
  assert.equal(Object.keys(h.daily).length, HISTORY_DAYS, "at most 120 days");
  assert.deepEqual(h.weeks[isoWeek("2026-11-27T00:00:00Z")].pages["https://plumber.test/boilers"], [120, 4000, 6]);
  h = mergeHistory(h, { daily: [{ date: "2026-11-27", clicks: 99, impressions: 1, position: 2.04 }], now: NOW });
  assert.deepEqual(h.daily["2026-11-27"], [99, 1, 2]);
  for (let w = 1; w <= 20; w++) h = mergeHistory(h, { snapshot: { ...SC, to: addDays("2026-11-27", 7 * w), queries: Array.from({ length: 80 }, (_, i) => ({ query: `q${i}`, clicks: 80 - i, impressions: 100, position: 5 })) }, now: NOW });
  assert.equal(Object.keys(h.weeks).length, HISTORY_WEEKS, "at most 9 weekly points");
  assert.equal(Object.keys(Object.values(h.weeks).at(-1).queries).length, HISTORY_KEYS, "top 30 queries per week");
  assert.ok(JSON.stringify(h).length < 60_000, `bounded: ${JSON.stringify(h).length} bytes`);
});

test("history: week over week from daily totals; query movers in the rank tracker's shape; agents get a bounded view", () => {
  const w = weekOverWeek(historyOf({ recent: 5, before: 10 }));
  assert.deepEqual([w.to, w.now.clicks, w.prev.clicks, w.clicksChange], ["2026-11-27", 35, 70, -0.5]);
  assert.equal(weekOverWeek(null), null);
  let h = mergeHistory(null, { snapshot: SC, now: NOW });
  assert.equal(rankFromHistory(h), null, "one week: nothing to compare");
  h = mergeHistory(h, { snapshot: { ...SC, to: "2026-12-04", queries: [{ query: "boiler repair leeds", clicks: 30, impressions: 900, position: 9.5 }] }, now: NOW });
  const r = rankFromHistory(h);
  assert.equal(r.summary.losers[0].query, "boiler repair leeds"); assert.equal(r.summary.losers[0].change, -3.5);
  assert.match(r.basis, /28-day windows ending 2026-11-27 and 2026-12-04/);
  const view = historyForAgents(mergeHistory(h, { daily: dailyRows("2026-12-01", { days: 60 }), now: NOW }));
  assert.equal(view.daily.length, 28); assert.equal(view.movers.losers.length, 1); assert.match(view.note, /damped/);
});

test("detector: clicks down 30% or more week over week, only with enough clicks and enough days", () => {
  const drop = detectAlerts({ siteUrl: SITE.url, history: historyOf({ recent: 6, before: 10 }), now: NOW });
  assert.equal(drop.length, 1); assert.equal(drop[0].kind, "clicks_drop"); assert.equal(drop[0].agent, "seo-serp-analyst");
  assert.match(drop[0].title, /fell 40%/); assert.match(drop[0].evidence[0], /42 vs 70/);
  assert.equal(detectAlerts({ history: historyOf({ recent: 8, before: 10 }), now: NOW }).length, 0, "-20% is normal movement");
  assert.equal(detectAlerts({ history: historyOf({ recent: 2, before: 5 }), now: NOW }).length, 0, `small site: under ${ALERT_RULES.minClicks} clicks the week before is noise`);
  assert.equal(detectAlerts({ history: historyOf({ recent: 0, before: 10, days: 10 }), now: NOW }).length, 0, "too few days in the earlier week");
});

test("detector: an important page Google had indexed is now not indexed (reported once, when it changes); new blocks", () => {
  const sc = SC, at = NOW;
  const inspect = (results) => ({ generatedAt: at, results });
  const was = { coverage: "Submitted and indexed", verdict: "PASS", checkedAt: "2026-11-20T00:00:00Z" };
  const lost = detectAlerts({ siteUrl: SITE.url, searchConsole: sc, now: NOW, inspect: inspect({ "https://plumber.test/boilers/": { checkedAt: at, coverage: "Crawled - currently not indexed", verdict: "NEUTRAL", prev: was } }) });
  assert.deepEqual(lost.map((a) => [a.kind, a.agent]), [["deindexed", "seo-indexing-monitor"]]);
  assert.match(lost[0].evidence[0], /\/boilers\/: was "Submitted and indexed" on 2026-11-20, now "Crawled - currently not indexed"/);
  assert.equal(detectAlerts({ siteUrl: SITE.url, searchConsole: sc, now: NOW, inspect: inspect({ "https://plumber.test/old": { checkedAt: at, coverage: "Crawled - currently not indexed", prev: was } }) }).length, 0, "an unimportant page is not an alarm");
  assert.equal(detectAlerts({ siteUrl: SITE.url, searchConsole: sc, now: NOW, inspect: inspect({ "https://plumber.test/boilers": { checkedAt: at, coverage: "Crawled - currently not indexed" } }) }).length, 0, "first inspection: nothing to compare");
  assert.equal(detectAlerts({ siteUrl: SITE.url, searchConsole: sc, now: NOW, inspect: { generatedAt: at, results: { "https://plumber.test/boilers": { checkedAt: "2026-11-25T00:00:00Z", coverage: "Crawled - currently not indexed", prev: was } } } }).length, 0, "an older batch was already reported");
  assert.equal(detectAlerts({ siteUrl: SITE.url, searchConsole: sc, now: NOW, inspect: inspect({ "https://plumber.test/boilers": { checkedAt: at, coverage: "Page with redirect", prev: was } }) }).length, 0, "a redirect is intentional");
  const blocked = detectAlerts({ siteUrl: SITE.url, searchConsole: sc, now: NOW, inspect: inspect({ "https://plumber.test/": { checkedAt: at, coverage: "Excluded by 'noindex' tag", indexing: "BLOCKED_BY_META_TAG", prev: was } }) });
  assert.deepEqual(blocked.map((a) => [a.kind, a.agent]), [["blocked", "seo-technical-fixer"]], "a block is the technical fixer's, not a plain index drop");
});

test("detector: new server and client errors and new noindex or robots blocks on important pages since the previous scan", () => {
  const prevAudit = { generatedAt: "2026-11-28T09:00:00Z", issues: [{ rule: "status-error", url: "https://plumber.test/old", detail: "HTTP 404" }] };
  const cur = { generatedAt: "2026-11-30T09:00:00Z", summary: {}, issues: [
    { rule: "status-error", severity: "high", url: "https://plumber.test/boilers", detail: "HTTP 503" }, { rule: "status-error", severity: "high", url: "https://plumber.test/old", detail: "HTTP 404" },
    { rule: "noindex-in-sitemap", severity: "high", url: "https://plumber.test/" }], pages: [] };
  // The scan handler keeps the previous scan's errors and blocks with the new audit.
  const audit = reportMemory({ audit: cur }, { ...prevAudit, issues: [...prevAudit.issues, { rule: "title-missing", url: "x" }] })[0].value;
  assert.deepEqual(audit.previous.issues.map((i) => i.rule), ["status-error"], "only the watched findings travel");
  assert.equal(audit.issues[0].detail, "HTTP 503", "the status code is kept for status errors");
  const a = detectAlerts({ siteUrl: SITE.url, searchConsole: SC, audit, now: NOW });
  assert.deepEqual(a.map((x) => [x.kind, x.agent]).sort(), [["blocked", "seo-technical-fixer"], ["server_errors", "seo-technical-fixer"]]);
  assert.match(a.find((x) => x.kind === "server_errors").evidence[0], /\/boilers: HTTP 503 \(scan of 2026-11-30 vs 2026-11-28\)/);
  assert.equal(detectAlerts({ siteUrl: SITE.url, searchConsole: SC, audit: reportMemory({ audit: cur })[0].value, now: NOW }).length, 0, "the first scan raises nothing");
  const four = reportMemory({ audit: { ...cur, issues: [{ rule: "status-error", severity: "high", url: "https://plumber.test/boilers", detail: "HTTP 410" }] } }, prevAudit)[0].value;
  assert.equal(detectAlerts({ siteUrl: SITE.url, searchConsole: SC, audit: four, now: NOW })[0].agent, "seo-redirect-guardian", "a 4xx goes to the redirect guardian");
  const all = reportMemory({ audit: { ...cur, issues: [{ rule: "robots-blocks-all", severity: "high", url: "plumber.test" }] } }, prevAudit)[0].value;
  assert.match(detectAlerts({ siteUrl: SITE.url, audit: all, now: NOW })[0].evidence[0], /robots\.txt blocks the whole site/);
  // A crawl's own pages (local scan) or the scan function's signals give noindex beyond the sitemap.
  const sig = reportMemory({ audit: { ...cur, issues: [], pages: [{ url: "https://plumber.test/boilers", status: 200, noindex: true }] } }, prevAudit)[0].value;
  assert.deepEqual(sig.signals.noindex, ["https://plumber.test/boilers"]);
  assert.equal(detectAlerts({ siteUrl: SITE.url, searchConsole: SC, audit: sig, now: NOW })[0].kind, "blocked");
  assert.equal(urlKey("https://www.Plumber.test/a/?x=1"), "plumber.test/a");
});

test("handled alerts: not twice within the cooldown, and not while the same specialist is about to run", () => {
  const al = [{ id: "clicks_drop:site", kind: "clicks_drop", agent: "seo-serp-analyst" }];
  assert.equal(unhandledAlerts(al, [{ kind: "agent:seo-serp-analyst", status: "completed", inputs: { alerts: ["clicks_drop:site"] }, createdAt: "2026-11-27T00:00:00Z" }], NOW).length, 0);
  assert.equal(unhandledAlerts(al, [{ kind: "agent:seo-serp-analyst", status: "completed", inputs: { alerts: ["clicks_drop:site"] }, createdAt: "2026-11-20T00:00:00Z" }], NOW).length, 1, "after 7 days it may fire again");
  assert.equal(unhandledAlerts(al, [{ kind: "agent:seo-serp-analyst", status: "queued", inputs: {} }], NOW).length, 0, "a queued weekly run reads the same data");
  assert.equal(unhandledAlerts(al, [{ kind: "agent:seo-serp-analyst", status: "awaiting_approval", inputs: {} }], NOW).length, 1, "a run waiting for a person does not hold back an alert");
});

test("priorities: the CLI's engine on hosted data (snapshot pairs, inspection, phone speed); router and agents read it", () => {
  const speed = { generatedAt: NOW, pages: [{ url: "https://plumber.test/", score: 31, lab: { lcpMs: 6100 }, field: { lcpMs: 4600, inpMs: 150, cls: 0.02 } }, { url: "https://plumber.test/b", error: "timeout" }] };
  const sr = speedResults(speed);
  assert.deepEqual([sr.results[0].rating, sr.results[0].score, sr.results[0].field.lcp], ["poor", 31, 4600]);
  const p = prioritiesFrom({ siteUrl: SITE.url, searchConsole: SC, audit: { generatedAt: NOW, issues: [{ rule: "title-missing", severity: "high", url: "https://plumber.test/x" }] },
    inspect: { results: { "https://plumber.test/new": { coverage: "Discovered - currently not indexed" } } }, speed, now: NOW });
  const ids = p.items.map((i) => i.id);
  assert.ok(ids.includes("audit:title-missing") && ids.includes("indexing:request") && ids.includes("speed:poor"), ids.join());
  assert.ok(ids.some((i) => i.startsWith("strike:")), "striking distance from the page + query pairs");
  assert.ok(!ids.some((i) => i.startsWith("gap:")), "no content gaps on hosted data: they need page titles the scan does not keep");
  assert.ok(p.basis.some((b) => /Search Console 2026-10-31 to 2026-11-27/.test(b)));
  assert.equal(prioritiesFrom({}), null, "nothing to rank");
  const memory = [{ kind: "report", key: "priorities", value: p }, { kind: "report", key: "speed", value: speed }, { kind: "report", key: "profile", value: { mode: "advise" } }];
  const reports = plannerReports(memory);
  const plan = routeAgents({ profile: reports.profile, priorities: reports.priorities, speed: reports.speed });
  assert.ok(plan.steps.some((s) => s.agent === "seo-performance-fixer" && s.evidence.some((e) => /\/: 31/.test(e))), "speed reaches the router");
  assert.ok(plan.steps.some((s) => s.agent === "seo-indexing-monitor"), "priorities reach the router");
  const data = JSON.parse(agentInput({ kind: "agent:seo-strategist", inputs: {}, title: "t" }, memory, SITE).split("\n")[1]);
  assert.ok(data.priorities.items.length <= 10 && data.priorities.items[0].evidence, "agents get the top items with evidence");
  assert.equal(prioritiesForAgents(null), null);
});

test("planner: an alert queues its specialist for TODAY (day period), ahead of the weekly work, merged per specialist", () => {
  const alerts = [{ id: "deindexed:a", kind: "deindexed", agent: "seo-indexing-monitor", title: "1 important page dropped out of Google's index", evidence: ["/a: was indexed"] },
    { id: "clicks_drop:site", kind: "clicks_drop", agent: "seo-serp-analyst", title: "Clicks fell 40% week over week", evidence: ["42 vs 70"] }];
  const p = planSite({ site: SITE, reports: { audit: { generatedAt: NOW, issues: [] }, profile: { mode: "advise" } }, strategy: { status: "approved" }, alerts, now: NOW });
  const a = p.jobs.find((j) => j.idempotencyKey === "agent:seo-indexing-monitor:2026-11-30");
  assert.ok(a, p.jobs.map((j) => j.idempotencyKey).join());
  assert.equal(a.priority, 1); assert.deepEqual(a.inputs.alerts, ["deindexed:a"]); assert.match(a.why, /^Alert: 1 important page dropped/);
  assert.deepEqual(a.inputs.evidence, ["/a: was indexed"]);
  assert.equal(p.jobs[0].priority, 1, "alerts come first");
  assert.equal(planSite({ site: SITE, reports: {}, strategy: { status: "none" }, alerts, now: NOW }).jobs.filter((j) => j.inputs?.alerts).length, 0, "no strategy: no specialist runs, alert or not");
});

test("tick: a sudden drop runs the specialist the same day within the budget; not again within the cooldown; the weekly run is not doubled", async () => {
  const store = new MemoryStore(); store.clock = () => NOW;
  store.writeMemory("A", [{ kind: "strategy", key: "initial", value: { status: "approved" }, basis: "verified" },
    { kind: "report", key: "audit", value: { generatedAt: NOW, summary: {}, issues: [] }, basis: "verified" }, { kind: "report", key: "profile", value: { mode: "advise" }, basis: "inferred" },
    { kind: "report", key: "history", value: historyOf({ recent: 4, before: 10 }), basis: "verified" }]);
  const ran = [];
  const handlers = { "agent:*": async (job) => { ran.push(job.kind); return { evidence: ["read the data"], costUsd: 0.2 }; } };
  const r = await tick({ store, sites: [SITE], handlers, now: NOW, dailyBudgetUsd: 1, agentRunUsd: 0.5, maxJobs: 1 });
  assert.deepEqual(r.sites[0].alerts.map((a) => a.kind), ["clicks_drop"]);
  const job = store.listJobs("A").find((j) => j.inputs?.alerts);
  assert.equal(job.kind, "agent:seo-serp-analyst"); assert.equal(job.idempotencyKey, "agent:seo-serp-analyst:2026-11-30");
  assert.deepEqual(ran, ["agent:seo-serp-analyst"], "the alert job runs first, the same day");
  assert.ok(r.sites[0].deferred.some((d) => /over today's budget/.test(d.reason)), "the daily budget still applies");
  // The next tick the same day: no second alert job, and the specialist's weekly run is not added on top.
  const again = await tick({ store, sites: [SITE], handlers, now: "2026-11-30T18:00:00Z", dailyBudgetUsd: 5, agentRunUsd: 0.5, maxJobs: 0 });
  assert.equal(again.sites[0].alerts.length, 0, "handled within the cooldown");
  assert.equal(store.listJobs("A").filter((j) => j.kind === "agent:seo-serp-analyst").length, 1);
  // Before a strategy is approved, alerts never queue work.
  const fresh = new MemoryStore(); fresh.clock = () => NOW;
  fresh.writeMemory("A", [{ kind: "report", key: "history", value: historyOf({ recent: 4, before: 10 }), basis: "verified" }, { kind: "report", key: "audit", value: { generatedAt: NOW, issues: [] }, basis: "verified" }]);
  const none = await tick({ store: fresh, sites: [SITE], handlers, now: NOW, maxJobs: 0 });
  assert.equal(none.sites[0].alerts.length, 0);
});

test("tick: gated specialists still wait for the agency when an alert queues them (D17)", async () => {
  const store = new MemoryStore(); store.clock = () => NOW;
  const prev = { generatedAt: "2026-11-28T09:00:00Z", issues: [] };
  const audit = reportMemory({ audit: { generatedAt: NOW, summary: {}, issues: [{ rule: "status-error", severity: "high", url: "https://plumber.test/", detail: "HTTP 500" }], pages: [] } }, prev)[0].value;
  store.writeMemory("A", [{ kind: "strategy", key: "initial", value: { status: "approved" }, basis: "verified" }, { kind: "report", key: "audit", value: audit, basis: "verified" }, { kind: "report", key: "profile", value: { mode: "advise" }, basis: "inferred" }]);
  const r = await tick({ store, sites: [SITE], handlers: { "agent:*": async () => ({ evidence: [], costUsd: 0 }) }, now: NOW, dailyBudgetUsd: 5, maxJobs: 0 });
  const j = store.listJobs("A").find((x) => x.inputs?.alerts);
  assert.equal(j.kind, "agent:seo-technical-fixer"); assert.equal(j.status, "awaiting_approval", "high-risk specialist: a person approves before it runs");
  assert.ok(r.sites[0].waiting.some((w) => w.job === j.id));
});
