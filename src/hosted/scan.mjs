// Scan a website from its address alone: crawl it, run the audit rules, detect the platform, read its business details,
// and build the client-portal snapshot. Used by the hosted worker (cloud/portal/supabase/functions/crawl) for sites
// connected by URL, with no repository and no GitHub Actions. Network goes through `fetchImpl`, so tests run offline.
// No writes: the caller stores the result.
import { crawlSite, fetchPage } from "../audit/crawl.mjs";
import { runChecks, summarize, RULES } from "../audit/rules.mjs";
import { detectProfile } from "../analysis/site-profile.mjs";
import { discoverSite, pagesToRead } from "../analysis/discover.mjs";
import { buildSnapshot } from "../analysis/portal.mjs";
import { buildPriorities } from "../analysis/priorities.mjs";

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

const day = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * Search Console rows for a site added by address, when the site's owner has added the scanning service account as a user.
 * Tries the domain property, then the URL-prefix property. Returns null when neither is shared (that is the normal case
 * until the owner adds the email), so a scan never fails for lack of Google access.
 */
export async function searchConsoleRows(siteUrl, token, { fetchImpl = fetch, now = Date.now() } = {}) {
  const host = new URL(siteUrl).hostname.replace(/^www\./, "");
  const end = now - 2 * 864e5, start = end - 27 * 864e5, prevEnd = start - 864e5, prevStart = prevEnd - 27 * 864e5;
  for (const property of [`sc-domain:${host}`, new URL("/", siteUrl).toString()]) {
    const q = async (a, b) => {
      const r = await fetchImpl(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ startDate: day(a), endDate: day(b), dimensions: ["query", "page"], rowLimit: 5000 }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error?.message || `HTTP ${r.status}`);
      return (j.rows || []).map((x) => ({ query: x.keys[0], page: x.keys[1], clicks: x.clicks, impressions: x.impressions, position: Number(Number(x.position).toFixed(1)) }));
    };
    try {
      const [rows, prevRows] = await Promise.all([q(start, end), q(prevStart, prevEnd)]);
      return { property, window: { start: day(start), end: day(end) }, prevWindow: { start: day(prevStart), end: day(prevEnd) }, rows, prevRows };
    } catch { /* not shared with us, or not this kind of property: try the next one */ }
  }
  return null;
}

/**
 * site: { id, name, url }. Returns { snapshot, discovered, profile, audit }.
 * opts: { fetchImpl, maxPages (default 60), concurrency, now, googleToken: async () => token (optional), googleEmail }
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

  let gscRows = null;
  if (opts.googleToken) { try { gscRows = await searchConsoleRows(site.url, await opts.googleToken(), { fetchImpl }); } catch { gscRows = null; } }
  const priorities = { items: buildPriorities({ audit, rules: RULES }) };

  const snapshot = buildSnapshot({ site: { id: site.id, name: site.name, url: site.url }, reports: { audit, profile, gscRows: gscRows || undefined, priorities }, now, options: { schedule: "Scanned daily from its address" } });
  snapshot.discovered = discovered;
  snapshot.source = { kind: "url", crawler: "hosted", maxPages: opts.maxPages ?? 60 };
  snapshot.integrations = [
    { name: "Website scan", ok: true, note: `${summary.pagesCrawled} pages read from the live site` },
    ...snapshot.integrations.filter((i) => i.name !== "AI agents").map((i) => (i.name === "Google Search Console" && !gscRows
      ? { ...i, note: opts.googleEmail ? `Not connected yet: in Search Console, add ${opts.googleEmail} as a user (Restricted is enough)` : "Not connected yet" }
      : i.name === "Google Search Console" ? { ...i, note: `Clicks and queries from ${gscRows.property}` } : i)),
  ];
  return { snapshot, discovered, profile, audit };
}
