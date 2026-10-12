// "Request indexing" list. Google does not allow automating its Request indexing button for ordinary pages (the Indexing
// API is for job and livestream pages only), so this job prepares the work for you: the ten pages that most need it,
// newest and least-known first, each with the full URL to paste into Search Console. It writes <state>/<site>/request-indexing.md and
// opens ONE issue a week with the checklist. About ten manual requests a day is Google's practical limit.
import { readJson, writeText, today } from "../core/util.mjs";
import { ghAvailable, ensureLabel, existingTitles, openIssue } from "../lib/gh.mjs";

export const description = "Write the weekly list of up to 10 URLs to request indexing for by hand, with Search Console links";

const RANK = (c = "") => (/unknown/i.test(c) ? 0 : /discovered/i.test(c) ? 1 : /crawled/i.test(c) ? 2 : /redirect|alternate|duplicate/i.test(c) ? 3 : 4);

export async function run({ site, flags }) {
  const state = readJson(`${site.paths.state}/inspect-state.json`, { results: {} }).results;
  const hist = readJson(`${site.paths.state}/indexing-requested.json`, {});
  const list = Object.entries(state)
    .filter(([, v]) => v.coverage && v.coverage !== "Submitted and indexed")
    .map(([url, v]) => ({ url, coverage: v.coverage, rank: RANK(v.coverage), requested: hist[url] }))
    .filter((x) => x.rank < 3) // redirects and duplicates need a fix, not a request
    .sort((a, b) => a.rank - b.rank || String(a.requested || "").localeCompare(String(b.requested || "")))
    .slice(0, Number(flags.limit ?? 10));
  if (!list.length) { console.log("indexing-queue: every inspected page is indexed or needs a fix, not a request."); return; }

  const link = () => `https://search.google.com/search-console?resource_id=${encodeURIComponent(site.searchConsoleProperty)}`;
  const md = `# Request indexing, week of ${today()}\n\nOpen Search Console, paste each URL below into the **Inspect any URL** box at the top, wait for the live test, then press **Request indexing**. About 10 a day is Google's practical limit. (Search Console has no link that opens a given page's inspection, so the URL is shown for copying.)\n\n` +
    list.map((x) => `- [ ] ${x.url.replace(site.url, "/")} (${x.coverage}${x.requested ? `, last requested ${x.requested}` : ""})\n  [Open Search Console](${link()}), then paste ${x.url}`).join("\n") + "\n";
  writeText(`${site.paths.state}/request-indexing.md`, md);
  console.log(md);

  if (!ghAvailable() || flags.dry) return;
  await ensureLabel(site.labels.indexing || "seo-indexing", "7C3AED", "Pages to request indexing for by hand");
  const title = `Request indexing, week of ${today()}`;
  if ((await existingTitles(site.labels.indexing || "seo-indexing")).has(title)) { console.log("indexing-queue: already opened this week"); return; }
  await openIssue(title, md, [site.labels.indexing || "seo-indexing"]);
}
