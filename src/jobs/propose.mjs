// Turns today's candidates into GitHub issues that wait for the owner's approval. No AI, no site edits.
// Up to limits.proposalsPerRun new issues per run, labelled "seo-proposal". Nothing is changed until the owner adds the
// label "approved"; the implementer (templates/workflows/seo-implement.yml) then drafts a pull request.
import { existsSync } from "node:fs";
import { readJson, clean } from "../core/util.mjs";
import { ghAvailable, ensureLabel, existingTitles, openIssue } from "../lib/gh.mjs";
import { loadPages, makeCovered } from "../adapters/index.mjs";

export const description = "Open approval-gated GitHub issues for near-miss queries, no-click pages and undiscovered pages";

const copy = (site) => ({
  "near-miss": (c) => ({
    title: `SEO: improve the page that targets "${c.key}"`,
    what: `Strengthen an existing page, or add one, for the query "${c.key}" (title, H1, a section answering it, internal links).`,
    risk: "Low. Content-only change, reversible with git revert.",
  }),
  "no-clicks": (c) => ({
    title: `SEO: rewrite title and description for ${c.key}`,
    what: `${c.key} is shown in search but not clicked. Rewrite its title (max 58 characters) and meta description (120 to 155 characters) with the primary keyword and a clear benefit.`,
    risk: "Low. Metadata only.",
  }),
  undiscovered: (c) => ({
    title: `SEO: add internal links to ${c.key} (Google has not found it)`,
    what: `Google reports ${c.key} as not known. Link to it from at least two indexed pages and from a hub page. (Check first: if it already has several internal links and is in the sitemap, this is crawl timing and no change is needed.)`,
    risk: "Low. Link additions only.",
  }),
});

export async function run({ site }) {
  if (!ghAvailable()) { console.log("propose: GITHUB_TOKEN / GITHUB_REPOSITORY not set. Skipped."); return; }
  const file = `${site.paths.state}/proposals.json`;
  if (!existsSync(file)) { console.log("propose: no proposals.json (run the daily job first). Skipped."); return; }
  const { candidates } = readJson(file, { candidates: [] });
  const ignore = (site.ignoreQueries || []).map((x) => x.toLowerCase());
  const covered = makeCovered(await loadPages(site));
  const L = site.labels;
  await ensureLabel(L.proposal, "0A6E3E", "Proposed SEO change awaiting approval");
  await ensureLabel(L.approved, "10B981", "Owner approved this proposal");
  const seen = await existingTitles(L.proposal);
  for (const c of candidates) c.key = clean(c.key, 80);

  const kinds = copy(site);
  let made = 0;
  for (const c of candidates) {
    if (made >= site.limits.proposalsPerRun) break;
    // "Undiscovered" pages are usually just waiting for Google to crawl them, so by default they go to the weekly
    // request-indexing list instead of becoming issues. Turn issues on with  "proposals": { "undiscovered": true }.
    if (c.kind === "undiscovered" && !site.proposals?.undiscovered) continue;
    const t = kinds[c.kind]?.(c);
    if (!t || seen.has(t.title)) continue;
    if (c.kind === "near-miss" && (ignore.some((x) => c.key.toLowerCase().includes(x)) || covered(c.key))) { console.log(`skip (covered or ignored): ${c.key}`); continue; }
    const body = `**What:** ${t.what}\n\n**Why (data):** ${c.data} (Search Console, last 28 days).\n\n**Risk:** ${t.risk}\n\n**Rules:** no invented claims, one primary keyword per page. After approval: build, check links, open a pull request.\n\n**To approve:** add the label \`${L.approved}\`. To decline, close the issue.`;
    if (await openIssue(t.title, body, [L.proposal])) made++;
  }
  console.log(`propose: ${made} new proposal(s)`);
}
