// Technical and on-page audit. Crawls your sitemap (and the internal links it finds), reads what a crawler sees before
// JavaScript runs, and reports findings with the reason each matters and how to fix it. Read-only: it only makes GET and
// HEAD requests to your own site. Writes <state>/<site>/audit.json and audit.md.
//   npx seo-autopilot run audit [--max-pages 300] [--engine node|go|auto]
import { crawlSite } from "../audit/crawl.mjs";
import { runChecks, summarize, RULES, SEVERITY_ORDER } from "../audit/rules.mjs";
import { linkOpportunities } from "../audit/links.mjs";
import { writeJson, writeText, today } from "../core/util.mjs";

export const description = "Crawl the site like a search engine: technical and on-page issues, link graph, internal-link opportunities";

/** Distinct internal links of a page (same host), kept in audit.json so the links job can work without crawling again. */
function internalLinks(p, site) {
  let host = "";
  try { host = new URL(site.url).host; } catch { /* no site URL */ }
  return [...new Set((p.links || []).map((l) => l.url).filter((u) => { try { return new URL(u).host === host; } catch { return false; } }))];
}

export async function run({ site, flags }) {
  const { pages, ctx } = await crawlSite(site, { maxPages: flags["max-pages"] ? Number(flags["max-pages"]) : undefined, engine: typeof flags.engine === "string" ? flags.engine : undefined });
  const issues = runChecks(pages, ctx);
  const summary = summarize(issues, pages.length);
  const opportunities = linkOpportunities(pages);
  const compact = pages.map((p) => ({ url: p.url, finalUrl: p.finalUrl, status: p.status, title: p.title || "", h1: p.h1s?.[0] || "", description: p.description ?? null, links: internalLinks(p, site), h2Count: p.headings ? p.headings.filter((h) => h.level === 2).length : null, h3Count: p.headings ? p.headings.filter((h) => h.level === 3).length : null, words: p.words || 0, depth: p.depth, inbound: p.inbound, canonical: p.canonical || null, types: p.jsonld?.types || [], inSitemap: p.inSitemap, noindex: /noindex/i.test(p.robots || "") || /noindex/i.test(p.xRobots || ""), ttfb: Math.round(p.ttfb || 0) }));
  writeJson(`${site.paths.state}/audit.json`, { generatedAt: new Date().toISOString(), summary, issues, opportunities, pages: compact });

  const grouped = {};
  for (const i of issues) (grouped[i.rule] ||= []).push(i);
  const rules = Object.keys(grouped).sort((a, b) => SEVERITY_ORDER[RULES[a].severity] - SEVERITY_ORDER[RULES[b].severity] || grouped[b].length - grouped[a].length);
  const p = (u) => u.replace(site.url, "/");
  const md = `# ${site.name} technical audit ${today()}

Crawled ${summary.pagesCrawled} pages. Findings: ${summary.bySeverity.high} high, ${summary.bySeverity.medium} medium, ${summary.bySeverity.low} low. ${summary.pagesWithoutHighOrMedium} of ${summary.pagesCrawled} pages have no high or medium finding.
This reads the HTML your server sends (what a crawler sees before JavaScript). Timings are from the audit machine and are hints only.

${rules.map((r) => `## ${RULES[r].title} (${RULES[r].severity}, ${grouped[r].length})
**Why it matters:** ${RULES[r].why}
**How to fix:** ${RULES[r].fix}
${grouped[r].slice(0, 8).map((i) => `- ${p(i.url)}${i.detail ? ` (${i.detail})` : ""}`).join("\n")}${grouped[r].length > 8 ? `\n- ...and ${grouped[r].length - 8} more` : ""}`).join("\n\n") || "No issues found."}

## Internal link opportunities
${opportunities.slice(0, 15).map((o) => `- Link "${o.anchor}" from ${p(o.from)} to ${p(o.to)}`).join("\n") || "- none found"}
`;
  writeText(`${site.paths.state}/audit.md`, md);
  console.log(md);
}
