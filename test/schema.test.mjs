// Structured data: parsing (@graph, arrays, broken blocks), requirement checks, visible-page mismatches, honest drafts.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsonldNodes, checkNode, suggest, crumbs, visibleFaq } from "../src/analysis/schema.mjs";

const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;

test("parsing: @graph and arrays are flattened, broken blocks are counted", () => {
  const r = jsonldNodes(ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "S" }, { "@type": ["Organization"], name: "S" }] }) + ld([{ "@type": "Product", name: "P" }]) + '<script type="application/ld+json">{bad</script>');
  assert.deepEqual(r.nodes.map((n) => [].concat(n["@type"])[0]), ["WebSite", "Organization", "Product"]); assert.equal(r.invalid, 1);
});

test("checks: missing required fields, prices and ratings not on the page, FAQ answers not visible, self-serving reviews", () => {
  const prod = checkNode({ "@type": "Product", name: "Plan", offers: { "@type": "Offer", price: "9.99" }, aggregateRating: { ratingValue: "4.9", reviewCount: 10 } }, { text: "Our plan costs 12.00 a month" });
  const notes = prod.problems.map((p) => p.note);
  assert.ok(notes.includes("price 9.99 is in the markup but not on the page"));
  assert.ok(notes.includes("offer has a price but no priceCurrency"));
  assert.ok(notes.includes("rating 4.9 is in the markup but not shown on the page"));
  assert.equal(checkNode({ "@type": "Product", name: "Plan", offers: { price: 12, priceCurrency: "GBP" } }, { text: "only 12.00 a month" }).problems.filter((p) => p.level === "error").length, 0);
  assert.ok(checkNode({ "@type": "Product" }).problems.some((p) => p.note === 'needs one of "offers", "review", "aggregateRating"'));
  const art = checkNode({ "@type": "BlogPosting", headline: "Ten tips for gardening in winter" }, { h1: "Choosing web hosting", title: "Hosting" });
  assert.equal(art.type, "Article"); assert.ok(art.problems.some((p) => /does not match the visible H1/.test(p.note)));
  const faq = checkNode({ "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Is it free?", acceptedAnswer: { text: "No." } }, { "@type": "Question", name: "Hidden?" }] }, { text: "is it free? no." });
  assert.deepEqual(faq.problems.map((p) => p.note), ['question "Hidden?" has no acceptedAnswer.text']);
  assert.ok(checkNode({ "@type": "Plumber", name: "P", address: "x", aggregateRating: { ratingValue: 5 } }, { text: "5 stars" }).problems.some((p) => /self-serving/.test(p.note)));
});

test("drafts: only facts from the page and the config; placeholders for the rest; FAQ only from visible questions and answers", () => {
  assert.deepEqual(visibleFaq(["How long does it take?", "Most installs take two to three hours on site.", "Why us?", "short"]), [{ q: "How long does it take?", a: "Most installs take two to three hours on site." }]);
  const s = suggest({ url: "https://s.test/blog/a", h1: "Choosing hosting", kind: "article", published: "2026-09-01", blocks: ["Is it hard?", "Not if you follow these steps in order.", "Can I move later?", "Yes, most hosts help you move for free."] }, [], { siteName: "S", siteUrl: "https://s.test/", crumbs: [{ name: "Home", url: "https://s.test/" }, { name: "Blog", url: "https://s.test/blog" }, { name: "Choosing hosting", url: "https://s.test/blog/a" }] });
  const by = Object.fromEntries(s.map((x) => [x.type, x.jsonld]));
  assert.equal(by.Article.datePublished, "2026-09-01"); assert.match(by.Article.author, /^<fill: /); assert.match(by.Article.image, /^<fill: /);
  assert.equal(by.BreadcrumbList.itemListElement.length, 3); assert.equal(by.FAQPage.mainEntity.length, 2);
  const home = suggest({ url: "https://s.test/", isHome: true, blocks: [] }, [{ "@type": "WebSite" }], { siteName: "S", siteUrl: "https://s.test/" });
  assert.deepEqual(home.map((x) => x.type), ["Organization"]); assert.match(home[0].jsonld.logo, /^<fill: /);
  const c = crumbs("https://s.test/blog/a", new Map([["https://s.test/blog", "Blog | S"], ["https://s.test/", "S"]]));
  assert.deepEqual(c.map((x) => x.name), ["S", "Blog", "a"]);
});

test("schema job: checks the home page and top pages, writes drafts, edits nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-sch-")); const state = join(root, "state"); mkdirSync(state);
  writeFileSync(join(state, "gsc-rows.json"), JSON.stringify({ rows: [{ page: "https://s.test/blog/a", clicks: 3 }] }));
  const pages = { "https://s.test/": `<html><head><title>S</title></head><body><main><h1>S</h1><p>Welcome to S, a hosting company.</p></main></body></html>`,
    "https://s.test/blog/a": `<html><head><title>Choosing hosting</title><meta property="article:published_time" content="2026-09-01T10:00:00Z"></head><body><main><h1>Choosing hosting</h1><p>Text about hosting choices for small sites.</p></main>${ld({ "@type": "Article", headline: "Choosing hosting" })}</body></html>` };
  const f = async (url) => url.endsWith("robots.txt") ? { ok: false, status: 404 } : pages[url] ? { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => pages[url] } : { ok: false, status: 404 };
  const site = { id: "s", name: "S", url: "https://s.test/", paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/schema.mjs");
  const log = console.log; console.log = () => {};
  try { await run({ site, flags: {} }, { fetch: f, delayMs: 0 }); } finally { console.log = log; }
  const r = JSON.parse(readFileSync(join(state, "schema.json"), "utf8")).results;
  assert.deepEqual(r.find((x) => x.url === "https://s.test/").suggestions.map((s) => s.type), ["Organization", "WebSite"]);
  const a = r.find((x) => x.url === "https://s.test/blog/a");
  assert.ok(a.checks[0].problems.some((p) => p.note === 'missing recommended "datePublished"'));
  assert.match(readFileSync(join(state, "schema.md"), "utf8"), /```json/);
});
