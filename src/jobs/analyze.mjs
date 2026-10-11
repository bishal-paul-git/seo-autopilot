// Search-data analysis from the rows the daily job saved: cannibalisation, striking distance, CTR underperformers,
// decay, search intent, brand vs non-brand, topic clusters and content gaps. Offline: no network, no AI.
// Writes <state>/<site>/insights.json and insights.md.
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { analyze } from "../analysis/search.mjs";
import { loadPages } from "../adapters/index.mjs";

export const description = "Analyse saved Search Console rows: cannibalisation, striking distance, CTR gaps, decay, intent, topics";

export async function run({ site }) {
  const data = readJson(`${site.paths.state}/gsc-rows.json`, null);
  if (!data) { console.log("analyze: no gsc-rows.json yet. Run the daily job first (it saves the Search Console rows)."); return; }
  const audit = readJson(`${site.paths.state}/audit.json`, { pages: [] });
  const pages = await loadPages(site);
  const pageTitles = [...pages.map((p) => `${p.title} ${p.keyword}`), ...audit.pages.map((p) => `${p.title} ${p.h1}`)];
  const brandTerms = [...new Set([...(site.brandTerms || []), ...(site.ignoreQueries || [])])];
  const r = analyze({ rows: data.rows, prevRows: data.prevRows, brandTerms, pageTitles });
  writeJson(`${site.paths.state}/insights.json`, { generatedAt: new Date().toISOString(), window: data.window, ...r });

  const p = (u) => String(u).replace(site.url, "/");
  const pct = (x) => `${Math.round(x * 100)}%`;
  const note = r.curve.enough ? "" : "\n> The site does not have enough data yet to build its own click-through curve, so click estimates are left out. Rankings by impressions are shown instead.\n";
  const md = `# ${site.name} search insights ${today()}

Window ${data.window.start} to ${data.window.end}: ${r.sample.rows} query/page rows, ${r.sample.impressions} impressions, ${r.sample.clicks} clicks.${note}

## Brand vs non-brand
Brand searches: ${r.brand.brand.impressions} impressions, ${r.brand.brand.clicks} clicks. Non-brand: ${r.brand.nonBrand.impressions} impressions, ${r.brand.nonBrand.clicks} clicks. Growth comes from non-brand demand; brand traffic only shows people already know you.

## Search intent mix (by impressions)
${Object.entries(r.intent).map(([k, v]) => `- ${k}: ${pct(v.share)}`).join("\n")}
Labels are keyword heuristics, not a verdict. A page should match the intent of the queries it ranks for.

## Pages competing with each other (cannibalisation)
${r.cannibalization.slice(0, 10).map((c) => `- "${c.query}" (${c.impressions} impressions): ${c.pages.map((x) => `${p(x.page)} pos ${x.position}`).join(" vs ")}`).join("\n") || "- none found"}
Fix: pick one page to own the query, merge or redirect the others, and point internal links at the winner.

## Striking distance (positions 4 to 20)
${r.strikingDistance.slice(0, 12).map((s) => `- "${s.query}": pos ${s.position}, ${s.impressions} impressions on ${p(s.page)}${s.estimatedExtraClicks != null ? `, about +${s.estimatedExtraClicks} clicks if it reached position 3 (estimate)` : ""}`).join("\n") || "- none yet"}

## Click-through below what its position normally earns
${r.ctrUnderperformers.slice(0, 10).map((u) => `- ${p(u.page)}: position ${u.position}, CTR ${(u.ctr * 100).toFixed(1)}% vs about ${(u.expectedCtr * 100).toFixed(1)}% expected on this site, roughly ${u.estimatedLostClicks} clicks missed`).join("\n") || "- none found (or not enough data for a reliable curve)"}
Fix: test a clearer title and description, then measure the change (see experiments).

## Losing visibility
${r.decay.slice(0, 10).map((d) => `- ${p(d.page)}: impressions ${d.impressionsBefore} to ${d.impressionsNow} (${pct(d.change)})`).join("\n") || "- none"}

## Topics with demand and no dedicated page
${r.contentGaps.map((t) => `- ${t.topic}: ${t.impressions} impressions across ${t.queries} queries (e.g. ${t.topQueries.slice(0, 3).map((q) => `"${q}"`).join(", ")})`).join("\n") || "- none found"}

## Biggest topics
${r.topics.slice(0, 10).map((t) => `- ${t.topic}: ${t.impressions} impressions, ${t.clicks} clicks, avg position ${t.position}, ${t.pages} page(s)${t.hasDedicatedPage ? "" : " (no dedicated page)"}`).join("\n") || "- none"}
`;
  writeText(`${site.paths.state}/insights.md`, md);
  console.log(md);
}
