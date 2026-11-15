// Per-change scorecard (D58): completed advice and merged changes are scored on Search Console clicks, impressions, CTR
// and position, 14 and 28 days before vs after, against the rest of the site; small pages say "not enough data"; the
// baseline and finished windows are frozen on the entry so the daily prune cannot lose them. Mocked Google; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, windowsOf, judge, pagesOf, newEntries, entryDue, scoreEntry, summarise, overall, queryRange, dataThrough, addDays, RULES } from "../src/analysis/scorecard.mjs";
import { makeScorecardHandler, scorecardRows, scorecardDue, pageFilter } from "../src/god/scorecard.mjs";
import { MemoryStore } from "../src/god/stores.mjs";
import { tick } from "../src/god/tick.mjs";

const SITE = { id: "A", name: "Plumber", url: "https://www.plumber.test/" };
const jsonRes = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
/** A daily series from `from` for `n` days, each day [clicks, impressions, position]. */
const series = (from, n, c, i, p = 8) => Object.fromEntries(Array.from({ length: n }, (_, k) => [addDays(from, k), [c, i, p]]));

test("windows: N days before the change, N days after it starting 3 days later; aggregates weight position by impressions", () => {
  assert.deepEqual(windowsOf("2026-10-01", 14), { before: ["2026-09-17", "2026-09-30"], after: ["2026-10-04", "2026-10-17"] });
  const a = aggregate({ "2026-01-01": [2, 100, 4], "2026-01-02": [0, 300, 8] }, "2026-01-01", "2026-01-05");
  assert.deepEqual(a, { clicks: 2, impressions: 400, ctr: 0.005, position: 7, days: 2 });
  assert.equal(dataThrough("2026-11-15T10:00:00Z"), "2026-11-12");
});

test("judge: win, loss and flat on clicks, allowing for the rest of the site; impressions when clicks are few; small pages are not judged", () => {
  const b = { clicks: 40, impressions: 1000, ctr: 0.04, position: 8, days: 14 };
  assert.equal(judge(b, { ...b, clicks: 60, ctr: 0.06 }, 14).label, "win");
  assert.equal(judge(b, { ...b, clicks: 25 }, 14).label, "loss");
  assert.equal(judge(b, { ...b, clicks: 43 }, 14).label, "flat");
  // The whole site rose 50%: +50% on the page is only keeping up.
  const rest = { before: { clicks: 1000, impressions: 20000, days: 14 }, after: { clicks: 1500, impressions: 30000, days: 14 } };
  const v = judge(b, { ...b, clicks: 60 }, 14, rest);
  assert.equal(v.label, "flat"); assert.equal(v.siteChange, 0.5); assert.match(v.reason, /rest of the site \+50%/);
  // The site fell 40% and the page held: that is a win.
  assert.equal(judge(b, { ...b, clicks: 40 }, 14, { before: rest.before, after: { clicks: 600, impressions: 12000, days: 14 } }).label, "win");
  // Fewer than 20 clicks in both windows: judged on impressions, and says so.
  const few = judge({ clicks: 3, impressions: 400, ctr: 0.0075, position: 12, days: 14 }, { clicks: 4, impressions: 700, ctr: 0.0057, position: 9, days: 14 }, 14);
  assert.equal(few.metric, "impressions"); assert.equal(few.label, "win"); assert.match(few.reason, /judged on impressions/);
  // A tiny absolute difference is never a win, however large the percentage.
  assert.equal(judge({ clicks: 10, impressions: 200, days: 14 }, { clicks: 13, impressions: 210, days: 14 }, 14).label, "flat");
  // Too small in both windows.
  const small = judge({ clicks: 1, impressions: 30, days: 5 }, { clicks: 4, impressions: 40, days: 6 }, 14);
  assert.equal(small.label, "not_enough_data"); assert.match(small.reason, /Fewer than 50 impressions/);
  assert.equal(judge({ clicks: 1, impressions: 60, days: 9 }, { clicks: 2, impressions: 90, days: 9 }, 28).label, "not_enough_data", "28 days needs 100");
  assert.equal(RULES.threshold, 0.15);
});

test("entries: accepted advice and merged changes on the site's own pages; an implementation replaces its advice; old or foreign pages ignored", () => {
  const advice = { id: "j1", kind: "agent:seo-snippet-optimizer", status: "completed", updatedAt: "2026-10-01T09:00:00Z", title: "Titles",
    outputs: { proposal: { recommendations: [{ title: "a", url: "https://plumber.test/boilers" }, { title: "b", url: "https://evil.test/x" }, { title: "c", url: "javascript:alert(1)" }, { title: "d", url: null }, { title: "e", url: "https://www.plumber.test/boilers" }] } } };
  assert.deepEqual(pagesOf(advice, SITE.url), ["https://plumber.test/boilers", "https://www.plumber.test/boilers"]);
  const impl = { id: "j2", kind: "implement", status: "completed", updatedAt: "2026-10-12T00:00:00Z", inputs: { sourceJob: "j1", recommendation: { title: "Rewrite the boilers title" } },
    outputs: { deploy: { url: "https://www.plumber.test/boilers", mergedAt: "2026-10-10T15:00:00Z", prUrl: "https://github.com/a/b/pull/7" } } };
  const open = { id: "j3", kind: "agent:seo-x", status: "awaiting_approval", outputs: advice.outputs };
  const ancient = { ...advice, id: "j4", updatedAt: "2025-01-01T00:00:00Z" };
  const rows = newEntries([advice, impl, open, ancient], new Map(), SITE.url, "2026-10-20T00:00:00Z");
  const by = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  assert.deepEqual(Object.keys(by).sort(), ["job:j1", "job:j2"]);
  assert.equal(by["job:j1"].changedAt, "2026-10-01"); assert.equal(by["job:j1"].basis, "advice accepted"); assert.equal(by["job:j1"].supersededBy, "j2");
  assert.equal(by["job:j2"].changedAt, "2026-10-10"); assert.equal(by["job:j2"].basis, "change merged"); assert.equal(by["job:j2"].title, "Rewrite the boilers title");
  assert.equal(by["job:j2"].pr, "https://github.com/a/b/pull/7");
  // Already on the scorecard: nothing new.
  assert.equal(newEntries([advice], new Map([["job:j1", by["job:j1"]]]), SITE.url, "2026-10-20T00:00:00Z").length, 0);
  assert.deepEqual(summarise(Object.values(by)), { win: 0, loss: 0, flat: 0, too_early: 1, not_enough_data: 0, total: 1 }, "superseded advice is not counted");
});

test("scoring: baseline frozen when it is in Search Console, too early until each window completes, then frozen; survives losing the data", () => {
  const e0 = { job: "j1", pages: ["https://plumber.test/boilers"], changedAt: "2026-10-01", status: "open", windows: {} };
  assert.equal(entryDue(e0, "2026-09-29"), false, "the day before the change is not in Search Console yet");
  assert.equal(entryDue(e0, "2026-09-30"), true);
  assert.deepEqual(queryRange(e0, "2026-11-30"), { from: "2026-09-03", to: "2026-10-31" });
  // Page: 3 clicks / 100 impressions a day before, 5 / 120 after. Site: 50 / 2000 a day throughout.
  const s = { ...series("2026-09-03", 28, 3, 100, 9), ...series("2026-10-04", 28, 5, 120, 7) };
  const site = series("2026-08-01", 100, 50, 2000);
  const e1 = scoreEntry(e0, { series: s, siteDaily: site, through: "2026-10-05", now: "2026-10-08T00:00:00Z", property: "sc-domain:plumber.test" });
  assert.equal(e1.baseline[14].clicks, 42); assert.equal(e1.baseline[28].impressions, 2800); assert.equal(e1.baseline.property, "sc-domain:plumber.test");
  assert.equal(e1.windows[14].label, "too_early"); assert.equal(e1.windows[14].readyOn, "2026-10-21"); assert.equal(e1.label, "too_early");
  // 14-day window complete: a win (+67% clicks while the rest of the site was flat); the 28-day one is still too early.
  const e2 = scoreEntry(e1, { series: s, siteDaily: site, through: "2026-10-17", now: "2026-10-20T00:00:00Z" });
  assert.equal(e2.windows[14].label, "win"); assert.ok(e2.windows[14].final); assert.equal(e2.windows[14].after.clicks, 70);
  assert.ok(e2.windows[14].siteChange < 0 && e2.windows[14].siteChange > -0.1, "the rest of the site is the site minus the page"); assert.equal(e2.windows[28].label, "too_early"); assert.equal(e2.label, "win"); assert.equal(e2.status, "open");
  assert.ok(entryDue(e2, "2026-10-31")); assert.ok(!entryDue(e2, "2026-10-30"));
  // Later the page data is gone (pruned, property lost): the frozen baseline and 14-day verdict stay; the 28-day window uses
  // only what the new query returns, and the entry closes.
  const e3 = scoreEntry(e2, { series: series("2026-10-04", 28, 5, 120, 7), siteDaily: {}, through: "2026-10-31", now: "2026-11-03T00:00:00Z" });
  assert.equal(e3.windows[14].label, "win"); assert.equal(e3.windows[14].at, "2026-10-20T00:00:00Z", "frozen");
  assert.equal(e3.windows[28].before.clicks, 84, "baseline from the frozen copy"); assert.equal(e3.windows[28].label, "win");
  assert.match(e3.windows[28].reason, /no comparison with the rest of the site/);
  assert.equal(e3.status, "closed"); assert.equal(overall(e3), "win"); assert.ok(!entryDue(e3, "2026-12-31"));
  assert.deepEqual(summarise([e3, e1]), { win: 1, loss: 0, flat: 0, too_early: 1, not_enough_data: 0, total: 2 });
});

test("the scorecard job: one query per due change for the bound property, filtered to its pages; frozen on the entry", async () => {
  const store = new MemoryStore();
  const entry = { job: "j1", pages: ["https://plumber.test/a", "https://plumber.test/a.b"], changedAt: "2026-10-01", status: "open", windows: {} };
  const closed = { job: "j0", pages: ["https://plumber.test/z"], changedAt: "2026-08-01", status: "closed", windows: {} };
  store.writeMemory("A", [{ kind: "scorecard", key: "job:j1", value: entry }, { kind: "scorecard", key: "job:j0", value: closed },
    { kind: "report", key: "history", value: { daily: series("2026-08-01", 100, 50, 2000) } }]);
  const calls = [];
  const fetchImpl = async (url, o) => { calls.push({ url, b: JSON.parse(o.body), auth: o.headers.Authorization });
    return jsonRes({ rows: Object.entries({ ...series("2026-09-03", 28, 0, 40), ...series("2026-10-04", 28, 0, 30) }).map(([d, v]) => ({ keys: [d], clicks: v[0], impressions: v[1], position: v[2] })) }); };
  const h = makeScorecardHandler({ store, getToken: async () => "sa", fetchImpl, now: () => "2026-11-15T10:00:00Z", boundOf: async () => ({ gscProperty: "sc-domain:plumber.test" }), api: "https://g.test/webmasters/v3" });
  const r = await h({ siteId: "A" });
  assert.equal(calls.length, 1, "the closed entry is not read again");
  assert.equal(calls[0].url, "https://g.test/webmasters/v3/sites/sc-domain%3Aplumber.test/searchAnalytics/query");
  assert.equal(calls[0].auth, "Bearer sa");
  assert.deepEqual(calls[0].b.dimensions, ["date"]); assert.equal(calls[0].b.startDate, "2026-09-03"); assert.equal(calls[0].b.endDate, "2026-10-31");
  assert.deepEqual(calls[0].b.dimensionFilterGroups[0].filters[0], { dimension: "page", operator: "includingRegex", expression: "^(https://plumber\\.test/a|https://plumber\\.test/a\\.b)$" });
  const v = store.readMemory("A", "scorecard").find((m) => m.key === "job:j1").value;
  assert.equal(v.windows[28].label, "loss", "impressions fell 25% while the site was flat (too few clicks to judge on clicks)");
  assert.equal(v.windows[28].metric, "impressions"); assert.equal(v.status, "closed");
  assert.match(r.evidence[0], /1 change measured, 1 with a finished window/);
  assert.deepEqual(pageFilter(["https://p.test/x"]), { dimension: "page", operator: "equals", expression: "https://p.test/x" });
  // Nothing due, no property, no access: no Google call.
  calls.length = 0;
  assert.match((await h({ siteId: "A" })).evidence[0], /nothing to measure/);
  const unbound = makeScorecardHandler({ store: new MemoryStore(), getToken: async () => "sa", fetchImpl, allowed: async () => true });
  assert.match((await unbound({ siteId: "B" })).evidence[0], /waits for the first Search Console snapshot/);
  const refused = makeScorecardHandler({ store, getToken: async () => "sa", fetchImpl, allowed: async () => false });
  assert.match((await refused({ siteId: "A" })).evidence[0], /platform admin has not confirmed/);
  assert.equal(calls.length, 0);
});

test("a refused read stops the batch and changes nothing", async () => {
  const store = new MemoryStore();
  const e = (id) => ({ job: id, pages: ["https://plumber.test/a"], changedAt: "2026-10-01", status: "open", windows: {} });
  store.writeMemory("A", [{ kind: "scorecard", key: "job:a", value: e("a") }, { kind: "scorecard", key: "job:b", value: e("b") }]);
  let n = 0;
  const h = makeScorecardHandler({ store, getToken: async () => "sa", fetchImpl: async () => { n++; return jsonRes({ error: { message: "no permission" } }, 403); }, now: () => "2026-11-15T10:00:00Z", boundOf: async () => ({ gscProperty: "sc-domain:plumber.test" }) });
  const r = await h({ siteId: "A" });
  assert.equal(n, 1); assert.match(r.evidence[0], /0 changes measured, 0 with a finished window; 1 not read \(no permission\)/);
  assert.ok(!store.readMemory("A", "scorecard").some((m) => m.value.baseline));
});

test("planning: completed advice goes on the scorecard at once; the job is planned only when something is due and Google is connected", async () => {
  const store = new MemoryStore();
  store.createJob({ siteId: "A", kind: "agent:seo-snippet-optimizer", title: "Titles", inputs: {}, status: "completed", updatedAt: "2026-10-01T09:00:00Z",
    outputs: { proposal: { recommendations: [{ title: "Shorter title", url: "https://www.plumber.test/boilers" }] } } });
  const handlers = { scorecard: async () => ({ evidence: [] }) };
  handlers.scorecard.applies = async () => true;
  let r = await tick({ store, sites: [SITE], handlers, now: "2026-10-02T12:00:00Z", maxJobs: 0 });
  const card = store.readMemory("A", "scorecard");
  assert.equal(card.length, 1); assert.equal(card[0].value.changedAt, "2026-10-01"); assert.deepEqual(card[0].value.pages, ["https://www.plumber.test/boilers"]);
  assert.ok(!r.sites[0].queued.some((q) => q.kind === "scorecard"), "the day before the change is not in Search Console yet");
  r = await tick({ store, sites: [SITE], handlers, now: "2026-10-04T12:00:00Z", maxJobs: 0 });
  assert.ok(r.sites[0].queued.some((q) => q.kind === "scorecard"), "baseline can be frozen now");
  assert.equal(store.readMemory("A", "scorecard").length, 1, "never added twice");
  assert.ok(scorecardDue(store.readMemory("A"), "2026-10-04T12:00:00Z"));
  assert.equal(scorecardRows(SITE, store.readMemory("A"), store.listJobs("A"), "2026-10-04T12:00:00Z").length, 0);
  handlers.scorecard.applies = async () => false;
  const s2 = new MemoryStore(); s2.writeMemory("A", store.readMemory("A"));
  r = await tick({ store: s2, sites: [SITE], handlers, now: "2026-10-04T12:00:00Z", maxJobs: 0 });
  assert.ok(!r.sites[0].queued.some((q) => q.kind === "scorecard"), "no Google access: never planned");
});

test("planning carries on when the database refuses scorecard entries (before the migration)", async () => {
  const store = new MemoryStore();
  store.createJob({ siteId: "A", kind: "agent:seo-x", title: "T", inputs: {}, status: "completed", updatedAt: "2026-10-01T09:00:00Z", outputs: { proposal: { recommendations: [{ title: "x", url: "https://plumber.test/a" }] } } });
  const write = store.writeMemory.bind(store);
  store.writeMemory = (id, items) => { if (items.some((i) => i.kind === "scorecard")) throw new Error("violates check constraint site_memory_kind_check"); return write(id, items); };
  const r = await tick({ store, sites: [SITE], handlers: {}, now: "2026-10-04T12:00:00Z", maxJobs: 0 });
  assert.equal(r.sites[0].error, undefined); assert.match(r.sites[0].scorecardError, /site_memory_kind_check/);
});
