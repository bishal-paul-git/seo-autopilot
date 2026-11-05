import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPage } from "../src/audit/extract.mjs";
import { runChecks, RULES } from "../src/audit/rules.mjs";
import { crawlSite } from "../src/audit/crawl.mjs";

const page = (url, html, extra = {}) => ({ url, finalUrl: url, status: 200, isHtml: true, chain: [], inSitemap: true, inbound: 1, depth: 1, ttfb: 100, xRobots: "", ...extractPage(html, url), ...extra });
const rules = (issues) => issues.map((i) => i.rule);
const LONG = (n, w = 30) => Array.from({ length: n }, () => `${"word ".repeat(w).trim()}.`).join(" ");

test("mobile: fixed-width and no-zoom viewports are flagged, a normal one is not", () => {
  const head = (v) => `<html lang="en"><head><title>A page about plumbing in Leeds</title><meta name="viewport" content="${v}"></head><body><h1>x</h1></body></html>`;
  assert.ok(rules(runChecks([page("https://a.test/1", head("width=1024"))])).includes("viewport-fixed-width"));
  assert.ok(rules(runChecks([page("https://a.test/2", head("width=device-width, user-scalable=no"))])).includes("viewport-no-zoom"));
  assert.ok(rules(runChecks([page("https://a.test/3", head("width=device-width, maximum-scale=1"))])).includes("viewport-no-zoom"));
  const ok = rules(runChecks([page("https://a.test/4", head("width=device-width, initial-scale=1"))]));
  assert.ok(!ok.includes("viewport-fixed-width") && !ok.includes("viewport-no-zoom"));
});

test("images: no size, camera file names, lazy main image, broken images", () => {
  const html = `<html><body><header><img src="/logo.svg"></header><main><img src="/IMG_1234.jpg" loading="lazy" alt="x"><img src="/team-photo.jpg" width="10" height="10" alt="y"><img src="/gone.png" width="1" height="1" alt="z"></main></body></html>`;
  const p = page("https://a.test/", html);
  assert.equal(p.imagesNoSize, 1, "svg logo is not counted, IMG_1234 has no size");
  assert.equal(p.heroLazy, true);
  const got = runChecks([p], { brokenImages: new Map([["https://a.test/gone.png", 404]]) });
  for (const r of ["image-no-size", "image-filename-generic", "hero-image-lazy", "image-broken"]) assert.ok(rules(got).includes(r), r);
  assert.match(got.find((i) => i.rule === "image-filename-generic").detail, /IMG_1234\.jpg/);
  assert.ok(!rules(runChecks([page("https://a.test/b", '<main><img src="/hero.jpg" width="1" height="1" alt="h"><img src="/more.jpg" loading="lazy" width="1" height="1" alt="m"></main>')])).includes("hero-image-lazy"), "lazy below the first image is fine");
});

test("tracking: the same Google tag loaded twice is flagged once per page", () => {
  const html = `<head><script src="https://www.googletagmanager.com/gtag/js?id=G-AAA111"></script><script src="https://www.googletagmanager.com/gtag/js?id=G-AAA111"></script><script>gtag('config','G-AAA111')</script></head>`;
  const got = runChecks([page("https://a.test/", html)]).filter((i) => i.rule === "tracking-duplicate");
  assert.equal(got.length, 1); assert.equal(got[0].detail, "G-AAA111");
  assert.ok(!rules(runChecks([page("https://a.test/x", '<script src="https://www.googletagmanager.com/gtag/js?id=G-AAA111"></script><script>gtag("config","G-AAA111")</script>')])).includes("tracking-duplicate"), "one load plus its config is normal");
});

test("pagination: page 2 canonical to page 1 is flagged, self canonical is not", () => {
  const html = (c) => `<head><link rel="canonical" href="${c}"></head>`;
  assert.ok(rules(runChecks([page("https://a.test/blog?page=2", html("https://a.test/blog"))])).includes("pagination-canonical-first"));
  assert.ok(rules(runChecks([page("https://a.test/blog/page/3/", html("https://a.test/blog/"))])).includes("pagination-canonical-first"));
  assert.ok(!rules(runChecks([page("https://a.test/blog?page=2", html("https://a.test/blog?page=2"))])).includes("pagination-canonical-first"));
});

test("SXO: no call to action on a service page, none needed on an article; long sentences", () => {
  const body = `<main><h1>Boiler repair</h1><p>${LONG(8, 25)}</p></main>`;
  assert.ok(rules(runChecks([page("https://a.test/boilers/", body)])).includes("no-cta"));
  assert.ok(!rules(runChecks([page("https://a.test/boilers/", body.replace("</main>", '<a href="tel:0113">Call us</a></main>'))])).includes("no-cta"));
  assert.ok(!rules(runChecks([page("https://a.test/blog/boilers/", body)])).includes("no-cta"), "articles are not asked for a CTA");
  assert.ok(rules(runChecks([page("https://a.test/long/", `<main><p>${LONG(10, 35)}</p></main>`)])).includes("hard-to-read"));
  assert.ok(!rules(runChecks([page("https://a.test/short/", `<main><p>${LONG(30, 12)}</p></main>`)])).includes("hard-to-read"));
});

test("site level: other addresses that do not redirect, and a certificate about to expire", () => {
  const got = runChecks([], { siteHost: "a.test", hostVariants: [{ from: "http://a.test/", to: "http://a.test/", status: 200, ok: false }, { from: "https://www.a.test/", to: "https://a.test/", status: 200, ok: true }], tls: { daysLeft: 9, validTo: "2026-11-14" } });
  assert.deepEqual(rules(got).sort(), ["host-variant-not-redirected", "ssl-expiring"]);
  assert.equal(runChecks([], { tls: { daysLeft: 60, validTo: "x" } }).length, 0);
});

test("crawlSite checks images and the http/www addresses through the same fetch", async () => {
  const site = {
    "https://a.test/": '<html><head><link rel="canonical" href="https://a.test/"></head><main><img src="/gone.png"></main></html>',
    "http://a.test/": null, // redirects to https
  };
  const fetchImpl = async (u, o = {}) => {
    u = String(u);
    if (u === "http://a.test/") return new Response(null, { status: 301, headers: { location: "https://a.test/" } });
    if (u === "https://www.a.test/") return new Response("same site", { status: 200, headers: { "content-type": "text/html" } });
    if (site[u]) return new Response(o.method === "HEAD" ? null : site[u], { status: 200, headers: { "content-type": "text/html" } });
    return new Response("no", { status: 404, headers: { "content-type": "text/html" } });
  };
  const { ctx } = await crawlSite({ url: "https://a.test/", sitemap: "https://a.test/sitemap.xml" }, { engine: "node", fetchImpl, checkTls: false });
  assert.equal(ctx.brokenImages.get("https://a.test/gone.png"), 404);
  assert.deepEqual(ctx.hostVariants.map((v) => [v.from, v.ok]), [["http://a.test/", true], ["https://www.a.test/", false]]);
  assert.equal(ctx.tls, null);
});

test("every new rule has a why and a fix", () => {
  for (const r of ["host-variant-not-redirected", "ssl-expiring", "pagination-canonical-first", "tracking-duplicate", "viewport-fixed-width", "viewport-no-zoom", "image-broken", "image-no-size", "image-filename-generic", "hero-image-lazy", "no-cta", "hard-to-read"]) assert.ok(RULES[r]?.why && RULES[r]?.fix, r);
});
