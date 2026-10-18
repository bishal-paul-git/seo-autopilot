// On-page quality view: does each page's own top search query show up in its title, H1 and description, and how much
// heading structure does each site section have? Reads the saved audit (audit.json) and Search Console rows (gsc-rows.json,
// from the daily job); fetches nothing. Writes <state>/<site>/quality.json and quality.md.
//   npx seo-autopilot run quality [--min-impressions 20]
// Heading problems on single pages (skipped levels, generic or repeated H2s, long H1s) are audit rules; see audit.md.
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { keywordAlignment, sectionOutline, siteWords } from "../analysis/quality.mjs";

export const description = "On-page quality: top query vs title, H1 and description, and heading structure per site section";

export async function run({ site, flags }) {
  const audit = readJson(`${site.paths.state}/audit.json`, null);
  if (!audit) { console.log("quality: no audit.json yet (run the audit job first). Skipped."); return; }
  const gsc = readJson(`${site.paths.state}/gsc-rows.json`, null);
  const brandTerms = [...new Set([...(site.brandTerms || []), ...(site.ignoreQueries || [])])];
  const minImpressions = Number(flags["min-impressions"] ?? 20);
  const alignment = gsc ? keywordAlignment(audit.pages || [], gsc.rows || [], { brandTerms, minImpressions }) : null;
  const sections = sectionOutline(audit.pages || []);
  const common = [...siteWords((audit.pages || []).filter((x) => x.status === 200).map((x) => x.title))];
  writeJson(`${site.paths.state}/quality.json`, { generatedAt: new Date().toISOString(), auditGeneratedAt: audit.generatedAt, searchWindow: gsc?.window || null, minImpressions, siteWords: common, alignment, sections });

  const p = (u) => u.replace(site.url, "/");
  const pct = (x) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);
  const md = `# ${site.name} on-page quality ${today()}

## Top query vs title, H1 and description
${alignment == null ? "No Search Console rows yet (the daily job writes gsc-rows.json). Nothing to compare." : `For each page, its most-shown query (${minImpressions}+ impressions${gsc.window ? `, ${gsc.window.start} to ${gsc.window.end}` : ""}, brand queries left out) is compared with the page's own title, H1 and description. A page is listed when the title or description holds under 75% of the query's words, or the H1 under 60%.${common.length ? ` Words in at least half of the site's titles are not counted (${common.map((w) => `"${w}"`).join(", ")}): they say nothing about which page a query belongs to.` : ""} This is a prompt to look, not a rule: the query may be one the page should not chase.

${alignment.slice(0, 25).map((a) => `- ${p(a.url)}: "${a.query}" (${a.impressions} impressions). Weak in ${a.weak.join(", ")}. Title ${pct(a.score.title)}, H1 ${pct(a.score.h1)}, description ${pct(a.score.description)}`).join("\n") || "- Every page with enough impressions reflects its top query."}${alignment.length > 25 ? `\n- ...and ${alignment.length - 25} more in quality.json` : ""}`}

## Headings per site section
${sections.length ? `| Section | Pages | Avg H2 | Avg H3 |\n|---|---|---|---|\n${sections.map((s) => `| ${s.section} | ${s.pages} | ${s.avgH2} | ${s.avgH3} |`).join("\n")}\n\nA section whose pages average under 2 H2s may come from a template with no room for structure. Single-page heading problems are in the audit report.` : "No heading data in audit.json (re-run the audit job with this version)."}
`;
  writeText(`${site.paths.state}/quality.md`, md);
  console.log(md);
}
