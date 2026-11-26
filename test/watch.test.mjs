// Watch and undo: the safety net behind publishing on autopilot. A wrong "revert" undoes good work and a missed one keeps a
// regression live, so each signal and its thresholds are tested.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pagesForFiles, judgeChange } from "../src/analysis/watch.mjs";

const add = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
// Daily [clicks, impressions, position] from `from` for `days` days.
const days = (from, n, clicks, impressions) => Object.fromEntries(Array.from({ length: n }, (_, i) => [add(from, i), [clicks, impressions, 5]]));

test("mapping: a changed file maps to its pages, including several pages in one JSON file; unknown URLs are skipped", () => {
  const pages = [{ url: "https://s.test/a", file: "/repo/src/content/blog/a.md" }, { url: "https://s.test/x", file: "/repo/data/pages.json" }, { url: "https://s.test/y", file: "/repo/data/pages.json" }, { file: "/repo/src/content/blog/b.md" }];
  assert.deepEqual(pagesForFiles(["src/content/blog/a.md"], pages), ["https://s.test/a"]);
  assert.deepEqual(pagesForFiles(["data/pages.json"], pages), ["https://s.test/x", "https://s.test/y"]);
  assert.deepEqual(pagesForFiles(["src/content/blog/b.md"], pages), []);
});

test("a page that errors, or a noindex the change added, is reverted when it fails on two check days in a row; one failed check is not enough", () => {
  const c = { pr: 7, mergedAt: "2026-10-10T09:00:00Z", urls: ["https://s.test/a"] };
  const gone = { "https://s.test/a": { status: 404 } };
  const first = judgeChange(c, { live: gone, today: "2026-10-11" });
  assert.equal(first.verdict, "watch", "one failed check (a 503, a firewall 403, a network error) is never reverted");
  assert.equal(first.done, false); assert.deepEqual(first.failing, { days: 1, last: "2026-10-11" });
  assert.equal(judgeChange({ ...c, failing: first.failing }, { live: gone, today: "2026-10-11" }).verdict, "watch", "a second run on the same day does not count twice");
  const second = judgeChange({ ...c, failing: first.failing }, { live: gone, today: "2026-10-12" });
  assert.equal(second.verdict, "revert"); assert.match(second.reasons.join(" "), /2 check days in a row/);
  const healed = judgeChange({ ...c, failing: first.failing }, { live: { "https://s.test/a": { status: 200 } }, today: "2026-10-12" });
  assert.equal(healed.verdict, "watch"); assert.deepEqual(healed.failing, { days: 0, last: "" }, "a healthy check resets the count");
  for (const status of [599, 403, 503]) assert.equal(judgeChange(c, { live: { "https://s.test/a": { status } }, today: "2026-10-11" }).verdict, "watch", `a single ${status} is not reverted`);
  const ni = { "https://s.test/a": { status: 200, noindex: true } };
  assert.equal(judgeChange({ ...c, addedNoindex: true }, { live: ni, today: "2026-10-11" }).verdict, "watch");
  assert.equal(judgeChange({ ...c, addedNoindex: true, failing: { days: 1, last: "2026-10-11" } }, { live: ni, today: "2026-10-12" }).verdict, "revert");
  assert.equal(judgeChange(c, { live: { "https://s.test/a": { status: 200, noindex: true } }, today: "2026-10-11" }).verdict, "watch", "a noindex the change did not add is not the change's fault");
  assert.equal(judgeChange(c, { live: { "https://s.test/a": { status: 200 } }, today: "2026-10-20" }).verdict, "watch", "traffic is judged only after the window");
});

test("clicks: a clear drop against the rest of the site reverts; a site-wide drop, small traffic or a small loss does not", () => {
  const merged = "2026-09-01";
  const url = "https://s.test/a", today = "2026-10-01";
  const others = (c) => Object.fromEntries(["b", "c", "d"].map((p) => [`https://s.test/${p}`, { ...days("2026-08-18", 14, 10, 200), ...days("2026-09-04", 14, c, 200) }]));
  const page = (after, impressions = 100) => ({ [url]: { ...days("2026-08-18", 14, 10, impressions), ...days("2026-09-04", 14, after, impressions) } });
  const c = { pr: 3, mergedAt: merged + "T10:00:00Z", urls: [url] };
  const live = { [url]: { status: 200 } };
  const watched = new Set([url]);
  const drop = judgeChange(c, { live, today, watched, series: { ...page(4), ...others(10) } });
  assert.equal(drop.verdict, "revert"); assert.match(drop.reasons[0], /more than the rest of the site/);
  assert.equal(judgeChange(c, { live, today, watched, series: { ...page(4), ...others(4) } }).verdict, "keep", "the whole site fell the same: not this change");
  assert.equal(judgeChange(c, { live, today, watched, series: { ...page(4, 5), ...others(10) } }).verdict, "keep", "too little traffic to judge");
  assert.equal(judgeChange(c, { live, today, watched, series: { [url]: { ...days("2026-08-18", 8, 1, 100), ...days("2026-08-26", 6, 0, 100), ...days("2026-09-04", 14, 0, 100) }, ...others(10) } }).verdict, "keep", "8 clicks lost: below the 10-click minimum");
});

test("no known URL: kept, and the report says why only the build checks applied", () => {
  const r = judgeChange({ pr: 1, mergedAt: "2026-10-01T00:00:00Z", urls: [] }, { today: "2026-10-02" });
  assert.equal(r.verdict, "keep"); assert.match(r.reasons[0], /urlPattern/);
});

test("watch job: fetches the changed pages, writes the verdicts, and outputs the first change to revert and the ones to stop watching", async () => {
  const server = createServer((req, res) => { res.statusCode = req.url === "/gone" ? 404 : 200; res.setHeader("content-type", "text/html"); res.end("<html><head><title>x</title></head><body>ok</body></html>"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const root = mkdtempSync(join(tmpdir(), "seo-watch-")); const state = join(root, "state"); mkdirSync(state); mkdirSync(join(root, "content"));
  writeFileSync(join(root, "content", "gone.md"), "---\ntitle: Gone\nslug: gone\n---\nText");
  writeFileSync(join(root, "content", "fine.md"), "---\ntitle: Fine\nslug: fine\n---\nText");
  const prs = join(root, "prs.json");
  writeFileSync(prs, JSON.stringify([
    { number: 11, mergedAt: "2026-01-01T00:00:00Z", mergeCommit: { oid: "abc123" }, files: [{ path: "content/gone.md" }] },
    { number: 12, mergedAt: "2026-01-01T00:00:00Z", mergeCommit: { oid: "def456" }, files: [{ path: "content/fine.md" }] },
  ]));
  const out = join(root, "out"); writeFileSync(out, "");
  const site = { id: "s", name: "S", url: base + "/", content: { type: "markdown", dir: "content", urlPattern: "/{slug}" }, paths: { state, root, data: root } };
  const log = console.log; console.log = () => {}; process.env.GITHUB_OUTPUT = out;
  const { run } = await import("../src/jobs/watch.mjs");
  let first;
  try {
    await run({ site, flags: { prs } });
    first = readFileSync(out, "utf8"); writeFileSync(out, "");
    // The failure is remembered in the saved state; the next day's check fails again and the revert is proposed.
    const kept = JSON.parse(readFileSync(join(state, "watch-undo.json"), "utf8"));
    assert.equal(kept.failing[11].days, 1);
    kept.failing[11].last = "2000-01-01"; writeFileSync(join(state, "watch-undo.json"), JSON.stringify(kept));
    await run({ site, flags: { prs } });
  } finally { console.log = log; delete process.env.GITHUB_OUTPUT; server.close(); }
  assert.match(first, /^revert=$/m, "the first failed check proposes nothing");
  const r = JSON.parse(readFileSync(join(state, "watch.json"), "utf8")).results;
  assert.deepEqual(r.map((x) => [x.pr, x.verdict]), [[11, "revert"], [12, "keep"]]);
  const o = Object.fromEntries(readFileSync(out, "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  assert.equal(o.revert, "11 abc123 undo");
  assert.match(o.reason, /gone answers 404; on 2 check days in a row/);
  assert.equal(o.done, "12");
});

// ---- Content watch (refreshes and new pages, O7) ----
import { judgeContent, mergeWatchlist, relatedPages, watchUntil } from "../src/analysis/watch.mjs";
import { unpublishPages } from "../src/adapters/index.mjs";

const before28 = (merge, clicks, impressions = 200) => days(add(merge, -28), 28, clicks, impressions);
const after = (merge, from, to, clicks, impressions = 200) => days(add(merge, from), to - from + 1, clicks, impressions);
const controls = (merge, last) => Object.fromEntries(["c1", "c2", "c3"].map((p) => [`https://s.test/${p}`, { ...before28(merge, 10), ...after(merge, 0, last, 10) }]));

test("content watch: a refresh is watched until enough data exists, reverted on a clear click drop, kept at the end of the window", () => {
  const merge = "2026-09-01", url = "https://s.test/guide";
  const e = { pr: 5, kind: "refresh", mergedAt: merge + "T12:00:00Z", urls: [url] };
  const series = (afterClicks, last) => ({ [url]: { ...before28(merge, 10), ...after(merge, 0, last, afterClicks) }, ...controls(merge, last) });
  assert.equal(judgeContent(e, { today: "2026-09-10", series: series(4, 7), live: { [url]: { status: 200 } } }).verdict, "watch", "under 14 days of data after the lag");
  const r = judgeContent(e, { today: "2026-10-01", series: series(4, 28), live: { [url]: { status: 200 } }, watched: new Set([url]) });
  assert.equal(r.verdict, "revert"); assert.match(r.reasons[0], /clicks fell 60% more than the rest of the site/);
  const ok = judgeContent(e, { today: "2026-10-10", series: series(10, 37), live: { [url]: { status: 200 } }, watched: new Set([url]) });
  assert.equal(ok.verdict, "keep"); assert.equal(ok.done, true);
  const err = judgeContent(e, { today: "2026-09-05", live: { [url]: { status: 503 } } });
  assert.equal(err.verdict, "watch", "one failed check is never reverted"); assert.equal(err.done, false);
  assert.equal(judgeContent({ ...e, failing: err.failing }, { today: "2026-09-06", live: { [url]: { status: 500 } } }).verdict, "revert", "two check days in a row");
  assert.equal(judgeContent({ ...e, addedNoindex: true, failing: { days: 1, last: "2026-09-04" } }, { today: "2026-09-05", live: { [url]: { status: 200, noindex: true } } }).verdict, "revert");
  // The window is padded with nothing: Search Console's last day decides how many days are compared.
  const lagging = judgeContent(e, { today: "2026-09-21", series: series(4, 12), live: { [url]: { status: 200 } } });
  assert.equal(lagging.verdict, "watch", "data only up to day 12 after the merge: 10 days after the lag, not enough yet");
});

test("content watch: a new page is unpublished when the pages on its topic lose clicks it does not win back; kept when the clicks moved to it", () => {
  const merge = "2026-09-01", page = "https://s.test/new", rel = "https://s.test/old";
  const e = { pr: 6, kind: "new-page", mergedAt: merge, newPages: [{ url: page, file: "content/new.md", id: "new" }], related: [rel] };
  const series = (newClicks) => ({ [rel]: { ...before28(merge, 10), ...after(merge, 0, 28, 3) }, [page]: after(merge, 0, 28, newClicks), ...controls(merge, 28) });
  const live = { [page]: { status: 200 }, [rel]: { status: 200 } };
  const bad = judgeContent(e, { today: "2026-10-01", series: series(1), live });
  assert.equal(bad.verdict, "revert"); assert.match(bad.reasons[0], /taking their place in search/);
  const moved = judgeContent(e, { today: "2026-10-01", series: series(9), live });
  assert.equal(moved.verdict, "watch"); assert.match(moved.reasons[0], /the clicks moved to it/);
  assert.equal(judgeContent({ ...e, related: [] }, { today: "2026-10-10", series: series(1), live }).verdict, "keep");
  // Not live: on the very day the click rule says "revert", a page that answers 404 (or any error, or noindex) is never
  // unpublished.
  for (const l of [{ status: 404 }, { status: 410 }, { status: 599 }, { status: 200, noindex: true }]) {
    const notLive = judgeContent(e, { today: "2026-10-01", series: series(1), live: { [page]: l, [rel]: { status: 200 } } });
    assert.equal(notLive.verdict, "watch", JSON.stringify(l)); assert.match(notLive.reasons[0], /never unpublished/);
  }
  // The window starts when the page went live, not at the merge: published on 2026-09-20, too little data on 2026-10-01.
  const late = judgeContent({ ...e, publishAt: "2026-09-20" }, { today: "2026-10-01", series: series(1), live });
  assert.equal(late.verdict, "watch"); assert.match(late.reasons.join(" "), /compared after 2026-10-07/);
  assert.equal(judgeContent({ ...e, liveSince: "2026-09-25" }, { today: "2026-10-01", series: series(1), live }).verdict, "watch");
});

test("content watch: related pages by topic words in any script; the watch list keeps history and skips finished windows", () => {
  const pages = [{ url: "https://s.test/a", title: "العناية بالنباتات المنزلية في الشتاء", keyword: "العناية بالنباتات" }, { url: "https://s.test/b", title: "وصفات الطبخ السريعة" }, { url: "https://s.test/c", title: "Trail running shoes", keyword: "trail running shoes" }];
  assert.deepEqual(relatedPages({ url: "https://s.test/n", title: "دليل العناية بالنباتات المنزلية" }, pages), ["https://s.test/a"]);
  assert.deepEqual(relatedPages({ url: "https://s.test/n", title: "Trail running shoes for beginners" }, pages), ["https://s.test/c"]);
  assert.equal(watchUntil("2026-09-01T10:00:00Z"), "2026-10-02");
  const list = mergeWatchlist([{ pr: 1, status: "kept", mergedAt: "2026-08-01" }], [{ pr: 1, mergedAt: "2026-09-20" }, { pr: 2, mergedAt: "2026-09-20" }, { pr: 3, mergedAt: "2026-07-01" }], "2026-10-01");
  assert.deepEqual(list.map((e) => [e.pr, e.status]), [[1, "kept"], [2, "watching"]]);
});

test("unpublish through the adapter: sets the draft field and hold, never deletes or renames; unsafe JSON formatting is skipped", () => {
  const root = mkdtempSync(join(tmpdir(), "seo-unpub-")); mkdirSync(join(root, "content"));
  writeFileSync(join(root, "content", "new.md"), "---\ntitle: New\nslug: new\ndraft: false\n---\n\n# New\n\nText.\n");
  writeFileSync(join(root, "content", "bare.md"), "# Bare\n\nText.\n");
  writeFileSync(join(root, "content", "pages.json"), JSON.stringify([{ slug: "a", h1: "A" }, { slug: "b", h1: "B" }], null, 2) + "\n");
  writeFileSync(join(root, "content", "compact.json"), JSON.stringify([{ slug: "c" }]));
  const site = { paths: { root }, content: { type: "markdown", dir: "content" } };
  const r = unpublishPages(site, [{ file: "content/new.md", id: "new" }, { file: "content/bare.md", id: "bare" }, { file: "content/pages.json", id: "b" }, { file: "content/compact.json", id: "c" }]);
  assert.equal(r.applied.length, 3); assert.equal(r.skipped.length, 1); assert.match(r.skipped[0].reason, /formatting/);
  assert.equal(readFileSync(join(root, "content", "new.md"), "utf8"), "---\ntitle: New\nslug: new\ndraft: true\nhold: true\n---\n\n# New\n\nText.\n");
  assert.match(readFileSync(join(root, "content", "bare.md"), "utf8"), /^---\ndraft: true\nhold: true\n---\n# Bare/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, "content", "pages.json"), "utf8")), [{ slug: "a", h1: "A" }, { slug: "b", h1: "B", draft: true, hold: true }]);
  const jekyll = unpublishPages({ ...site, content: { type: "markdown", dir: "content", unpublish: { field: "published", value: false } } }, [{ file: "content/new.md", id: "new" }], { dry: true });
  assert.deepEqual(jekyll.applied.map((a) => [a.field, a.value]), [["published", false]]);
});

test("kill switch: with SEO_AUTOPILOT_PAUSED=true the watch reads and writes nothing and proposes no revert (also --unpublish)", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-watch-paused-")); const state = join(root, "state"); mkdirSync(state);
  const prs = join(root, "prs.json"); writeFileSync(prs, JSON.stringify([{ number: 11, mergedAt: "2026-01-01T00:00:00Z", mergeCommit: { oid: "abc" }, files: [] }]));
  const out = join(root, "out"); writeFileSync(out, "");
  const site = { id: "s", name: "S", url: "https://s.test/", content: { type: "markdown", dir: "content" }, paths: { state, root, data: root } };
  const log = console.log; console.log = () => {}; process.env.GITHUB_OUTPUT = out; process.env.SEO_AUTOPILOT_PAUSED = "true";
  try {
    const { run } = await import("../src/jobs/watch.mjs");
    await run({ site, flags: { prs, content: prs } });
    await run({ site, flags: { unpublish: "11" } });
    await run({ site: { ...site, autopilot: { paused: true } }, flags: { prs } });
  } finally { console.log = log; delete process.env.GITHUB_OUTPUT; delete process.env.SEO_AUTOPILOT_PAUSED; }
  assert.equal(readFileSync(out, "utf8"), "revert=\nreason=\ndone=\nfailed=\n".repeat(3));
  assert.deepEqual(readdirSync(state), [], "nothing written");
});

// Real git repositories for the revert and the merge reading.
const g = (cwd, ...args) => { const r = spawnSync("git", args, { cwd, encoding: "utf8" }); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };
function gitRepo() {
  const root = mkdtempSync(join(tmpdir(), "seo-watch-git-"));
  g(root, "init", "-q", "-b", "main"); g(root, "config", "user.email", "t@example.test"); g(root, "config", "user.name", "t"); g(root, "config", "commit.gpgsign", "false");
  mkdirSync(join(root, "content"));
  writeFileSync(join(root, "content", "a.md"), "# A\n\nOne.\n"); writeFileSync(join(root, "content", "b.md"), "# B\n\nTwo.\n");
  g(root, "add", "-A"); g(root, "commit", "-qm", "base");
  return root;
}
const quietRun = async (site, flags) => {
  const { run } = await import("../src/jobs/watch.mjs");
  const out = join(site.paths.root, "..", `out-${Math.random().toString(36).slice(2)}`); writeFileSync(out, "");
  const log = console.log; console.log = () => {}; process.env.GITHUB_OUTPUT = out; process.exitCode = 0;
  try { await run({ site, flags }); return { code: process.exitCode, out: readFileSync(out, "utf8") }; } finally { console.log = log; delete process.env.GITHUB_OUTPUT; process.exitCode = 0; }
};

test("--git-revert undoes a merge commit (-m 1), a rebase merge (its whole range) and a squash (one commit)", async () => {
  const content = (root) => [readFileSync(join(root, "content", "a.md"), "utf8"), readFileSync(join(root, "content", "b.md"), "utf8")];
  const twoCommits = (root) => { writeFileSync(join(root, "content", "a.md"), "# A\n\nOne, refreshed.\n"); g(root, "commit", "-qam", "refresh a"); writeFileSync(join(root, "content", "b.md"), "# B\n\nTwo, refreshed.\n"); g(root, "commit", "-qam", "refresh b"); };
  // Merge commit (GitHub's default): git revert without -m fails on it.
  let root = gitRepo(); const before = content(root);
  g(root, "checkout", "-qb", "seo/issue-1"); twoCommits(root); g(root, "checkout", "-q", "main"); g(root, "merge", "-q", "--no-ff", "-m", "Merge #1", "seo/issue-1");
  let sha = g(root, "rev-parse", "HEAD");
  assert.notEqual(spawnSync("git", ["revert", "--no-edit", sha], { cwd: root }).status, 0, "a plain revert of a merge commit fails");
  let r = await quietRun({ paths: { root, state: join(root, ".s") } }, { "git-revert": "1", sha });
  assert.equal(r.code, 0); assert.match(r.out, /reverted=merge/); assert.deepEqual(content(root), before);
  // Rebase merge: the two commits replayed on main; reverting only the last one would leave the first change live.
  root = gitRepo();
  g(root, "checkout", "-qb", "seo/issue-2"); twoCommits(root); g(root, "checkout", "-q", "main");
  writeFileSync(join(root, "content", "c.md"), "# C\n"); g(root, "add", "-A"); g(root, "commit", "-qm", "unrelated");
  const after = content(root); g(root, "rebase", "-q", "main", "seo/issue-2"); g(root, "checkout", "-q", "main"); g(root, "merge", "-q", "--ff-only", "seo/issue-2");
  sha = g(root, "rev-parse", "HEAD");
  const commits = join(root, "..", `commits-${Date.now()}.json`); writeFileSync(commits, JSON.stringify([{ messageHeadline: "refresh a" }, { messageHeadline: "refresh b" }]));
  r = await quietRun({ paths: { root, state: join(root, ".s") } }, { "git-revert": "2", sha, commits });
  assert.equal(r.code, 0); assert.match(r.out, /reverted=rebase/); assert.deepEqual(content(root), after);
  assert.ok(readFileSync(join(root, "content", "c.md"), "utf8").includes("# C"), "the unrelated commit stays");
  // Squash: one commit.
  root = gitRepo(); const s0 = content(root);
  writeFileSync(join(root, "content", "a.md"), "# A\n\nSquashed.\n"); g(root, "commit", "-qam", "Refresh (#3)");
  r = await quietRun({ paths: { root, state: join(root, ".s") } }, { "git-revert": "3", sha: g(root, "rev-parse", "HEAD"), commits });
  assert.equal(r.code, 0); assert.match(r.out, /reverted=single/); assert.deepEqual(content(root), s0);
});

test("a new page with an Arabic (non-ASCII) file name is read as a new page, not as a change", async () => {
  const { describeMerge } = await import("../src/jobs/watch.mjs");
  const { contentGlobs } = await import("../src/cli/init.mjs");
  const { globToRegExp } = await import("../src/core/util.mjs");
  const root = gitRepo(); const file = "content/دليل-السيو.md";
  g(root, "checkout", "-qb", "seo/topic-4"); writeFileSync(join(root, file), "---\ntitle: دليل\npublishDate: 2026-03-02\n---\n\n# دليل السيو\n"); g(root, "add", "-A"); g(root, "commit", "-qm", "new page");
  g(root, "checkout", "-q", "main"); g(root, "merge", "-q", "--no-ff", "-m", "Merge #4", "seo/topic-4");
  const content = { type: "markdown", dir: "content", urlPattern: "/blog/{slug}" };
  const e = describeMerge({ paths: { root }, content }, { number: 4, mergedAt: "2026-03-01T00:00:00Z", mergeCommit: { oid: g(root, "rev-parse", "HEAD") }, files: [{ path: file }], headRefName: "seo/topic-4" }, [], contentGlobs(content).map(globToRegExp));
  assert.equal(e.kind, "new-page"); assert.deepEqual(e.newPages.map((p) => p.file), [file]); assert.equal(e.publishAt, "2026-03-02");
});

test("after an unpublish is merged the page is checked: still live means revert-failed (and output failed=), gone means unpublished", async () => {
  const server = createServer((req, res) => { if (req.url === "/blog/still") { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><head><title>x</title></head><body>x</body></html>"); } else if (req.url === "/blog/slow") { res.writeHead(503); res.end(); } else { res.writeHead(404); res.end(); } });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const root = mkdtempSync(join(tmpdir(), "seo-watch-verify-")); const state = join(root, "state"); mkdirSync(state); mkdirSync(join(root, "content"));
    const entry = (pr, slug) => ({ pr, kind: "new-page", status: "revert-opened", sha: "abc1234", mergedAt: "2000-01-01T00:00:00Z", until: new Date().toISOString().slice(0, 10), newPages: [{ file: `content/${slug}.md`, id: slug, url: `${base}/blog/${slug}` }], urls: [] });
    writeFileSync(join(state, "watch-content.json"), JSON.stringify({ entries: [entry(5, "still"), entry(6, "gone"), entry(7, "slow")] }));
    const reverts = join(root, "reverts.json"); writeFileSync(reverts, JSON.stringify([5, 6, 7].map((n) => ({ headRefName: `seo/revert-${n}`, state: "MERGED", mergedAt: "2000-01-05T00:00:00Z" }))));
    const site = { id: "s", url: base + "/", content: { type: "markdown", dir: "content", urlPattern: "/blog/{slug}" }, paths: { root, state, data: root } };
    const r = await quietRun(site, { reverts });
    assert.match(r.out, new RegExp(`failed=5 ${base}/blog/still\\n`));
    const by = Object.fromEntries(JSON.parse(readFileSync(join(state, "watch-content.json"), "utf8")).entries.map((e) => [e.pr, e]));
    assert.equal(by[5].status, "revert-failed"); assert.match(by[5].reasons[0], /ignores "draft"/);
    assert.equal(by[6].status, "unpublished");
    assert.equal(by[7].status, "unpublish-merged", "a 503 is not proof either way: checked again"); assert.match(by[7].reasons[0], /checked again tomorrow/);
  } finally { server.close(); }
});
