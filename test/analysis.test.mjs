import test from "node:test";
import assert from "node:assert/strict";
import { buildCtrCurve, expectedCtr, cannibalization, strikingDistance, ctrUnderperformers, decay, classifyIntent, intentMix, brandSplit, topicClusters, analyze } from "../src/analysis/search.mjs";
import { buildPriorities } from "../src/analysis/priorities.mjs";
import { evaluate } from "../src/analysis/experiments.mjs";
import { RULES } from "../src/audit/rules.mjs";

const row = (query, page, clicks, impressions, position) => ({ query, page, clicks, impressions, position });

// Synthetic site where position 1 earns ~30%, 2 ~15%, 3 ~10%, 5 ~5%, 8 ~2%.
const ctrByPos = { 1: 0.3, 2: 0.15, 3: 0.1, 5: 0.05, 8: 0.02 };
const curveRows = Object.entries(ctrByPos).flatMap(([pos, ctr]) => [row(`filler ${pos}`, "/f", Math.round(1000 * ctr), 1000, Number(pos))]);

test("the CTR curve is built from the site's own data and interpolated", () => {
  const c = buildCtrCurve(curveRows);
  assert.ok(c.enough);
  assert.ok(Math.abs(expectedCtr(c, 3) - 0.1) < 1e-9);
  const mid = expectedCtr(c, 4); // between pos 3 (0.10) and pos 5 (0.05)
  assert.ok(mid > 0.05 && mid < 0.1);
  assert.equal(buildCtrCurve([row("a", "/a", 1, 10, 1)]).enough, false);
  assert.equal(expectedCtr(buildCtrCurve([row("a", "/a", 1, 10, 1)]), 3), null, "no estimate from thin data");
});

test("cannibalisation needs two pages each with a real share of a query", () => {
  const rows = [row("crm tips", "/a", 5, 60, 6), row("crm tips", "/b", 4, 50, 8), row("solo", "/a", 1, 100, 5), row("solo", "/b", 0, 2, 30), row("tiny", "/a", 0, 5, 9), row("tiny", "/b", 0, 5, 9)];
  const out = cannibalization(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].query, "crm tips");
  assert.equal(out[0].pages.length, 2);
});

test("striking distance ranks by estimated extra clicks and gives no estimate on thin data", () => {
  const curve = buildCtrCurve(curveRows);
  const rows = [row("big gap", "/a", 5, 400, 6), row("small gap", "/b", 1, 40, 6), row("already top", "/c", 90, 300, 1), row("too deep", "/d", 0, 50, 40)];
  const out = strikingDistance(rows, curve);
  assert.deepEqual(out.map((o) => o.query), ["big gap", "small gap"]);
  assert.ok(out[0].estimatedExtraClicks > out[1].estimatedExtraClicks);
  assert.equal(strikingDistance(rows, { enough: false, byPos: {} })[0].estimatedExtraClicks, null);
});

test("CTR underperformers are pages far below what their position normally earns", () => {
  const curve = buildCtrCurve(curveRows);
  const rows = [row("q1", "/weak", 2, 400, 3), row("q2", "/fine", 40, 400, 3)];
  const out = ctrUnderperformers(rows, curve);
  assert.equal(out.length, 1);
  assert.equal(out[0].page, "/weak");
  assert.ok(out[0].estimatedLostClicks > 30);
});

test("decay flags big drops only on pages with enough earlier traffic", () => {
  const prev = [row("a", "/old", 10, 200, 5), row("b", "/small", 0, 10, 9), row("c", "/steady", 8, 100, 4)];
  const now = [row("a", "/old", 2, 60, 6), row("c", "/steady", 8, 95, 4)];
  const out = decay(now, prev);
  assert.deepEqual(out.map((d) => d.page), ["/old"]);
  assert.equal(out[0].change, -0.7);
});

test("intent heuristics and brand split", () => {
  assert.equal(classifyIntent("how to choose a crm"), "informational");
  assert.equal(classifyIntent("best crm for small business"), "commercial");
  assert.equal(classifyIntent("crm consultant near me"), "transactional");
  assert.equal(classifyIntent("acme login", ["acme"]), "navigational");
  const mix = intentMix([row("how to x", "/a", 0, 30, 5), row("hire a plumber", "/b", 0, 10, 5)]);
  assert.equal(mix.informational.share, 0.75);
  const split = brandSplit([row("acme pricing", "/a", 3, 30, 1), row("crm tips", "/b", 1, 70, 8)], ["acme"]);
  assert.equal(split.brand.clicks, 3); assert.equal(split.nonBrand.impressions, 70);
});

test("topic clusters show demand and the lack of a dedicated page", () => {
  const rows = [row("crm migration checklist", "/a", 1, 30, 9), row("crm migration steps", "/a", 0, 20, 12), row("crm migration cost", "/b", 0, 15, 15), row("email automation tips", "/c", 2, 40, 7)];
  const topics = topicClusters(rows, ["email automation guide"], { minImpressions: 10 });
  const crm = topics.find((t) => t.topic.startsWith("crm") || t.topic.startsWith("migrat"));
  assert.ok(crm && crm.queries >= 2 && crm.impressions === 65);
  assert.equal(crm.hasDedicatedPage, false);
  assert.equal(topics.find((t) => t.topic.startsWith("email") || t.topic.startsWith("automation")).hasDedicatedPage, true);
});

test("analyze runs end to end on a small dataset without throwing", () => {
  const r = analyze({ rows: curveRows, prevRows: [], brandTerms: [], pageTitles: [] });
  assert.ok(r.curve.enough); assert.equal(r.sample.rows, 5); assert.ok(Array.isArray(r.contentGaps));
});

test("priorities rank high-impact, high-confidence, low-effort work first and keep evidence", () => {
  const audit = { issues: [{ rule: "status-error", url: "https://s/a", detail: "HTTP 404" }, { rule: "images-no-alt", url: "https://s/b", detail: "1 of 2" }] };
  const insights = { strikingDistance: [{ query: "big gap", position: 6, impressions: 400, page: "https://s/a", estimatedExtraClicks: 40 }], ctrUnderperformers: [], cannibalization: [], decay: [], contentGaps: [] };
  const items = buildPriorities({ audit, insights, rules: RULES, pipeline: { tracked: true, upcoming: 2, queued: 0 }, indexing: ["/x (URL is unknown to Google)"] });
  assert.ok(items.length >= 4);
  assert.equal(items[0].rank, 1);
  assert.ok(items.every((i, n) => n === 0 || items[n - 1].score >= i.score), "sorted by score");
  const noAlt = items.find((i) => i.id === "audit:images-no-alt"), broken = items.find((i) => i.id === "audit:status-error");
  assert.ok(broken.score > noAlt.score);
  assert.ok(items.every((i) => i.why && i.how && i.evidence.length));
});

test("experiments wait for the after-window, then compare 14 days before and after", () => {
  const series = { "https://s/p": {} };
  const add = (from, n, v) => { for (let i = 0; i < n; i++) { const d = new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10); series["https://s/p"][d] = v; } };
  add("2026-09-01", 14, [2, 100, 8]);   // before: 2% CTR
  add("2026-09-18", 14, [6, 100, 7]);   // after (starts 3 days after 2026-09-15): 6% CTR
  const exp = { url: "https://s/p", change: "rewrote title", date: "2026-09-15" };
  assert.equal(evaluate(exp, series, "2026-09-20").status, "pending");
  const done = evaluate(exp, series, "2026-10-20");
  assert.equal(done.status, "done");
  assert.equal(done.verdict, "click-through improved");
  assert.match(done.note, /Directional/);
  assert.equal(evaluate({ ...exp, url: "https://s/none" }, series, "2026-10-20").status, "no data");
});
