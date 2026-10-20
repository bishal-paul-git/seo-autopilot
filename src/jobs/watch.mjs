// Watch and undo (D17): checks the changes the autopilot merged at the "undo" level and says which to revert.
//   npx seo-autopilot run watch --prs prs.json
// prs.json: the merged pull requests still being watched, from
//   gh pr list --state merged --label seo-watch --json number,mergedAt,mergeCommit,files
// with an "addedNoindex" field the workflow adds (true when the change's added lines contain "noindex").
// Fetches each changed page once, reads the per-page daily history from the daily job, and writes
// <state>/<site>/watch.json and watch.md. For the workflow it outputs: revert=<pr> <merge commit> (the first to revert)
// and done=<prs whose watch is over and kept>. It never reverts anything itself.
import { appendFileSync, readFileSync } from "node:fs";
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { loadPages } from "../adapters/index.mjs";
import { extractPage } from "../audit/extract.mjs";
import { pagesForFiles, judgeChange } from "../analysis/watch.mjs";

export const description = "Watch autopilot changes after they publish and say which to revert (errors, an added noindex, clicks falling against the rest of the site)";

async function fetchLive(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "seo-autopilot-watch/1.0" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    const html = /html/i.test(r.headers.get("content-type") || "") ? await r.text() : "";
    const noindex = /noindex/i.test(r.headers.get("x-robots-tag") || "") || (html ? /noindex/.test(extractPage(html, url).robots || "") : false);
    return { status: r.status, noindex };
  } catch { return { status: 599, noindex: false, error: "unreachable" }; }
}

export async function run({ site, flags = {} }) {
  const s = site.paths.state;
  let prs = [];
  try { prs = JSON.parse(readFileSync(String(flags.prs), "utf8")); } catch { /* none */ }
  if (!prs.length) { console.log("No autopilot changes are being watched."); return; }
  let pages = [];
  try { pages = await loadPages(site); } catch { /* sitemap site without content files: no file-to-URL map */ }
  const series = readJson(`${s}/page-daily.json`, {});
  const changes = prs.map((p) => ({ pr: p.number, mergedAt: p.mergedAt, sha: p.mergeCommit?.oid || p.mergeCommit || "", addedNoindex: Boolean(p.addedNoindex), urls: pagesForFiles((p.files || []).map((f) => f.path || f), pages) }));
  const watched = new Set(changes.flatMap((c) => c.urls));
  const live = {};
  for (const u of watched) live[u] = await fetchLive(u);
  const results = changes.map((c) => ({ ...judgeChange(c, { live, series, today: today(), watched }), sha: c.sha, urls: c.urls }));
  writeJson(`${s}/watch.json`, { generatedAt: new Date().toISOString(), results });
  const line = (r) => `- **PR #${r.pr}: ${r.verdict}**. ${r.reasons.join("; ")}`;
  const md = `# Autopilot watch (${today()})\n\nChanges published at the "undo" level are checked for ${14 + 3} days: the page must keep answering, must not gain a noindex from the change, and must not lose clearly more clicks than the rest of the site.\n\n${results.map(line).join("\n")}\n`;
  writeText(`${s}/watch.md`, md);
  console.log(md);
  const revert = results.find((r) => r.verdict === "revert" && r.sha);
  const done = results.filter((r) => r.done && r.verdict === "keep").map((r) => r.pr);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `revert=${revert ? `${revert.pr} ${revert.sha}` : ""}\ndone=${done.join(" ")}\n`);
}
