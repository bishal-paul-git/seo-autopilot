// Online shop checks (the e-commerce pack's data). Pure: pass in what pages show and the audit, get findings back.
//  - Product markup: Google's product results need Product with name and an Offer with price, priceCurrency and availability;
//    image, brand and a GTIN or SKU are strongly recommended. The price in markup must be the price the page shows.
//  - Stock: out-of-stock products should stay live (with alternatives); discontinued ones need a decision, not a soft 404.
//  - Crawl traps: filter, sort and session parameters multiply URLs. Indexable parameter URLs without a canonical to the clean
//    page waste crawling and split signals.
//  - Categories: thin category pages (a grid with no words) rarely rank for the category's own query.
const flat = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const typesOf = (n) => flat(n?.["@type"]).map(String);
export const PRODUCT_PATH = /\/(products?|p|item|items|dp|shop\/[^/]+\/[^/]+)(\/|$)/i;
export const CATEGORY_PATH = /\/(collections?|categor(y|ies)|c|shop|department|range)(\/|$)/i;
// Parameters that only filter, sort, page or track: the clean URL holds the same content.
export const FACET_PARAMS = /^(sort|order|orderby|dir|filter|filters|f|color|colour|size|price|min_price|max_price|brand|rating|view|limit|per_page|page_size|layout|grid|q|query|sessionid|sid|utm_[a-z]+|ref|variant)$/i;

/** Product nodes in a page's JSON-LD (offers flattened). */
export function productNodes(nodes = []) {
  const out = [];
  const walk = (n) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) return n.forEach(walk); if (typesOf(n).some((t) => /^(Product|ProductGroup)$/.test(t))) out.push(n); flat(n["@graph"]).forEach(walk); flat(n.hasVariant).forEach(walk); };
  walk(nodes);
  return out;
}

const offersOf = (p) => flat(p.offers).flatMap((o) => (typesOf(o).includes("AggregateOffer") ? [o, ...flat(o.offers)] : [o]));
const availability = (o) => String(o?.availability || "").replace(/^https?:\/\/schema\.org\//i, "");

/** Missing required and recommended product fields. */
export function productGaps(p) {
  const offers = offersOf(p), req = [], rec = [];
  if (!p.name) req.push("name");
  if (!offers.length) req.push("offers");
  else {
    if (!offers.some((o) => o.price != null || o.lowPrice != null)) req.push("offers.price");
    if (!offers.some((o) => o.priceCurrency)) req.push("offers.priceCurrency");
    if (!offers.some((o) => o.availability)) rec.push("offers.availability");
  }
  if (!p.image) rec.push("image");
  if (!p.brand) rec.push("brand");
  if (!(p.gtin || p.gtin8 || p.gtin12 || p.gtin13 || p.gtin14 || p.mpn || p.sku)) rec.push("gtin, mpn or sku");
  if (!p.description) rec.push("description");
  return { required: req, recommended: rec };
}

/** Does the visible text show this price? Compares digits, so 1,299.00 / 1299 / £1 299 all match 1299. Any price on the page
 *  counts, so a stale markup price that equals a shown "was" price is not caught: conservative, to avoid false alarms. */
export function priceShown(price, text) {
  const n = Number(String(price).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return true;
  const want = [String(Math.round(n * 100) / 100), n.toFixed(2), String(Math.trunc(n))];
  const nums = String(text).match(/\d[\d.,\s]*\d|\d/g) || [];
  return nums.some((x) => { const d = x.replace(/[\s,]/g, ""); return want.includes(d) || want.includes(d.replace(/\.00$/, "")); });
}

/** Facts from one fetched product or category page. */
export function shopPage({ url, nodes = [], text = "", words = 0 }) {
  const path = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
  const products = productNodes(nodes);
  return {
    url, words,
    kind: products.length || PRODUCT_PATH.test(path) ? "product" : CATEGORY_PATH.test(path) ? "category" : "other",
    products: products.map((p) => ({ name: p.name || null, gaps: productGaps(p), availability: offersOf(p).map(availability).filter(Boolean), prices: offersOf(p).map((o) => o.price ?? o.lowPrice).filter((x) => x != null) })),
    text,
  };
}

/** Parameterised URLs in the audit: crawled ones that are indexable without a canonical elsewhere, and links to them. */
export function crawlTraps(auditPages = []) {
  const byKey = new Map(), indexable = [];
  const seen = (u) => { try { return new URL(u); } catch { return null; } };
  const addKey = (k, u) => { if (!byKey.has(k)) byKey.set(k, new Set()); byKey.get(k).add(u); };
  for (const p of auditPages) {
    for (const u of [p.url, ...(p.links || [])]) {
      const x = seen(u); if (!x || !x.search) continue;
      for (const k of x.searchParams.keys()) addKey(k.toLowerCase(), x.toString());
    }
    const x = seen(p.url);
    if (x?.search && p.status === 200 && !p.noindex) {
      const clean = `${x.origin}${x.pathname}`;
      const canon = p.canonical ? seen(p.canonical) : null;
      if (!canon || canon.search || canon.toString() === x.toString()) indexable.push({ url: p.url, clean, canonical: p.canonical || null });
    }
  }
  const params = [...byKey].map(([key, urls]) => ({ key, urls: urls.size, facet: FACET_PARAMS.test(key) })).sort((a, b) => b.urls - a.urls);
  return { params, indexable };
}

/** Findings across the shop. pages: shopPage[]; audit: audit.json pages. */
export function analyseShop(pages = [], auditPages = []) {
  const findings = [];
  const productPages = pages.filter((p) => p.kind === "product"), categories = pages.filter((p) => p.kind === "category");
  const noMarkup = productPages.filter((p) => !p.products.length);
  if (noMarkup.length) findings.push({ id: "product-no-markup", severity: "high", title: `${noMarkup.length} product page(s) have no Product markup`, detail: noMarkup.slice(0, 6).map((p) => p.url).join("; ") + ". Without it, product results (price, stock, ratings) cannot show.", pages: noMarkup.map((p) => p.url) });
  const reqGaps = productPages.filter((p) => p.products.some((x) => x.gaps.required.length));
  if (reqGaps.length) findings.push({ id: "product-required-missing", severity: "high", title: `${reqGaps.length} product page(s) miss required Product fields`, detail: reqGaps.slice(0, 6).map((p) => `${p.url}: ${[...new Set(p.products.flatMap((x) => x.gaps.required))].join(", ")}`).join("; "), pages: reqGaps.map((p) => p.url) });
  const recGaps = productPages.filter((p) => p.products.length && p.products.every((x) => x.gaps.recommended.length >= 2));
  if (recGaps.length) findings.push({ id: "product-recommended-missing", severity: "low", title: `${recGaps.length} product page(s) miss recommended fields`, detail: recGaps.slice(0, 6).map((p) => `${p.url}: ${[...new Set(p.products.flatMap((x) => x.gaps.recommended))].join(", ")}`).join("; "), pages: recGaps.map((p) => p.url) });
  const mismatch = productPages.filter((p) => p.products.some((x) => x.prices.length && !x.prices.some((pr) => priceShown(pr, p.text))));
  if (mismatch.length) findings.push({ id: "price-not-shown", severity: "high", title: `${mismatch.length} product page(s) mark up a price the page does not show`, detail: mismatch.slice(0, 6).map((p) => `${p.url}: markup ${p.products.flatMap((x) => x.prices).join(", ")}`).join("; ") + ". Google's policy: markup must match what shoppers see. Check for stale prices or currency formatting.", pages: mismatch.map((p) => p.url) });
  const oos = productPages.filter((p) => p.products.some((x) => x.availability.some((a) => /OutOfStock|SoldOut/i.test(a))));
  if (oos.length) findings.push({ id: "out-of-stock", severity: "low", title: `${oos.length} product page(s) are out of stock`, detail: "Keep them live with the right availability and links to alternatives. Only remove or redirect a page when the product will not return. " + oos.slice(0, 6).map((p) => p.url).join("; "), pages: oos.map((p) => p.url) });
  const gone = productPages.filter((p) => p.products.some((x) => x.availability.some((a) => /Discontinued/i.test(a))));
  if (gone.length) findings.push({ id: "discontinued", severity: "medium", title: `${gone.length} discontinued product page(s) are still live`, detail: "Decide per page with the owner: redirect to the closest replacement, keep as an information page, or remove (410). " + gone.slice(0, 6).map((p) => p.url).join("; "), pages: gone.map((p) => p.url) });
  const thin = categories.filter((p) => p.words < 150);
  if (thin.length) findings.push({ id: "category-thin", severity: "medium", title: `${thin.length} category page(s) have under 150 words of their own`, detail: thin.slice(0, 6).map((p) => `${p.url} (${p.words} words)`).join("; ") + ". A short, useful introduction (what is in the range, how to choose) helps the page rank for its own query.", pages: thin.map((p) => p.url) });
  const traps = crawlTraps(auditPages);
  const facetKeys = traps.params.filter((x) => x.facet && x.urls >= 5);
  if (traps.indexable.length) findings.push({ id: "parameter-urls-indexable", severity: traps.indexable.length >= 20 ? "high" : "medium", title: `${traps.indexable.length} parameter URL(s) are indexable without a canonical to the clean page`, detail: traps.indexable.slice(0, 6).map((x) => `${x.url} (clean: ${x.clean})`).join("; ") + ". Add a canonical to the clean URL, or noindex filter combinations that have no search demand.", pages: traps.indexable.map((x) => x.url) });
  if (facetKeys.length) findings.push({ id: "facet-crawl-trap", severity: facetKeys.some((x) => x.urls >= 50) ? "high" : "medium", title: `Filter and sort parameters create many crawlable URLs`, detail: facetKeys.slice(0, 8).map((x) => `?${x.key}= on ${x.urls} URL(s)`).join("; ") + ". Link filters with care (no follow for combinations, or one parameter at a time), and keep canonicals on the clean category.", pages: [] });
  return { checked: pages.length, productPages: productPages.length, categoryPages: categories.length, params: traps.params.slice(0, 15), findings };
}

export function shopMarkdown({ siteName, result, skipped = [] }) {
  const L = [`# Online shop check: ${siteName}`, "", `Checked ${result.checked} page(s): ${result.productPages} product, ${result.categoryPages} category.`, ""];
  if (result.params.length) L.push("## URL parameters seen in the crawl", "", ...result.params.map((p) => `- \`${p.key}\` on ${p.urls} URL(s)${p.facet ? " (filter, sort or tracking)" : ""}`), "");
  L.push("## Findings", "");
  if (!result.findings.length) L.push("Nothing to fix on the pages checked.");
  for (const f of result.findings) L.push(`### ${f.severity.toUpperCase()}: ${f.title}`, "", f.detail, "");
  if (skipped.length) L.push("## Could not check", "", ...skipped.map((s) => `- ${s.url}: ${s.error}`), "");
  L.push("Merchant Center and feed data are not checked here (they need your own Google access; see docs/roadmap/12-vertical-packs.md).");
  return L.join("\n") + "\n";
}
