// Content optimiser: score one page or draft against the pages that rank for its query, with the terms, sections, questions,
// length and readability they share, and a short list of what to do.
//   npx seo-autopilot run optimize --query "web hosting for small business" --url https://example.com/hosting
//   npx seo-autopilot run optimize --query "..." --file src/content/blog/draft.md [--compare https://a.com/x,https://b.com/y] [--top 6]
// Competitor pages: --compare, else the top results from your SERP provider (your own site and big platforms skipped).
// Each competitor page is fetched once, politely (robots.txt respected, one request, 20-second timeout).
// Writes optimize/<slug>.json and optimize/<slug>.md in the state folder.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeJson, writeText, sleep } from "../core/util.mjs";
import { pickProvider } from "../lib/serp.mjs";
import { extractPage, mainScope, blockText, headingOutline } from "../audit/extract.mjs";
import { robotsDisallows } from "../audit/rules.mjs";
import { PLATFORMS } from "../analysis/gap.mjs";
import { optimise, optimiseMarkdown } from "../analysis/optimize.mjs";
import { marketOf } from "./keywords.mjs";

export const description = "Content optimiser: score a page or draft against top-ranking pages (terms, sections, questions, length, readability)";

const UA = "seo-autopilot-optimizer/1.0 (+https://github.com/bishal-paul-git/seo-autopilot)";

/** Plain page facts from HTML: main text, outline, title, H1 and description. */
export function fromHtml(html, url) {
  const p = extractPage(html, url);
  return { url, title: p.title, h1: p.h1s[0] || "", description: p.description || "", headings: headingOutline(html), text: blockText(mainScope(html)) };
}

/** A Markdown or MDX draft: front matter title and description, # headings, text without markup. */
export function fromMarkdown(src, url = "") {
  const fm = (src.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || "";
  const field = (k) => ((fm.match(new RegExp(`^${k}:\\s*["']?(.*?)["']?\\s*$`, "m")) || [])[1] || "");
  const body = src.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
  const headings = [...body.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => ({ level: m[1].length, text: m[2].replace(/[*_`]/g, "").trim() }));
  const text = body.replace(/```[\s\S]*?```/g, " ").replace(/<[^>]+>/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/[*_`>|]/g, " ").replace(/[ \t]+/g, " ");
  return { url, title: field("title"), h1: headings.find((h) => h.level === 1)?.text || field("title"), description: field("description"), headings, text };
}

async function politeFetch(url, f) {
  const u = new URL(url);
  try {
    const robots = await f(`${u.origin}/robots.txt`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10000) });
    if (robots.ok && robotsDisallows(await robots.text(), u.pathname)) return { error: "robots.txt disallows it" };
  } catch { /* no robots.txt reachable: allowed */ }
  try {
    const r = await f(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    if (!/html/i.test(r.headers?.get?.("content-type") || "text/html")) return { error: "not an HTML page" };
    return { html: (await r.text()).slice(0, 2_000_000) };
  } catch (e) { return { error: e.name === "TimeoutError" ? "timed out" : "unreachable" }; }
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "page";

export async function run({ site, flags = {} }, deps = {}) {
  const env = deps.env || process.env, f = deps.fetch || globalThis.fetch;
  const query = String(flags.query || "").trim();
  if (!query || (!flags.url && !flags.file)) { console.log('optimize: give --query "the search" and --url <page> or --file <draft>.'); return; }
  const own = new URL(site.url).hostname.replace(/^www\./, "");
  let page;
  if (flags.file) {
    const path = resolve(site.paths.root, String(flags.file));
    const src = readFileSync(path, "utf8");
    page = /\.html?$/i.test(path) ? fromHtml(src, String(flags.file)) : fromMarkdown(src, String(flags.file));
  } else {
    const got = await politeFetch(String(flags.url), f);
    if (got.error) { console.log(`optimize: could not read ${flags.url}: ${got.error}`); return; }
    page = fromHtml(got.html, String(flags.url));
  }

  const notes = [];
  let urls = flags.compare ? String(flags.compare).split(",").map((x) => x.trim()).filter(Boolean) : [];
  if (!urls.length) {
    const provider = pickProvider(env);
    if (!provider) { console.log("optimize: pass --compare url1,url2,... or set a SERP provider key (BRAVE_API_KEY, SERPAPI_KEY or DataForSEO) to find the top pages."); return; }
    const r = await provider.search(query, marketOf(site), { fetch: f, env });
    const skip = (d) => d === own || d.endsWith(`.${own}`) || PLATFORMS.has(d) || [...PLATFORMS].some((p) => d.endsWith(`.${p}`));
    urls = r.results.filter((x) => !skip(x.domain)).slice(0, Number(flags.top || 6)).map((x) => x.url);
    notes.push(`Top pages from ${provider.name} (${marketOf(site)}); your site and large platforms skipped.`);
  }
  const competitors = [];
  for (const [i, u] of urls.entries()) {
    if (i) await sleep(deps.delayMs ?? 500);
    const got = await politeFetch(u, f);
    if (got.error) { notes.push(`${u}: ${got.error}`); continue; }
    competitors.push({ ...fromHtml(got.html, u), domain: new URL(u).hostname.replace(/^www\./, "") });
  }
  const r = optimise(page, competitors, query);
  const name = slug(flags.file || new URL(String(flags.url)).pathname || query);
  const dir = `${site.paths.state}/optimize`;
  writeJson(`${dir}/${name}.json`, { generatedAt: new Date().toISOString(), page: page.url, notes, ...r });
  const md = optimiseMarkdown(r, { url: page.url, siteName: site.name }) + (notes.length ? `\n## Notes\n${notes.map((x) => `- ${x}`).join("\n")}\n` : "");
  writeText(`${dir}/${name}.md`, md);
  console.log(md);
}
