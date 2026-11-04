// Scan a website from its address alone: crawl it, run the audit rules, detect the platform, read its business details,
// and build the client-portal snapshot. Used by the hosted worker (cloud/portal/supabase/functions/crawl) for sites
// connected by URL, with no repository and no GitHub Actions. Network goes through `fetchImpl`, so tests run offline.
// No writes: the caller stores the result.
import { crawlSite, fetchPage } from "../audit/crawl.mjs";
import { runChecks, summarize } from "../audit/rules.mjs";
import { detectProfile } from "../analysis/site-profile.mjs";
import { discoverSite, pagesToRead } from "../analysis/discover.mjs";
import { buildSnapshot } from "../analysis/portal.mjs";

const UA = "seo-autopilot-scan/2 (+https://github.com/bishal-paul-git/seo-autopilot)";

/** The site's sitemap: the first Sitemap: line in robots.txt, else /sitemap.xml. */
export function sitemapFrom(robotsTxt, siteUrl) {
  const m = /^\s*sitemap:\s*(\S+)/im.exec(robotsTxt || "");
  try { return m ? new URL(m[1], siteUrl).toString() : new URL("/sitemap.xml", siteUrl).toString(); } catch { return new URL("/sitemap.xml", siteUrl).toString(); }
}

/** Compact page rows, the same shape the audit job keeps in audit.json (the portal snapshot reads them). */
function compactPages(pages, siteUrl) {
  const host = new URL(siteUrl).host;
  const internal = (p) => [...new Set((p.links || []).map((l) => l.url).filter((u) => { try { return new URL(u).host === host; } catch { return false; } }))];
  return pages.map((p) => ({ url: p.url, finalUrl: p.finalUrl, status: p.status, title: p.title || "", h1: p.h1s?.[0] || "", description: p.description ?? null, links: internal(p), words: p.words || 0, depth: p.depth, inbound: p.inbound, canonical: p.canonical || null, types: p.jsonld?.types || [], inSitemap: p.inSitemap, noindex: /noindex/i.test(p.robots || "") || /noindex/i.test(p.xRobots || ""), ttfb: Math.round(p.ttfb || 0) }));
}

/**
 * site: { id, name, url }. Returns { snapshot, discovered, profile, audit }.
 * opts: { fetchImpl, maxPages (default 60), concurrency, now }
 */
export async function scanSite(site, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date().toISOString();
  const get = (u) => fetchImpl(u, { headers: { "User-Agent": UA } }).then(async (r) => ({ ok: r.ok, status: r.status, text: r.ok ? await r.text() : "", headers: Object.fromEntries(r.headers.entries()) })).catch(() => ({ ok: false, status: 0, text: "", headers: {} }));

  const robots = await get(new URL("/robots.txt", site.url).toString());
  const sitemap = sitemapFrom(robots.ok ? robots.text : "", site.url);
  const { pages, ctx } = await crawlSite({ url: site.url, sitemap, audit: { engine: "node" } }, { engine: "node", maxPages: opts.maxPages ?? 60, concurrency: opts.concurrency ?? 6, fetchImpl });
  if (!pages.some((p) => p.status === 200 && p.isHtml)) throw new Error(`could not read ${site.url}: ${pages[0]?.status ? `HTTP ${pages[0].status}` : "no response"}`);

  const issues = runChecks(pages, { ...ctx });
  const summary = summarize(issues, pages.length);
  const audit = { generatedAt: now, summary, issues, pages: compactPages(pages, site.url) };

  const docs = [];
  for (const u of pagesToRead(site.url, pages)) {
    const r = await fetchPage(u, { fetchImpl });
    if (r.isHtml && r.status === 200) docs.push({ url: r.finalUrl, html: r.html, headers: {} });
  }
  const home = await get(site.url);
  const sitemapXml = (await get(sitemap)).text;
  const hasLlms = (await get(new URL("/llms.txt", site.url).toString())).ok;
  const profile = detectProfile({ html: docs[0]?.html || home.text, headers: home.headers, robotsTxt: robots.ok ? robots.text : "", sitemapXml, hasLlms, url: site.url });
  const discovered = discoverSite({ siteUrl: site.url, docs, pages, sitemapUrls: ctx.sitemapUrls || [], robotsTxt: ctx.robotsTxt });

  const snapshot = buildSnapshot({ site: { id: site.id, name: site.name, url: site.url }, reports: { audit, profile }, now, options: { schedule: "Scanned daily from its address" } });
  snapshot.discovered = discovered;
  snapshot.source = { kind: "url", crawler: "hosted", maxPages: opts.maxPages ?? 60 };
  snapshot.integrations = [
    { name: "Website scan", ok: true, note: `${summary.pagesCrawled} pages read from the live site` },
    ...snapshot.integrations.filter((i) => i.name !== "AI agents"),
  ];
  return { snapshot, discovered, profile, audit };
}
