// Search Console for the agents (D47): a daily 28-day snapshot (totals, pages, queries) stored in site memory, planned
// once a day only when the Google key and the platform admin's confirmation exist, and passed to every agent with a
// plain note on what a missing page means. Mocked Google; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSearchSnapshotHandler, snapshotDue, searchForAgents, SNAPSHOT_PAGES } from "../src/god/search-console.mjs";
import { agentInput } from "../src/god/agent-runner.mjs";
import { MemoryStore } from "../src/god/stores.mjs";
import { tick } from "../src/god/tick.mjs";

const NOW = "2026-11-30T12:00:00Z";
const SITE = { id: "A", name: "P", url: "https://www.plumber.test/" };

function google({ access = "domain", pages = 3 } = {}) {
  const calls = [];
  const fetchImpl = async (url, o) => {
    const prop = decodeURIComponent(url.split("/sites/")[1].split("/")[0]), b = JSON.parse(o.body); calls.push({ prop, b });
    if (access === "none" || (access === "prefix" && prop.startsWith("sc-domain:"))) return new Response(JSON.stringify({ error: { message: "no permission" } }), { status: 403 });
    const dim = (b.dimensions || [])[0];
    const rows = !dim ? [{ keys: [], clicks: 40, impressions: 2000, ctr: 0.02, position: 18.234 }]
      : dim === "page" ? Array.from({ length: pages }, (_, i) => ({ keys: [`https://www.plumber.test/p${i}`], clicks: 10 - i, impressions: 500 - i, ctr: 0.0123456, position: 12.34 }))
        : [{ keys: ["boiler repair leeds"], clicks: 7, impressions: 300, ctr: 0.0233, position: 8.61 }];
    return new Response(JSON.stringify({ rows }), { status: 200 });
  };
  return { fetchImpl, calls };
}

test("snapshot: last 28 days ending 3 days ago; totals, pages and queries stored as the site's search report", async () => {
  const store = new MemoryStore(); store.clock = () => NOW;
  const { fetchImpl, calls } = google();
  const h = makeSearchSnapshotHandler({ store, siteOf: async () => SITE, getToken: async () => "t", fetchImpl, now: () => NOW });
  const out = await h({ siteId: "A" });
  assert.match(out.evidence[0], /sc-domain:plumber\.test, 2026-10-31 to 2026-11-27: 40 clicks, 2000 impressions; 3 pages and 1 queries stored/);
  assert.equal(calls[0].b.startDate, "2026-10-31"); assert.equal(calls[0].b.endDate, "2026-11-27");
  assert.equal(calls.length, 3, "three small queries");
  const r = store.readMemory("A").find((m) => m.kind === "report" && m.key === "search_console");
  assert.equal(r.basis, "verified"); assert.equal(r.value.pages[0].url, "https://www.plumber.test/p0");
  assert.equal(r.value.pages[0].ctr, 0.0123); assert.equal(r.value.totals.position, 18.2);
  assert.deepEqual(r.value.complete, { pages: true, queries: true });
});

test("snapshot: falls back to the address-prefix property; no access escalates; an unconfirmed site is never read", async () => {
  const store = new MemoryStore(); store.clock = () => NOW;
  const pre = google({ access: "prefix" });
  await makeSearchSnapshotHandler({ store, siteOf: async () => SITE, getToken: async () => "t", fetchImpl: pre.fetchImpl, now: () => NOW })({ siteId: "A" });
  assert.equal(store.readMemory("A").find((m) => m.key === "search_console").value.property, "https://www.plumber.test/");
  const none = await makeSearchSnapshotHandler({ store, siteOf: async () => SITE, getToken: async () => "t", fetchImpl: google({ access: "none" }).fetchImpl, now: () => NOW })({ siteId: "A" });
  assert.match(none.escalate, /no access to plumber\.test; the site owner must add it as a user/);
  let tokens = 0;
  const off = await makeSearchSnapshotHandler({ store, siteOf: async () => SITE, getToken: async () => { tokens++; return "t"; }, fetchImpl: google().fetchImpl, allowed: async () => false })({ siteId: "A" });
  assert.match(off.evidence[0], /platform admin has not confirmed/); assert.equal(tokens, 0, "no Google call at all");
});

test("agents get the snapshot with an honest note on what a missing page means; nothing when not connected", () => {
  const full = { property: "sc-domain:x", from: "a", to: "b", totals: {}, pages: [{ url: "u1", impressions: 5 }, { url: "u2", impressions: 9 }], queries: [], complete: { pages: true } };
  const v = searchForAgents(full);
  assert.equal(v.pages[0].url, "u2", "by impressions");
  assert.match(v.note, /a page not listed had no impressions/);
  const cut = searchForAgents({ ...full, complete: { pages: false } });
  assert.match(cut.note, /may still have had impressions/);
  assert.match(searchForAgents({ ...full, pages: Array.from({ length: 200 }, (_, i) => ({ url: `u${i}`, impressions: i })) }).note, /Only the top 120 pages/);
  const job = { kind: "agent:seo-content-pruner", title: "Prune", inputs: { agent: "seo-content-pruner" } };
  const withGsc = JSON.parse(agentInput(job, [{ kind: "report", key: "search_console", value: full }], SITE).match(/<site_data>\n([\s\S]*)\n<\/site_data>/)[1]);
  assert.equal(withGsc.searchConsole.pages.length, 2);
  const without = JSON.parse(agentInput(job, [], SITE).match(/<site_data>\n([\s\S]*)\n<\/site_data>/)[1]);
  assert.equal(without.searchConsole, null, "the agent is told plainly there is no search data");
  assert.ok(SNAPSHOT_PAGES >= 200);
});

test("planner: one snapshot a day, only with a Google key, before the specialists", async () => {
  assert.equal(snapshotDue([], NOW), true);
  assert.equal(snapshotDue([{ kind: "report", key: "search_console", value: { generatedAt: "2026-11-30T01:00:00Z" } }], NOW), false);
  assert.equal(snapshotDue([{ kind: "report", key: "search_console", value: { generatedAt: "2026-11-29T01:00:00Z" } }], NOW), true);
  const store = new MemoryStore(); store.clock = () => NOW;
  const { fetchImpl } = google();
  const handlers = { search_snapshot: makeSearchSnapshotHandler({ store, siteOf: async () => SITE, getToken: async () => "t", fetchImpl, now: () => NOW }) };
  const r = await tick({ store, sites: [SITE], handlers, now: NOW, maxJobs: 3 });
  assert.ok(r.sites[0].queued.some((q) => q.kind === "search_snapshot"));
  assert.ok(r.runs.some((x) => x.outcome === "completed"));
  assert.ok(store.readMemory("A").some((m) => m.key === "search_console"));
  const again = await tick({ store, sites: [SITE], handlers, now: NOW, maxJobs: 3 });
  assert.ok(!again.sites[0].queued.some((q) => q.kind === "search_snapshot"), "not twice in a day");
  const noKey = await tick({ store: new MemoryStore(), sites: [SITE], handlers: {}, now: NOW, maxJobs: 0 });
  assert.ok(!noKey.sites[0].queued.some((q) => q.kind === "search_snapshot"), "without a key it is never planned");
});
