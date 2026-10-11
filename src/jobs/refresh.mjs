// Content refresh proposals. Finds pages of YOUR content that lost a large share of search impressions between two equal
// windows (from `analyze`) and opens one GitHub issue per page (at most 2 per run) asking for a refresh. You approve with the
// `approved` label like any proposal; the implementer then updates the existing page (same URL), it never creates a new one.
// A drop can also be seasonal or a ranking loss to a better page, so each issue says what the data does and does not show.
//   npx seo-autopilot run refresh [--dry]
import { readJson } from "../core/util.mjs";
import { loadPages } from "../adapters/index.mjs";
import { ghAvailable, ensureLabel, existingTitles, openIssue } from "../lib/gh.mjs";

export const description = "Open refresh proposals for your own pages that lost search visibility (you approve, the agent updates the page)";

const strip = (u) => String(u).replace(/\/$/, "");

export async function run({ site, flags }) {
  const insights = readJson(`${site.paths.state}/insights.json`, null);
  if (!insights?.decay?.length) { console.log("refresh: no decaying pages in the latest analysis."); return; }
  const mine = new Map((await loadPages(site)).filter((p) => p.url).map((p) => [strip(p.url), p]));
  const L = site.labels.proposal;
  const done = ghAvailable() ? await existingTitles("seo-refresh") : new Set();
  let opened = 0;
  for (const d of insights.decay) {
    const page = mine.get(strip(d.page));
    if (!page) continue; // not a page this project's content files control
    const title = `Refresh: ${page.title || d.page.replace(site.url, "/")}`;
    if (done.has(title)) continue;
    const body = `**Page:** ${d.page}\n**File:** ${page.file || "see content config"}\n\n**What the data shows:** impressions fell from ${d.impressionsBefore} to ${d.impressionsNow} (${Math.round(d.change * 100)}%) and clicks from ${d.clicksBefore} to ${d.clicksNow}, comparing the latest 4 weeks with the 4 weeks before.\n\n**What it does not show:** why. It can be seasonal demand, a competitor outranking the page, or a search-intent shift. Check the live results for the page's main query before approving.\n\n**If approved, the agent will:** update this page in place (same URL): re-check every fact against its sources, tighten the opening so it answers the main question first, fix anything out of date, and update the modified date. It will not invent statistics or add claims it cannot source.\n\nLabel this issue \`approved\` to start. Related playbooks: refreshing-and-pruning-content, search-intent-and-page-types.`;
    if (flags.dry) { console.log(`[dry] would open: ${title}`); opened++; }
    else {
      await ensureLabel("seo-refresh", "F59E0B", "Refresh an existing page");
      await ensureLabel(L, "0A6E3E", "SEO proposal awaiting approval");
      if (await openIssue(title, body, [L, "seo-refresh"])) opened++;
    }
    if (opened >= 2) break;
  }
  if (!opened) console.log("refresh: nothing new to propose (decaying pages are not yours, or already proposed).");
}
