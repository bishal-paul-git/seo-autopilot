// Watch and undo. Two watches, one job, run daily by seo-watch:
//  1. "undo" (D17): the changes the autopilot merged at the "undo" level (pull requests labelled seo-watch), --prs prs.json
//     from  gh pr list --state merged --label seo-watch --json number,mergedAt,mergeCommit,files  plus an "addedNoindex"
//     field the workflow adds. Judged over 14 days after a 3-day lag (src/analysis/watch.mjs judgeChange).
//  2. content (O7): every refresh and new page merged from a seo/* branch, by a person or the autopilot, --content prs.json
//     from  gh pr list --state merged --json number,mergedAt,mergeCommit,files,headRefName,labels. Each is added to the
//     watch list kept in the saved state (<state>/<site>/watch-content.json, on the seo-data branch) and judged every day
//     for "watch.days" (default 28) days (judgeContent). --reverts lists the seo/revert-* branches that already exist,
//     so a revert is opened once.
// Writes watch.json and watch.md. For the workflow it outputs revert=<pr> <merge commit> <undo|refresh|new-page> (the first
// change to revert), reason=<one line> and done=<undo-level pull requests whose watch is over and kept>. It never reverts
// anything itself.
//   --unpublish <pr>  (run by the workflow's revert job) takes that watched new page off the site through the content
//                     adapter: sets the draft field and hold: true. Never deletes the file or changes its URL.
//   --git-revert <pr> --sha <merge commit> [--commits headlines.json]  (run by the revert job) reverts the merged pull
//                     request: a merge commit with -m 1, a rebase merge as the whole range of its commits, a squash as one
//                     commit. Exit 1 (revert aborted) when it does not apply cleanly.
// A failing page (error status, or a noindex the change added) must fail on two check days in a row before a revert is
// proposed (one failed fetch can be a network error, a firewall or a short outage). After a new page's unpublish pull
// request is merged, the page is checked again: still live after 2 days means the site ignores the unpublish field, and the
// entry becomes revert-failed (output failed=<pr> <urls>, the workflow opens an issue).
// Kill switch: SEO_AUTOPILOT_PAUSED=true (or "autopilot": { "paused": true }) stops the job before it reads or writes
// anything, so no revert is proposed or opened while paused.
import { appendFileSync, readFileSync } from "node:fs";
import { git, gitNames, revertBase } from "../lib/git-history.mjs";
import { readJson, writeJson, writeText, today, globToRegExp, addDays } from "../core/util.mjs";
import { loadPages, unpublishPages, unpublishSetting } from "../adapters/index.mjs";
import { contentGlobs } from "../cli/init.mjs";
import { extractPage } from "../audit/extract.mjs";
import { pagesForFiles, judgeChange, judgeContent, mergeWatchlist, relatedPages, failStreak, CONTENT_WATCH_DEFAULTS, WATCH_DEFAULTS } from "../analysis/watch.mjs";

export const description = "Watch published changes (autopilot undo level, and every refresh and new page) and say which to revert (errors, an added noindex, clicks falling against the rest of the site)";

async function fetchLive(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "seo-autopilot-watch/1.0" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    const html = /html/i.test(r.headers.get("content-type") || "") ? await r.text() : "";
    const noindex = /noindex/i.test(r.headers.get("x-robots-tag") || "") || (html ? /noindex/.test(extractPage(html, url).robots || "") : false);
    return { status: r.status, noindex };
  } catch { return { status: 599, noindex: false, error: "unreachable" }; }
}

const readList = (file) => { try { const j = JSON.parse(readFileSync(String(file), "utf8")); return Array.isArray(j) ? j : []; } catch { return []; } };
const paused = (site) => process.env.SEO_AUTOPILOT_PAUSED === "true" || site.autopilot?.paused === true;
const output = (o) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(o).map(([k, v]) => `${k}=${String(v ?? "").replace(/[\r\n]+/g, " ").slice(0, 900)}\n`).join("")); };
const norm = (f) => String(f || "").split("\\").join("/");
const sameFile = (a, b) => norm(a) === norm(b) || norm(a).endsWith("/" + norm(b)) || norm(b).endsWith("/" + norm(a));

/** Watch settings: defaults, then the site's "watch" block (whole numbers only). */
export function watchSettings(site) {
  const w = site.watch || {}, o = { ...CONTENT_WATCH_DEFAULTS };
  for (const k of ["days", "lag", "minSpan"]) if (Number.isInteger(w[k]) && w[k] >= 0) o[k] = w[k];
  o.minSpan = Math.min(o.minSpan, o.days);
  return { ...o, content: w.content !== false };
}

const revertedShas = new Set(); // one repository, several sites in the config: revert once per run
function gitRevert(site, flags) {
  const root = site.paths.root, sha = String(flags.sha || "");
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) { console.log("--git-revert needs --sha <merge commit>"); process.exitCode = 1; return; }
  if (revertedShas.has(`${root}\0${sha}`)) return;
  revertedShas.add(`${root}\0${sha}`);
  const headlines = flags.commits ? readList(flags.commits).map((c) => (typeof c === "string" ? c : c.messageHeadline || "")) : [];
  const { base, mode, count } = revertBase(root, sha, headlines);
  const args = mode === "merge" ? ["revert", "--no-edit", "-m", "1", sha] : mode === "rebase" ? ["revert", "--no-edit", `${base}..${sha}`] : ["revert", "--no-edit", sha];
  const r = git(root, args);
  if (r.status !== 0) {
    git(root, ["revert", "--abort"]);
    console.log(`The revert of #${flags["git-revert"]} (${mode}, ${count} commit(s)) does not apply cleanly:\n${(r.stderr || r.stdout || "").trim()}`);
    process.exitCode = 1; return;
  }
  console.log(`Reverted #${flags["git-revert"]}: ${mode === "merge" ? "merge commit (first parent)" : mode === "rebase" ? `rebase merge, ${count} commits` : "one commit"} ${sha.slice(0, 7)}.`);
  output({ reverted: mode });
}

const idOf = (o) => String(o?.slug ?? o?.id ?? o?.h1 ?? o?.title ?? o?.name ?? "");
function jsonIds(src) { try { const j = JSON.parse(src); return Array.isArray(j) ? new Map(j.filter((x) => x && typeof x === "object").map((x) => [idOf(x), JSON.stringify(x)])) : null; } catch { return null; } }

/**
 * What one merged pull request changed, read from git when the merge commit is available: the content files, the new pages
 * (new files, or new entries in a JSON page list) and the existing pages it changed. Returns null when no content changed.
 */
export function describeMerge(site, pr, pages, globs) {
  const root = site.paths.root;
  const files = (pr.files || []).map((f) => norm(f.path || f)).filter((f) => globs.some((r) => r.test(f)));
  if (!files.length) return null;
  const sha = pr.mergeCommit?.oid || pr.mergeCommit || "";
  const labels = (pr.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  const hasGit = sha && git(root, ["cat-file", "-e", `${sha}^{commit}`]).status === 0 && git(root, ["cat-file", "-e", `${sha}^^{commit}`]).status === 0;
  const from = hasGit ? revertBase(root, sha, (pr.commits || []).map((c) => (typeof c === "string" ? c : c.messageHeadline || ""))).base : "";
  const pageFor = (file, id) => pages.find((p) => p.file && sameFile(p.file, file) && (id == null || String(p.id) === String(id)));
  const newPages = [], changed = [];
  let addedNoindex = false, publishAt = "";
  const later = (d) => { if (d && /^\d{4}-\d{2}-\d{2}/.test(d) && d.slice(0, 10) > publishAt) publishAt = d.slice(0, 10); };
  if (hasGit && from) {
    const added = new Set(gitNames(root, ["diff", "--name-only", "--diff-filter=A", from, sha]));
    addedNoindex = git(root, ["diff", from, sha, "--", ...files]).stdout.split("\n").some((l) => l.startsWith("+") && !l.startsWith("+++") && /noindex/i.test(l));
    for (const f of files) {
      const after = git(root, ["show", `${sha}:./${f}`]), before = git(root, ["show", `${from}:./${f}`]);
      if (f.endsWith(".json")) {
        const a = after.status === 0 ? jsonIds(after.stdout) : null, b = before.status === 0 ? jsonIds(before.stdout) : new Map();
        if (!a) continue;
        for (const [id, body] of a) {
          const p = pageFor(f, id);
          if (!b || !b.has(id)) { newPages.push({ file: f, id, url: p?.url, title: p?.title, keyword: p?.keyword }); try { const o = JSON.parse(body); later(String(o.publishAt ?? o.publishDate ?? o.publish_date ?? "")); } catch { /* no date */ } }
          else if (b.get(id) !== body && p?.url) changed.push(p.url);
        }
      } else if (added.has(f)) {
        const p = pageFor(f); newPages.push({ file: f, id: p?.id ?? f, url: p?.url, title: p?.title, keyword: p?.keyword });
        const fm = (after.stdout.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || "";
        later(((fm.match(/^(?:publishAt|publishDate|publish_date):\s*["']?([0-9-]{10})/m) || [])[1]) || "");
      }
      else changed.push(...pagesForFiles([f], pages));
    }
  } else changed.push(...pagesForFiles(files, pages));
  const isNew = newPages.length > 0;
  const others = pages.filter((p) => !newPages.some((n) => n.url && n.url === p.url));
  return {
    pr: pr.number, kind: isNew ? "new-page" : "refresh", mergedAt: pr.mergedAt, sha, branch: pr.headRefName || "", labels, files, ...(isNew && publishAt ? { publishAt } : {}),
    urls: [...new Set(changed)], addedNoindex, gitRead: Boolean(hasGit),
    newPages: newPages.map((n) => ({ file: n.file, id: n.id, url: n.url })),
    related: isNew ? [...new Set(newPages.flatMap((n) => (n.url ? relatedPages(n, others) : [])))] : [],
  };
}

async function unpublish(site, flags) {
  const s = site.paths.state;
  const n = Number(flags.unpublish);
  const entry = (readJson(`${s}/watch-content.json`, { entries: [] }).entries || []).find((e) => e.pr === n);
  if (!entry || entry.kind !== "new-page" || !(entry.newPages || []).length) { console.log(`No watched new page for pull request #${n}; nothing to unpublish.`); process.exitCode = 1; return; }
  const r = unpublishPages(site, entry.newPages.map((p) => ({ file: p.file, id: p.id })), { dry: Boolean(flags.dry) });
  for (const a of r.applied) console.log(`Unpublished ${a.file}${a.id !== a.file ? ` (${a.id})` : ""}: ${a.field}: ${JSON.stringify(a.value)}, hold: true`);
  for (const k of r.skipped) console.log(`Could not unpublish ${k.file || "?"}${k.id ? ` (${k.id})` : ""}: ${k.reason}`);
  output({ unpublished: r.applied.length, field: `${r.field}: ${JSON.stringify(r.value)}` });
  if (r.skipped.length || !r.applied.length) process.exitCode = 1;
}

export async function run({ site, flags = {} }) {
  const s = site.paths.state;
  if (paused(site)) {
    console.log("The autopilot is paused (kill switch SEO_AUTOPILOT_PAUSED): the watch checks nothing, proposes no revert and opens nothing.");
    output({ revert: "", reason: "", done: "", failed: "" });
    return;
  }
  if (flags.unpublish != null && flags.unpublish !== true) return unpublish(site, flags);
  if (flags["git-revert"] != null && flags["git-revert"] !== true) return gitRevert(site, flags);

  const prs = flags.prs ? readList(flags.prs) : [];
  const settings = watchSettings(site);
  const contentPrs = settings.content && flags.content ? readList(flags.content) : [];
  let pages = [];
  try { pages = await loadPages(site); } catch { /* sitemap site without content files: no file-to-URL map */ }
  const series = readJson(`${s}/page-daily.json`, {});
  const day = today();

  // 1. Undo level (autopilot merges labelled seo-watch).
  const undoStore = `${s}/watch-undo.json`;
  const undoState = readJson(undoStore, { failing: {} }).failing || {};
  const changes = prs.map((p) => ({ pr: p.number, mergedAt: p.mergedAt, sha: p.mergeCommit?.oid || p.mergeCommit || "", addedNoindex: Boolean(p.addedNoindex), urls: pagesForFiles((p.files || []).map((f) => f.path || f), pages), failing: undoState[p.number] }));

  // 2. Content watch list: add newly merged seo/* refreshes and new pages, then judge every entry still being watched.
  const store = `${s}/watch-content.json`;
  let entries = readJson(store, { entries: [] }).entries || [];
  const type = site.content?.type ?? "sitemap";
  let note = "";
  if (!settings.content) note = "The content watch is off (\"watch\": { \"content\": false }).";
  else if (type !== "json" && type !== "markdown") note = "The content watch needs content.type \"json\" or \"markdown\" (to map files to pages and to unpublish through the adapter); this site uses the sitemap, so refreshes and new pages are not watched.";
  else {
    const globs = contentGlobs(site.content).map(globToRegExp);
    const undoPrs = new Set(prs.map((p) => p.number));
    const found = contentPrs
      .filter((p) => /^seo\//.test(p.headRefName || "") && !/^seo\/revert-/.test(p.headRefName || "") && !undoPrs.has(p.number))
      .map((p) => describeMerge(site, p, pages, globs)).filter(Boolean);
    entries = mergeWatchlist(entries, found, day, settings);
  }
  // Revert pull requests already opened: branch -> { state, mergedAt } (older workflows pass branch names only).
  const revertPrs = new Map((flags.reverts ? readList(flags.reverts) : []).map((b) => (typeof b === "string" ? [b, { state: "OPEN" }] : [b.headRefName, { state: String(b.state || "OPEN").toUpperCase(), mergedAt: b.mergedAt || "" }])).filter(([b]) => b));
  const reverts = new Set(revertPrs.keys());
  const UNPUBLISH_LAG = 2; // days for the site to rebuild after the unpublish is merged
  for (const e of entries) {
    const rp = revertPrs.get(`seo/revert-${e.pr}`);
    if (e.status === "revert" && rp) e.status = "revert-opened";
    if (e.status === "revert-opened" && rp?.state === "MERGED") { e.revertMergedAt = rp.mergedAt; e.status = e.kind === "new-page" ? "unpublish-merged" : "reverted"; }
    else if (e.status === "revert-opened" && rp?.state === "CLOSED") e.status = "revert-closed";
  }
  const verifying = entries.filter((e) => e.status === "unpublish-merged" && e.revertMergedAt && addDays(String(e.revertMergedAt).slice(0, 10), UNPUBLISH_LAG) <= day);
  const watchedUrls = new Set([...changes.flatMap((c) => c.urls), ...entries.filter((e) => e.status === "watching").flatMap((e) => [...(e.urls || []), ...(e.newPages || []).map((p) => p.url).filter(Boolean)])]);
  const live = {};
  const fetchUrls = new Set([...changes.flatMap((c) => c.urls), ...[...entries.filter((e) => e.status === "watching"), ...verifying].flatMap((e) => [...(e.urls || []).slice(0, settings.maxUrls), ...(e.newPages || []).map((p) => p.url).filter(Boolean)])]);
  for (const u of fetchUrls) live[u] = await fetchLive(u);

  const results = changes.map((c) => ({ ...judgeChange(c, { live, series, today: day, watched: watchedUrls }), sha: c.sha, urls: c.urls }));
  const nextUndo = {};
  for (const r of results) if (r.failing?.days) nextUndo[r.pr] = r.failing;
  if (prs.length || Object.keys(undoState).length) writeJson(undoStore, { failing: nextUndo });
  const isLive = (u) => (live[u]?.status ?? 599) < 400 && !live[u]?.noindex;
  for (const e of entries) {
    if (e.status !== "watching") continue;
    const urls = (e.newPages || []).map((p) => p.url).filter(Boolean);
    // The harm window of a page first seen NOT live (not yet published) starts the day it is first seen live. A page that
    // was live at its first check keeps its merge (or publish) date.
    if (e.kind === "new-page" && e.seenNotLive && !e.liveSince && urls.length && urls.every(isLive)) e.liveSince = day;
    const v = judgeContent(e, { live, series, today: day, watched: watchedUrls }, settings);
    if (e.kind === "new-page" && v.live === false && !e.liveSince) e.seenNotLive = e.seenNotLive || day;
    e.reasons = v.reasons; e.lastChecked = day;
    if (v.failing) e.failing = v.failing;
    if (v.until && v.until > (e.until || "")) e.until = v.until;
    e.status = v.verdict === "revert" ? (reverts.has(`seo/revert-${e.pr}`) ? "revert-opened" : "revert") : v.done ? "kept" : "watching";
  }
  // After an unpublish is merged and the site had time to rebuild, the page must be gone (an error status) or carry a
  // noindex. Still live means the site's build ignores the unpublish field: say so, do not pretend it worked.
  const failedNow = [];
  for (const e of verifying) {
    const urls = (e.newPages || []).map((p) => p.url).filter(Boolean);
    const still = urls.filter((u) => (live[u]?.status ?? 599) === 200 && !live[u]?.noindex);
    const unknown = urls.filter((u) => (live[u]?.status ?? 599) >= 500 || live[u]?.status === 403 || live[u]?.status === 429);
    e.lastChecked = day;
    if (still.length) { e.status = "revert-failed"; e.reasons = [`the unpublish was merged ${String(e.revertMergedAt).slice(0, 10)} but ${still.join(", ")} still answers 200 without a noindex: the site's build ignores ${JSON.stringify(unpublishSetting(site).field)}; take the page off by hand or set content.unpublish to the field your site uses`]; failedNow.push(`${e.pr} ${still.join(" ")}`); }
    else if (!unknown.length) { e.status = "unpublished"; e.reasons = [`gone from the site: ${urls.map((u) => `${u} answers ${live[u].status}${live[u]?.noindex ? " (noindex)" : ""}`).join(", ")}`]; }
    else e.reasons = [`could not confirm yet (${unknown.map((u) => `${u} answers ${live[u]?.status ?? "nothing"}`).join(", ")}); checked again tomorrow`];
  }
  // Keep the file small: finished entries are dropped 90 days after their window.
  const open = new Set(["watching", "revert", "revert-opened", "unpublish-merged"]);
  entries = entries.filter((e) => open.has(e.status) || addDays(e.until || day, 90) >= day);
  if (settings.content && (type === "json" || type === "markdown")) writeJson(store, { updatedAt: new Date().toISOString(), settings: { days: settings.days, lag: settings.lag, minSpan: settings.minSpan }, entries });

  writeJson(`${s}/watch.json`, { generatedAt: new Date().toISOString(), results, content: entries.filter((e) => e.lastChecked === day || e.status === "revert") });
  const line = (r) => `- **PR #${r.pr}: ${r.verdict}**. ${r.reasons.join("; ")}`;
  const cline = (e) => `- **PR #${e.pr} (${e.kind}): ${e.status}**${e.status === "watching" ? ` until ${e.until}` : ""}. ${(e.reasons || []).join("; ")}`;
  const checked = entries.filter((e) => e.lastChecked === day || e.status === "revert" || e.status === "revert-opened");
  const md = `# Watch (${day})

## Autopilot changes at the "undo" level

Checked for ${WATCH_DEFAULTS.span + WATCH_DEFAULTS.lag} days: the page must keep answering, must not gain a noindex from the change, and must not lose clearly more clicks than the rest of the site.

${results.length ? results.map(line).join("\n") : "No autopilot changes are being watched."}

## Refreshes and new pages

${note || `Every refresh and new page merged from a seo/* branch is watched for ${settings.days} days after a ${settings.lag}-day lag. A refresh is reverted (previous content restored) when its page errors, gains a noindex from the change, or loses clearly more clicks than the rest of the site. A new page is unpublished (draft, never deleted, same URL) when the pages on its topic lose clearly more clicks than the rest of the site and it does not win them back. Each revert is a pull request a person merges.

${checked.length ? checked.map(cline).join("\n") : "Nothing is being watched."}`}
`;
  writeText(`${s}/watch.md`, md);
  console.log(md);

  const undo = results.find((r) => r.verdict === "revert" && r.sha);
  const content = entries.find((e) => e.status === "revert" && e.sha);
  const done = results.filter((r) => r.done && r.verdict === "keep").map((r) => r.pr);
  const pick = undo ? { revert: `${undo.pr} ${undo.sha} undo`, reason: undo.reasons.join("; ") } : content ? { revert: `${content.pr} ${content.sha} ${content.kind}`, reason: (content.reasons || []).join("; ") } : { revert: "", reason: "" };
  output({ ...pick, done: done.join(" "), failed: failedNow.join("; ") });
}
