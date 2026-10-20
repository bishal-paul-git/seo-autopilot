// Rank tracker: history from Search Console, week-on-week movement, the visibility index and the live check.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedSet, mergeSeries, trackQueries, summarise, liveCheck, weight, visibility } from "../src/analysis/rank.mjs";

const add = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const daily = (from, n, pos, imp = 10, clicks = 1) => Object.fromEntries(Array.from({ length: n }, (_, i) => [add(from, i), [clicks, imp, pos]]));

test("tracked set: your list wins (the example note is ignored); otherwise top non-brand queries by impressions", () => {
  assert.deepEqual(trackedSet(["REPLACE THESE ...", "Web Hosting", { q: "vps" }], []).queries, ["web hosting", "vps"]);
  const t = trackedSet([], [{ query: "acme login", impressions: 900 }, { query: "a", impressions: 5 }, { query: "b", impressions: 50 }, { query: "a", impressions: 60 }], { n: 2, brandTerms: ["acme"] });
  assert.deepEqual(t.queries, ["a", "b"]); assert.match(t.basis, /top 2/);
});

test("series: rows merge by lower-cased query with impression-weighted position; only kept queries are stored", () => {
  const s = mergeSeries({}, [{ keys: ["2026-10-01", "Web Hosting"], clicks: 1, impressions: 10, position: 4 }, { keys: ["2026-10-01", "web hosting"], clicks: 0, impressions: 30, position: 8 }, { keys: ["2026-10-01", "other"], clicks: 0, impressions: 5, position: 2 }], new Set(["web hosting"]));
  assert.deepEqual(s, { "web hosting": { "2026-10-01": [1, 40, 7] } });
});

test("movement: this week vs last week and four weeks ago; new, lost, up, down and steady", () => {
  const today = "2026-10-20"; // this week 10-11..10-17, last week 10-04..10-10, four weeks ago 09-13..09-19
  const series = {
    up: { ...daily("2026-09-13", 7, 15), ...daily("2026-10-04", 7, 12), ...daily("2026-10-11", 7, 6) },
    down: { ...daily("2026-10-04", 7, 3), ...daily("2026-10-11", 7, 9) },
    steady: { ...daily("2026-10-04", 7, 5), ...daily("2026-10-11", 7, 5.4) },
    fresh: daily("2026-10-11", 7, 18), gone: daily("2026-10-04", 7, 30),
  };
  const rows = trackQueries(series, ["up", "down", "steady", "fresh", "gone", "never"], today);
  const by = Object.fromEntries(rows.map((r) => [r.query, r]));
  assert.deepEqual([by.up.status, by.up.change, by.up.monthChange], ["up", 6, 9]);
  assert.deepEqual([by.down.status, by.down.change], ["down", -6]);
  assert.equal(by.steady.status, "steady"); assert.equal(by.fresh.status, "new"); assert.equal(by.gone.status, "lost"); assert.equal(by.never.status, "not ranking");
  const s = summarise(rows, today);
  assert.deepEqual(s.gainers.map((r) => r.query), ["up"]); assert.deepEqual(s.losers.map((r) => r.query), ["down"]); assert.deepEqual(s.lost, ["gone"]);
  assert.deepEqual(s.buckets, { "1-3": 0, "4-10": 3, "11-20": 1, "21-50": 0, "51+": 0, "not ranking": 2 });
});

test("visibility index: 100 when everything is first, nothing past page two counts", () => {
  assert.equal(weight(1), 1); assert.equal(weight(3), 0.38); assert.equal(weight(15), 0.02); assert.equal(weight(25), 0); assert.equal(weight(null), 0);
  assert.equal(visibility([{ position: 1 }, { position: 1 }]), 100); assert.equal(visibility([{ position: 1 }, { position: 30 }]), 50);
});

test("live check: own position and URL, features held or not, share of voice by domain, competitors", () => {
  const r = liveCheck({
    "web hosting": { results: [{ domain: "big.test", position: 1, url: "https://big.test/" }, { domain: "s.test", position: 3, url: "https://s.test/hosting" }, { domain: "big.test", position: 5 }], features: [{ type: "featured-snippet", domains: ["big.test"] }, { type: "people-also-ask", domains: ["s.test"] }], aiSources: [{ domain: "s.test" }] },
    "vps": { results: [{ domain: "other.test", position: 1 }], features: [] },
    "broken": { error: "serpapi: HTTP 429" },
  }, "www.s.test");
  const q = r.perQuery.find((x) => x.query === "web hosting");
  assert.equal(q.livePosition, 3); assert.equal(q.url, "https://s.test/hosting"); assert.equal(q.aiCited, true);
  assert.deepEqual(q.features, [{ type: "featured-snippet", held: false, by: ["big.test"] }, { type: "people-also-ask", held: true, by: [] }]);
  assert.equal(r.ownShare, 12.7, "0.38 over 3 queries");
  assert.deepEqual(r.competitors.map((c) => c.domain), ["big.test", "other.test"]);
  assert.deepEqual(r.features, { "featured-snippet": { shown: 1, held: 0 }, "people-also-ask": { shown: 1, held: 1 } });
});

test("rank job: builds history from Search Console pages of rows, writes the report, keeps history between runs", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-rank-")); const state = join(root, "state"); mkdirSync(state);
  writeFileSync(join(root, "tracked-queries.json"), JSON.stringify(["web hosting"]));
  const calls = [];
  const query = async (from, to, dims, limit, extra) => {
    calls.push({ from, to, dims, extra });
    if (extra.startRow > 0) return [];
    const out = [];
    for (let d = from; d <= to; d = add(d, 1)) out.push({ keys: [d, "web hosting"], clicks: 1, impressions: 20, position: d >= "2026-10-11" ? 4 : 9 });
    return out;
  };
  const site = { id: "s", name: "S", url: "https://s.test/", paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/rank.mjs");
  const log = console.log; console.log = () => {};
  try {
    await run({ site, flags: {} }, { query, today: "2026-10-20" });
    assert.deepEqual([calls[0].from, calls[0].to, calls[0].dims], ["2026-07-20", "2026-10-18", ["date", "query"]], "first run: 90 days");
    await run({ site, flags: {} }, { query, today: "2026-10-21" });
    assert.equal(calls.at(-1).from, "2026-10-09", "later runs: the last 10 days");
  } finally { console.log = log; }
  const r = JSON.parse(readFileSync(join(state, "rank.json"), "utf8"));
  assert.deepEqual([r.rows[0].query, r.rows[0].position, r.rows[0].previous, r.rows[0].status], ["web hosting", 4, 8.3, "up"], "last week 10-05..10-11: six days at 9, one at 4");
  assert.deepEqual(JSON.parse(readFileSync(join(state, "query-daily.json"), "utf8"))["web hosting"]["2026-10-15"], [1, 20, 4], "a re-fetched day is replaced, not added");
  assert.equal(JSON.parse(readFileSync(join(state, "rank-history.json"), "utf8")).length, 2);
  assert.ok(Object.keys(JSON.parse(readFileSync(join(state, "query-daily.json"), "utf8"))["web hosting"]).length >= 90);
  assert.match(readFileSync(join(state, "rank.md"), "utf8"), /Visibility index/);
});
