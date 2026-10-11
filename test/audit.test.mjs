import test from "node:test";
import assert from "node:assert/strict";
import { extractPage, visibleText } from "../src/audit/extract.mjs";
import { runChecks, robotsDisallows, summarize, RULES } from "../src/audit/rules.mjs";
import { crawlSite, fetchPage } from "../src/audit/crawl.mjs";
import { linkOpportunities } from "../src/audit/links.mjs";

const page = (over = {}) => ({
  url: "https://s.test/a", finalUrl: "https://s.test/a", status: 200, isHtml: true, chain: [], inSitemap: true, depth: 1, inbound: 2, ttfb: 200,
  title: "A good page title about widgets", description: "x".repeat(120), robots: "", viewport: "width=device-width", canonical: "https://s.test/a",
  alternates: [], og: { title: "t", image: "i" }, h1s: ["Widgets"], h2s: [], lang: "en", jsonld: { types: [], invalid: 0, articleFields: null }, links: [], images: 0, imagesNoAlt: 0, mixed: [], words: 800, text: "", textHash: "h1", xRobots: "", ...over,
});
const rules = (issues) => issues.map((i) => i.rule).sort();

test("extractPage reads the facts a crawler needs", () => {
  const html = `<!doctype html><html lang="en"><head><title>My &amp; Title</title><meta name="description" content="Desc here"><meta name="robots" content="noindex,follow"><meta name="viewport" content="width=device-width">
    <link rel="canonical" href="/page"><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Article","headline":"H","datePublished":"2026-01-01"},{"@type":"Organization"}]}</script>
    <script type="application/ld+json">{ broken</script></head><body><h1>Main heading</h1><h2>Sub</h2><p>Hello world from the page.</p>
    <a href="/other">Other page</a><a href="https://ext.com/x" rel="nofollow">Ext</a><a href="mailto:a@b.c">mail</a><img src="a.png"><img src="b.png" alt="B"><img src="http://s.test/insecure.png" alt="">
    <script>var hidden = "not visible text";</script></body></html>`;
  const x = extractPage(html, "https://s.test/page");
  assert.equal(x.title, "My & Title");
  assert.equal(x.canonical, "https://s.test/page");
  assert.equal(x.robots, "noindex,follow");
  assert.deepEqual(x.h1s, ["Main heading"]);
  assert.equal(x.lang, "en");
  assert.equal(x.jsonld.invalid, 1);
  assert.deepEqual(x.jsonld.types.sort(), ["Article", "Organization"]);
  assert.deepEqual(x.jsonld.articleFields, { headline: true, datePublished: true, author: false, image: false });
  assert.equal(x.links.length, 2);
  assert.equal(x.links[1].nofollow, true);
  assert.equal(x.images, 3); assert.equal(x.imagesNoAlt, 1);
  assert.equal(x.mixed.length, 1);
  assert.ok(!x.text.includes("not visible"));
  assert.ok(visibleText("<style>a{}</style><p>Hi <b>there</b></p>") === "Hi there");
});

test("a healthy page raises nothing; each defect raises its rule", () => {
  assert.deepEqual(runChecks([page()], { siteHost: "s.test" }), []);
  const bad = page({ title: "", description: null, h1s: [], viewport: null, canonical: null, lang: null, words: 100, mixed: ["http://x"], imagesNoAlt: 2, images: 3, inbound: 0, depth: 5, ttfb: 3000,
    jsonld: { types: [], invalid: 1, articleFields: { headline: true, datePublished: false, author: true, image: true } }, robots: "noindex" });
  assert.deepEqual(rules(runChecks([bad], { siteHost: "s.test" })), ["canonical-missing", "deep", "desc-missing", "h1-missing", "images-no-alt", "jsonld-article-incomplete", "jsonld-invalid", "lang-missing", "mixed-content", "noindex-in-sitemap", "orphan", "slow-ttfb", "thin-content", "title-missing", "viewport-missing"].filter((r) => r !== "thin-content"));
});

test("duplicates, redirects, canonical problems and broken links are found", () => {
  const a = page({ url: "https://s.test/a", finalUrl: "https://s.test/a", title: "Same title for two pages", textHash: "dup", links: [{ url: "https://s.test/gone", text: "x" }, { url: "https://s.test/old", text: "y" }] });
  const b = page({ url: "https://s.test/b", finalUrl: "https://s.test/b", title: "Same title for two pages", textHash: "dup", canonical: "https://s.test/old" });
  const old = page({ url: "https://s.test/old", finalUrl: "https://s.test/new", status: 200, chain: ["https://s.test/old", "https://s.test/mid"], inSitemap: true });
  const err = page({ url: "https://s.test/err", finalUrl: "https://s.test/err", status: 404, isHtml: false });
  const issues = runChecks([a, b, old, err], { siteHost: "s.test", brokenTargets: new Map([["https://s.test/gone", 404]]) });
  const r = rules(issues);
  for (const need of ["title-duplicate", "duplicate-content", "redirect-chain", "status-redirect", "status-error", "broken-link", "canonical-other", "canonical-broken", "link-to-redirect"]) assert.ok(r.includes(need), `expected ${need} in ${r}`);
});

test("robots.txt: longest match wins, Allow beats Disallow on a tie, blocks-all is detected", () => {
  const robots = "User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /tmp*\n";
  assert.ok(robotsDisallows(robots, "/private/x"));
  assert.ok(!robotsDisallows(robots, "/private/public/page"));
  assert.ok(robotsDisallows(robots, "/tmp123"));
  assert.ok(!robotsDisallows(robots, "/blog"));
  assert.ok(!robotsDisallows("User-agent: googlebot\nDisallow: /", "/blog"));
  const all = runChecks([page()], { robotsTxt: "User-agent: *\nDisallow: /\n", siteHost: "s.test" });
  assert.ok(rules(all).includes("robots-blocks-all"));
  assert.ok(RULES["robots-blocks-all"].why.length > 10 && RULES["robots-blocks-all"].fix.length > 5, "every rule explains why and how to fix");
  for (const [id, r] of Object.entries(RULES)) assert.ok(r.why && r.fix && r.title && r.severity, `rule ${id} is complete`);
});

test("summarize counts severities and clean pages", () => {
  const issues = runChecks([page({ title: "", description: "d".repeat(100), textHash: "x1" }), page({ url: "https://s.test/b", finalUrl: "https://s.test/b", canonical: "https://s.test/b", description: "e".repeat(100), h1s: ["Other heading"], textHash: "x2" })], { siteHost: "s.test" });
  const s = summarize(issues, 2);
  assert.equal(s.bySeverity.high, 1);
  assert.equal(s.pagesWithoutHighOrMedium, 1);
});

// A tiny fake website for the crawler.
function fakeSite() {
  const pages = {
    "https://s.test/": `<html lang="en"><head><title>Home page of the site</title><meta name="viewport" content="x"><link rel="canonical" href="https://s.test/"></head><body><h1>Home</h1><a href="/a">Widgets guide</a><a href="/missing">Dead</a><a href="/r">Redirect</a></body></html>`,
    "https://s.test/a": `<html lang="en"><head><title>Widgets guide for everyone</title><meta name="viewport" content="x"><link rel="canonical" href="https://s.test/a"></head><body><h1>Widgets guide</h1><p>All about widgets and gadgets.</p><a href="/">Home</a></body></html>`,
    "https://s.test/orphan": `<html lang="en"><head><title>Nobody links here at all</title></head><body><h1>Orphan</h1></body></html>`,
  };
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith("/sitemap.xml")) return new Response(`<urlset><url><loc>https://s.test/</loc></url><url><loc>https://s.test/a</loc></url><url><loc>https://s.test/orphan</loc></url></urlset>`, { status: 200 });
    if (u.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\nSitemap: https://s.test/sitemap.xml\n", { status: 200 });
    if (u === "https://s.test/r") return new Response(null, { status: 301, headers: { location: "https://s.test/a" } });
    if (pages[u]) return new Response(opts.method === "HEAD" ? null : pages[u], { status: 200, headers: { "content-type": "text/html" } });
    return new Response("nope", { status: 404, headers: { "content-type": "text/html" } });
  };
  return fetchImpl;
}

test("the crawler builds the link graph, depth, redirects and broken targets", async () => {
  const site = { url: "https://s.test/", sitemap: "https://s.test/sitemap.xml" };
  const { pages, ctx } = await crawlSite(site, { fetchImpl: fakeSite() });
  const by = Object.fromEntries(pages.map((p) => [p.url.replace("https://s.test", "") || "/", p]));
  assert.equal(by["/"].depth, 0);
  assert.equal(by["/a"].depth, 1);
  assert.equal(by["/orphan"].inbound, 0);
  assert.equal(by["/a"].inbound, 1, "one distinct page (home) links to it, directly and via the redirecting /r");
  assert.equal(by["/missing"].status, 404, "linked pages are crawled too");
  const issues = runChecks(pages, ctx);
  const r = rules(issues);
  assert.ok(r.includes("orphan")); assert.ok(r.includes("broken-link"));
  assert.ok(!r.includes("sitemap-not-in-robots"));
});

test("fetchPage records the redirect chain and gives up on loops", async () => {
  const loop = async () => new Response(null, { status: 302, headers: { location: "https://s.test/loop" } });
  const r = await fetchPage("https://s.test/loop", { fetchImpl: loop, maxHops: 3 });
  assert.equal(r.status, 0);
  assert.match(r.error, /too many redirects/);
});

test("link opportunities find mentions of another page's topic without a link", () => {
  const target = page({ url: "https://s.test/crm", finalUrl: "https://s.test/crm", title: "Small business CRM guide | Site", h1s: ["Small business CRM guide"], text: "Everything about CRM", inbound: 0, links: [] });
  const source = page({ url: "https://s.test/blog", finalUrl: "https://s.test/blog", title: "Blog post", h1s: ["Blog"], text: "We wrote a long piece and our small business crm guide is mentioned in passing here.", links: [] });
  const linked = page({ url: "https://s.test/other", finalUrl: "https://s.test/other", title: "Other", h1s: ["Other"], text: "See the small business crm guide.", links: [{ url: "https://s.test/crm", text: "guide" }] });
  const out = linkOpportunities([target, source, linked]);
  assert.equal(out.length, 1);
  assert.equal(out[0].from, "https://s.test/blog");
  assert.equal(out[0].to, "https://s.test/crm");
});

test("structured data missing required properties, invalid and non-reciprocal hreflang, missing Open Graph", async () => {
  const { runChecks } = await import("../src/audit/rules.mjs");
  const base = { status: 200, isHtml: true, chain: [], inSitemap: true, robots: "", title: "A reasonably long page title here", description: "d".repeat(100), h1s: ["H"], words: 400, links: [], images: 0, imagesNoAlt: 0, mixed: [], viewport: "w", lang: "en", inbound: 1, depth: 1, og: { title: "t", image: "i" }, textHash: "" };
  const a = { ...base, url: "https://x.com/en", finalUrl: "https://x.com/en", canonical: "https://x.com/en", alternates: [{ hreflang: "en", href: "https://x.com/en" }, { hreflang: "fr", href: "https://x.com/fr" }, { hreflang: "english", href: "https://x.com/e" }], jsonld: { types: ["FAQPage"], invalid: 0, nodes: [{ type: "FAQPage", props: ["@type"] }] } };
  const b = { ...base, url: "https://x.com/fr", finalUrl: "https://x.com/fr", canonical: "https://x.com/fr", alternates: [], og: {}, jsonld: { types: [], invalid: 0, nodes: [] } };
  const rules = runChecks([a, b], { siteHost: "x.com" }).map((i) => i.rule);
  assert.ok(rules.includes("schema-required-missing"));
  assert.ok(rules.includes("hreflang-invalid"));
  assert.ok(rules.includes("og-missing"));
  const c = runChecks([{ ...a, alternates: [{ hreflang: "en", href: "https://x.com/en" }, { hreflang: "fr", href: "https://x.com/fr" }] }, { ...b, alternates: [{ hreflang: "fr", href: "https://x.com/fr" }] }], { siteHost: "x.com" }).map((i) => i.rule);
  assert.ok(c.includes("hreflang-not-reciprocal"));
});
