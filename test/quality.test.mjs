// Brief 01 item 1: heading outline, heading audit rules, top-query alignment and per-section heading averages.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractPage, headingOutline } from "../src/audit/extract.mjs";
import { runChecks, RULES } from "../src/audit/rules.mjs";
import { coverage, sameWord, siteWords, topQueries, keywordAlignment, sectionOutline } from "../src/analysis/quality.mjs";
import { routeAgents } from "../src/analysis/agent-router.mjs";

const page = (over = {}) => ({
  url: "https://s.test/a", finalUrl: "https://s.test/a", status: 200, isHtml: true, chain: [], inSitemap: true, depth: 1, inbound: 2, ttfb: 200,
  title: "A good page title about widgets", description: "x".repeat(120), robots: "", viewport: "width=device-width", canonical: "https://s.test/a",
  alternates: [], og: { title: "t", image: "i" }, h1s: ["Widgets"], h2s: [], lang: "en", jsonld: { types: [], invalid: 0, articleFields: null }, links: [], images: 0, imagesNoAlt: 0, mixed: [], words: 800, text: "", textHash: "h1", xRobots: "",
  headings: [{ level: 1, text: "Widgets" }, { level: 2, text: "What widgets do" }, { level: 3, text: "Small widgets" }, { level: 2, text: "Choosing a widget" }], ...over,
});
const rules = (issues) => issues.map((i) => i.rule).sort();

test("heading outline: <main> only when present, otherwise the body without header, nav, footer and aside", () => {
  const withMain = `<header><h2>Site name</h2></header><main><h1>Topic</h1><!-- <h2>commented</h2> --><h2>Part <b>one</b></h2></main><footer><h4>Contact</h4></footer>`;
  assert.deepEqual(headingOutline(withMain), [{ level: 1, text: "Topic" }, { level: 2, text: "Part one" }]);
  const noMain = `<nav><h3>Menu</h3></nav><h1>Topic</h1><h2>Part</h2><aside><h4>Ad</h4></aside><footer><h4>Contact</h4></footer>`;
  assert.deepEqual(headingOutline(noMain), [{ level: 1, text: "Topic" }, { level: 2, text: "Part" }]);
  assert.deepEqual(extractPage(`<html><body><main><h1>A</h1><h3>B</h3></main></body></html>`, "https://s.test/").headings, [{ level: 1, text: "A" }, { level: 3, text: "B" }]);
});

test("a well-structured page raises no heading rule; pages without heading data are not judged", () => {
  assert.deepEqual(runChecks([page()], { siteHost: "s.test" }), []);
  assert.deepEqual(runChecks([page({ headings: undefined, words: 2000 })], { siteHost: "s.test" }), []);
});

test("each heading defect raises its own rule with the evidence", () => {
  const issues = runChecks([page({
    h1s: ["W".repeat(71)],
    headings: [{ level: 1, text: "W".repeat(71) }, { level: 2, text: "Overview:" }, { level: 4, text: "Deep" }, { level: 2, text: "Pricing" }, { level: 2, text: "pricing" }],
  })], { siteHost: "s.test" });
  assert.deepEqual(rules(issues), ["h1-long", "h2-generic", "h2-repeated", "heading-skip"]);
  assert.match(issues.find((i) => i.rule === "heading-skip").detail, /H2 then H4 at "Deep"/);
  assert.match(issues.find((i) => i.rule === "h2-generic").detail, /"Overview:"/);
  for (const r of ["h1-long", "heading-skip", "h2-generic", "h2-repeated", "few-subheadings"]) assert.ok(RULES[r]?.why && RULES[r]?.fix, r);
});

test("few-subheadings only judges long pages, so hubs, tools and contact pages are left alone", () => {
  const flat = [{ level: 1, text: "Contact us" }];
  assert.deepEqual(rules(runChecks([page({ headings: flat, words: 599 })], { siteHost: "s.test" })), []);
  assert.deepEqual(rules(runChecks([page({ headings: flat, words: 900 })], { siteHost: "s.test" })), ["few-subheadings"]);
});

test("coverage: stop words ignored, plurals and other endings match, different words do not", () => {
  assert.equal(coverage("Invoice automation for small firms", "automating invoices"), 1);
  for (const [a, b, same] of [["invoice", "invoices", true], ["price", "pricing", true], ["car", "care", false], ["firm", "form", false]]) assert.equal(sameWord(a, b), same, `${a}/${b}`);
  assert.equal(coverage("Pricing", "widget pricing"), 0.5);
  assert.equal(coverage("anything", "how to"), 1);
});

test("site-wide words are found from the titles and stop counting, so the distinctive query word decides", () => {
  const titles = Array.from({ length: 10 }, (_, i) => `AI tool number ${i} | Acme`);
  assert.deepEqual([...siteWords(titles)].sort(), ["acme", "ai", "number", "tool"]);
  assert.equal(siteWords(titles.slice(0, 9)).size, 0, "small sites are not judged");
  const ignore = new Set(["ai", "voice"]);
  assert.equal(coverage("Why an AI Voice Assistant Pauses", "voice ai latency"), 2 / 3);
  assert.equal(coverage("Why an AI Voice Assistant Pauses", "voice ai latency", ignore), 0);
});

const rows = [
  { query: "invoice automation", page: "https://s.test/a/", clicks: 3, impressions: 400, position: 8 },
  { query: "acme invoices", page: "https://s.test/a/", clicks: 50, impressions: 900, position: 1 },
  { query: "widget pricing", page: "https://s.test/b", clicks: 1, impressions: 120, position: 12 },
  { query: "rare query", page: "https://s.test/c", clicks: 0, impressions: 5, position: 30 },
];

test("top query per page: most impressions, brand queries and tiny counts skipped", () => {
  const top = topQueries(rows, { brandTerms: ["Acme"] });
  assert.equal(top.get("https://s.test/a").query, "invoice automation");
  assert.equal(top.has("https://s.test/c"), false);
  assert.equal(topQueries(rows).get("https://s.test/a").query, "acme invoices");
});

test("keyword alignment lists pages whose title, H1 or description misses their own top query", () => {
  const pages = [
    { url: "https://s.test/a", finalUrl: "https://s.test/a", status: 200, title: "Invoice automation for small firms", h1: "Automating invoices", description: "Invoice automation that saves time." },
    { url: "https://s.test/b", finalUrl: "https://s.test/b", status: 200, title: "Our plans", h1: "Plans", description: null },
    { url: "https://s.test/gone", finalUrl: "https://s.test/gone", status: 404, title: "", h1: "", description: null },
  ];
  const out = keywordAlignment(pages, rows, { brandTerms: ["acme"] });
  assert.deepEqual(out.map((o) => [o.url, o.query, o.weak]), [["https://s.test/b", "widget pricing", ["title", "h1"]]]);
  assert.equal(out[0].score.description, null);
});

test("section outline averages H2 and H3 per first path segment", () => {
  const pages = [
    { url: "https://s.test/", status: 200, h2Count: 4, h3Count: 0 },
    { url: "https://s.test/guides/x", status: 200, h2Count: 5, h3Count: 2 },
    { url: "https://s.test/guides/y", status: 200, h2Count: 1, h3Count: 0 },
    { url: "https://s.test/old", status: 404, h2Count: 0, h3Count: 0 },
    { url: "https://s.test/legacy", status: 200, h2Count: null },
  ];
  assert.deepEqual(sectionOutline(pages), [{ section: "guides", pages: 2, avgH2: 3, avgH3: 1 }, { section: "home", pages: 1, avgH2: 4, avgH3: 0 }]);
});

test("router: heading findings go to the refresher, misaligned snippets to the snippet optimizer, and no agent is listed twice", () => {
  const plan = routeAgents({
    profile: { mode: "edit", signals: { structuredData: ["Organization"] } },
    audit: { issues: [{ rule: "heading-skip", url: "https://s.test/a" }, { rule: "title-long", url: "https://s.test/b" }] },
    priorities: { items: [{ type: "snippet", title: "low CTR page" }] },
    quality: { alignment: [{ url: "https://s.test/b", query: "widget pricing", weak: ["title"] }] },
  });
  const agents = plan.steps.map((s) => s.agent);
  assert.equal(new Set(agents).size, agents.length, `duplicates in ${agents}`);
  assert.ok(agents.includes("seo-refresher"));
  const snip = plan.steps.find((s) => s.agent === "seo-snippet-optimizer");
  assert.ok(snip.evidence.some((e) => /widget pricing/.test(e)) && snip.evidence.some((e) => /title-long/.test(e)), snip.evidence.join(" | "));
});

test("quality job: reads audit.json and gsc-rows.json, writes quality.json and quality.md, and skips cleanly without an audit", async () => {
  const { run } = await import("../src/jobs/quality.mjs");
  const state = mkdtempSync(join(tmpdir(), "seo-quality-"));
  const site = { id: "s", name: "S", url: "https://s.test/", brandTerms: ["acme"], ignoreQueries: [], paths: { state } };
  const log = console.log; console.log = () => {};
  try {
    await run({ site, flags: {} });
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "audit.json"), JSON.stringify({ generatedAt: "2026-10-18T00:00:00Z", pages: [{ url: "https://s.test/b", finalUrl: "https://s.test/b", status: 200, title: "Our plans", h1: "Plans", description: "Plans.", h2Count: 1, h3Count: 0 }] }));
    writeFileSync(join(state, "gsc-rows.json"), JSON.stringify({ window: { start: "2026-09-18", end: "2026-10-15" }, rows }));
    await run({ site, flags: {} });
  } finally { console.log = log; }
  const q = JSON.parse(readFileSync(join(state, "quality.json"), "utf8"));
  assert.equal(q.alignment.length, 1);
  assert.deepEqual(q.searchWindow, { start: "2026-09-18", end: "2026-10-15" });
  assert.match(readFileSync(join(state, "quality.md"), "utf8"), /\/b: "widget pricing" \(120 impressions\)/);
});
