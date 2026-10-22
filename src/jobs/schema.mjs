// Structured data: for the home page and your most important pages, check existing JSON-LD (required fields, visible-page
// match) and draft what is missing (Organization, WebSite, Article, BreadcrumbList, FAQPage) from facts the page shows.
//   npx seo-autopilot run schema [--pages 30]
// Pages: the home page, your top pages by clicks (gsc-rows.json), then the rest of the audit, up to --pages. Each is fetched
// once from your own site. Writes schema.json and schema.md. It never edits a file: the seo-schema-engineer applies drafts.
import { readJson, writeJson, writeText, sleep } from "../core/util.mjs";
import { politeFetch } from "./optimize.mjs";
import { extractPage, mainScope, blockText } from "../audit/extract.mjs";
import { jsonldNodes, checkNode, suggest, crumbs, schemaMarkdown } from "../analysis/schema.mjs";

export const description = "Structured data: check existing markup against requirements and the visible page; draft missing markup from page facts";

const meta = (html, re) => (String(html).match(re) || [])[1] || null;

export async function run({ site, flags = {} }, deps = {}) {
  const f = deps.fetch || globalThis.fetch, s = site.paths.state, n = Number(flags.pages || 30);
  const audit = readJson(`${s}/audit.json`, { pages: [] });
  const titles = new Map((audit.pages || []).filter((p) => p.status === 200).map((p) => [p.url.replace(/\/$/, "") || p.url, p.h1 || p.title]));
  titles.set(new URL(site.url).origin + "/", titles.get(new URL(site.url).origin) || "Home");
  const clicks = new Map();
  for (const r of readJson(`${s}/gsc-rows.json`, { rows: [] }).rows || []) clicks.set(r.page, (clicks.get(r.page) || 0) + (r.clicks || 0));
  const urls = [...new Set([site.url, ...[...clicks].sort((a, b) => b[1] - a[1]).map(([u]) => u), ...(audit.pages || []).filter((p) => p.status === 200 && !p.noindex).map((p) => p.url)])].slice(0, n);
  const ctx = { siteName: site.name, siteUrl: site.url, logo: site.research?.logo || null, sameAs: site.research?.sameAs || [] };
  const results = [];
  for (const [i, url] of urls.entries()) {
    if (i) await sleep(deps.delayMs ?? 300);
    const got = await politeFetch(url, f);
    if (got.error) { results.push({ url, error: got.error, checks: [], suggestions: [] }); continue; }
    const html = got.html, p = extractPage(html, url), blocks = blockText(mainScope(html)).split("\n");
    const { nodes, invalid } = jsonldNodes(html);
    const text = blocks.join("\n");
    const published = meta(html, /property=["']article:published_time["'][^>]*content=["']([^"']+)/i) || meta(html, /<time[^>]+datetime=["']([^"']+)/i);
    const page = {
      url, title: p.title, h1: p.h1s[0] || "", description: p.description, blocks, isHome: url.replace(/\/$/, "") === site.url.replace(/\/$/, ""),
      published: published ? published.slice(0, 10) : null, modified: (meta(html, /property=["']article:modified_time["'][^>]*content=["']([^"']+)/i) || "").slice(0, 10) || null,
      author: meta(html, /name=["']author["'][^>]*content=["']([^"']+)/i), image: p.og?.image || null,
      kind: /\/(blog|news|articles?|posts?|guides?|insights)\//i.test(url) || published ? "article" : "page",
    };
    results.push({ url, invalid, types: nodes.flatMap((x) => [].concat(x["@type"])), checks: nodes.map((x) => checkNode(x, { text, h1: page.h1, title: page.title })), suggestions: suggest(page, nodes, { ...ctx, crumbs: page.isHome ? [] : crumbs(url, titles) }) });
  }
  writeJson(`${s}/schema.json`, { generatedAt: new Date().toISOString(), results });
  const md = schemaMarkdown({ siteName: site.name, results });
  writeText(`${s}/schema.md`, md);
  console.log(md);
}
