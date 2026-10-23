// Online shop checks for the e-commerce pack: Product markup coverage and price match, stock handling, thin category pages,
// and filter/sort parameter URLs that turn into crawl traps. Needs no key.
//   npx seo-autopilot run shop [--pages 40] [--force]
// Pages: product pages (Product markup or product-like paths in the audit) and category pages, up to --pages, each fetched
// once from your own site (robots.txt respected). Parameter URLs are judged from the audit, without fetching. Runs only
// for sites the e-commerce pack applies to; --force runs it anyway. Writes shop.json and shop.md. It never edits a file.
import { readJson, writeJson, writeText, sleep } from "../core/util.mjs";
import { politeFetch } from "./optimize.mjs";
import { extractPage, mainScope, blockText } from "../audit/extract.mjs";
import { jsonldNodes } from "../analysis/schema.mjs";
import { shopPage, analyseShop, shopMarkdown, PRODUCT_PATH, CATEGORY_PATH } from "../analysis/shop.mjs";
import { detectVerticals } from "../analysis/verticals.mjs";

export const description = "Online shop: Product markup and price match, stock handling, thin categories, filter-parameter crawl traps";

export async function run({ site, flags = {} }, deps = {}) {
  const f = deps.fetch || globalThis.fetch, s = site.paths.state, n = Number(flags.pages || 40);
  const profile = readJson(`${s}/site-profile.json`, null);
  if (!flags.force && !detectVerticals({ profile, site }).some((p) => p.pack === "ecommerce")) {
    writeJson(`${s}/shop.json`, { generatedAt: new Date().toISOString(), skipped: "not an online shop (e-commerce pack not detected or not set)" });
    console.log(`shop: skipped for ${site.id}: the e-commerce pack does not apply. Set "verticals": ["ecommerce"] in the config, or run with --force.`);
    return;
  }
  const audit = readJson(`${s}/audit.json`, { pages: [] });
  const live = (audit.pages || []).filter((p) => p.status === 200 && !p.noindex && !p.url.includes("?"));
  const path = (u) => { try { return new URL(u).pathname; } catch { return ""; } };
  const products = live.filter((p) => (p.types || []).some((t) => /^(Product|ProductGroup)$/.test(t)) || PRODUCT_PATH.test(path(p.url))).map((p) => p.url);
  const cats = live.filter((p) => CATEGORY_PATH.test(path(p.url)) && !products.includes(p.url)).map((p) => p.url);
  // Two products for every category, so both kinds are sampled on a large shop.
  const urls = [...new Set([...products.slice(0, Math.ceil(n * 2 / 3)), ...cats.slice(0, Math.floor(n / 3)), ...products])].slice(0, n);
  const pages = [], skipped = [];
  for (const [i, url] of urls.entries()) {
    if (i) await sleep(deps.delayMs ?? 300);
    const got = await politeFetch(url, f);
    if (got.error) { skipped.push({ url, error: got.error }); continue; }
    const words = blockText(mainScope(got.html));
    pages.push(shopPage({ url, nodes: jsonldNodes(got.html).nodes, text: words, words: extractPage(got.html, url).words }));
  }
  const result = analyseShop(pages, audit.pages || []);
  writeJson(`${s}/shop.json`, { generatedAt: new Date().toISOString(), ...result, pages: pages.map(({ text, ...rest }) => rest), skipped });
  writeText(`${s}/shop.md`, shopMarkdown({ siteName: site.name, result, skipped }));
  const high = result.findings.filter((x) => x.severity === "high").length;
  console.log(`shop: ${site.id}: checked ${pages.length} page(s) (${result.productPages} product, ${result.categoryPages} category), ${result.findings.length} finding(s), ${high} high.${skipped.length ? ` ${skipped.length} could not be fetched.` : ""}${audit.pages?.length ? "" : " Run the audit first so product and category pages are found."}`);
}
