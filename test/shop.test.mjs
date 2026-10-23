// E-commerce pack data: Product markup gaps, price shown vs marked up, stock, thin categories, parameter-URL crawl traps,
// routing to the e-commerce agent, and the job against a fake shop.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productGaps, priceShown, shopPage, crawlTraps, analyseShop, shopMarkdown } from "../src/analysis/shop.mjs";
import { routeAgents } from "../src/analysis/agent-router.mjs";
import { run } from "../src/jobs/shop.mjs";

const product = (extra = {}, offer = {}) => ({ "@type": "Product", name: "Trail Shoe", image: "https://s.test/i.jpg", brand: { "@type": "Brand", name: "Acme" }, sku: "TS-1", description: "A shoe.", offers: { "@type": "Offer", price: "1299.00", priceCurrency: "GBP", availability: "https://schema.org/InStock", ...offer }, ...extra });

test("product fields: required and recommended gaps", () => {
  assert.deepEqual(productGaps(product()), { required: [], recommended: [] });
  assert.deepEqual(productGaps({ "@type": "Product", name: "X" }), { required: ["offers"], recommended: ["image", "brand", "gtin, mpn or sku", "description"] });
  assert.deepEqual(productGaps(product({}, { price: undefined, priceCurrency: undefined })).required, ["offers.price", "offers.priceCurrency"]);
  assert.deepEqual(productGaps(product({ offers: { "@type": "AggregateOffer", lowPrice: 10, priceCurrency: "EUR", offers: [{ availability: "InStock" }] } })).required, [], "aggregate offers count");
});

test("price shown: matches common formats; a stale price is caught", () => {
  for (const t of ["Now £1,299.00", "£1299", "1 299 GBP", "Price: 1299.00"]) assert.ok(priceShown("1299.00", t), t);
  assert.equal(priceShown("1299.00", "Now £1,199.00, was £1,399.00"), false);
  assert.ok(priceShown("19.5", "Only €19.50 today"));
});

test("shop findings: missing markup, price mismatch, stock, discontinued, thin categories", () => {
  const pages = [
    shopPage({ url: "https://s.test/products/a", nodes: [product()], text: "Trail Shoe £1,299.00", words: 300 }),
    shopPage({ url: "https://s.test/products/b", nodes: [], text: "Boot £80", words: 200 }),
    shopPage({ url: "https://s.test/products/c", nodes: [product({}, { price: "80" })], text: "Now £60 in the sale", words: 200 }),
    shopPage({ url: "https://s.test/products/d", nodes: [product({}, { availability: "https://schema.org/OutOfStock" })], text: "£1299", words: 200 }),
    shopPage({ url: "https://s.test/products/e", nodes: [product({}, { availability: "Discontinued" })], text: "£1299", words: 200 }),
    shopPage({ url: "https://s.test/collections/shoes", nodes: [], text: "Shoes", words: 12 }),
  ];
  const r = analyseShop(pages);
  const by = (id) => r.findings.find((f) => f.id === id);
  assert.deepEqual([r.productPages, r.categoryPages], [5, 1]);
  assert.deepEqual(by("product-no-markup").pages, ["https://s.test/products/b"]);
  assert.deepEqual(by("price-not-shown").pages, ["https://s.test/products/c"], "the page shows 60 now; the markup says 80");
  assert.deepEqual(by("out-of-stock").pages, ["https://s.test/products/d"]);
  assert.deepEqual(by("discontinued").pages, ["https://s.test/products/e"]);
  assert.deepEqual(by("category-thin").pages, ["https://s.test/collections/shoes"]);
  assert.match(shopMarkdown({ siteName: "S", result: r }), /HIGH: 1 product page\(s\) have no Product markup/);
});

test("crawl traps: indexable parameter URLs without a canonical to the clean page; filter keys linked many times", () => {
  const links = Array.from({ length: 12 }, (_, i) => `https://s.test/collections/shoes?color=c${i}`);
  const audit = [
    { url: "https://s.test/collections/shoes", status: 200, links },
    { url: "https://s.test/collections/shoes?color=c1", status: 200, canonical: null, links: [] },
    { url: "https://s.test/collections/shoes?color=c2", status: 200, canonical: "https://s.test/collections/shoes", links: [] },
    { url: "https://s.test/collections/shoes?sort=price", status: 200, noindex: true, links: [] },
  ];
  const t = crawlTraps(audit);
  assert.deepEqual(t.indexable.map((x) => x.url), ["https://s.test/collections/shoes?color=c1"], "canonicalised and noindexed ones are fine");
  assert.equal(t.params[0].key, "color"); assert.equal(t.params[0].urls, 12); assert.ok(t.params[0].facet);
  const r = analyseShop([], audit);
  assert.ok(r.findings.some((f) => f.id === "parameter-urls-indexable"));
  assert.match(r.findings.find((f) => f.id === "facet-crawl-trap").detail, /\?color= on 12 URL/);
});

test("routing: shop problems go to the e-commerce agent with clean page targets; low-only findings do not", () => {
  const shop = { findings: [{ id: "price-not-shown", severity: "high", title: "1 price", pages: ["https://s.test/products/c", "https://s.test/x?color=1"] }] };
  const step = routeAgents({ profile: { mode: "edit", platform: { name: "Shopify" }, signals: { structuredData: [] } }, shop }).steps.find((s) => s.agent === "seo-ecommerce");
  assert.match(step.why, /shop check found 1 problem/); assert.deepEqual(step.targets, ["/products/c"]);
  const quiet = routeAgents({ profile: { mode: "edit", signals: { structuredData: [] } }, shop: { findings: [{ id: "out-of-stock", severity: "low", title: "x", pages: [] }] } });
  assert.ok(!quiet.steps.some((s) => s.agent === "seo-ecommerce"));
});

test("job: skips sites that are not shops; samples product and category pages of a shop", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-shop-")), state = join(root, "state"); mkdirSync(state, { recursive: true });
  const site = { id: "s", name: "S", url: "https://s.test/", paths: { state, root, data: root } };
  const log = console.log; console.log = () => {};
  try {
    await run({ site, flags: {} }, { fetch: async () => { throw new Error("must not fetch"); }, delayMs: 0 });
    assert.match(JSON.parse(readFileSync(join(state, "shop.json"), "utf8")).skipped, /not an online shop/);
    writeFileSync(join(state, "audit.json"), JSON.stringify({ pages: [
      { url: "https://s.test/", status: 200, links: [] }, { url: "https://s.test/products/a", status: 200, types: ["Product"], links: [] },
      { url: "https://s.test/collections/shoes", status: 200, links: [] }, { url: "https://s.test/blog/post", status: 200, links: [] },
    ] }));
    const html = (inner, ld) => `<html><body><main>${inner}</main>${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ""}</body></html>`;
    const pagesHtml = { "/products/a": html("<p>Trail Shoe £1,299.00</p>", product()), "/collections/shoes": html("<p>Shoes</p>") };
    const fetched = [];
    const f = async (u) => { const p = new URL(u).pathname; fetched.push(p); if (p === "/robots.txt") return new Response("", { status: 404 }); return pagesHtml[p] ? new Response(pagesHtml[p], { headers: { "content-type": "text/html" } }) : new Response("no", { status: 404 }); };
    await run({ site: { ...site, verticals: ["ecommerce"] }, flags: {} }, { fetch: f, delayMs: 0 });
    const out = JSON.parse(readFileSync(join(state, "shop.json"), "utf8"));
    assert.ok(!fetched.includes("/blog/post") && !fetched.includes("/"), "only product and category pages");
    assert.deepEqual([out.productPages, out.categoryPages], [1, 1]);
    assert.ok(out.findings.some((x) => x.id === "category-thin"));
    assert.ok(!out.findings.some((x) => x.id === "price-not-shown"));
  } finally { console.log = log; }
});
