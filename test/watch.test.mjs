// Watch and undo: the safety net behind publishing on autopilot. A wrong "revert" undoes good work and a missed one keeps a
// regression live, so each signal and its thresholds are tested.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
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

test("a page that now errors, or a noindex the change added, is reverted at once", () => {
  const c = { pr: 7, mergedAt: "2026-10-10T09:00:00Z", urls: ["https://s.test/a"] };
  assert.equal(judgeChange(c, { live: { "https://s.test/a": { status: 404 } }, today: "2026-10-11" }).verdict, "revert");
  assert.equal(judgeChange({ ...c, addedNoindex: true }, { live: { "https://s.test/a": { status: 200, noindex: true } }, today: "2026-10-11" }).verdict, "revert");
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
  try { await (await import("../src/jobs/watch.mjs")).run({ site, flags: { prs } }); } finally { console.log = log; delete process.env.GITHUB_OUTPUT; server.close(); }
  const r = JSON.parse(readFileSync(join(state, "watch.json"), "utf8")).results;
  assert.deepEqual(r.map((x) => [x.pr, x.verdict]), [[11, "revert"], [12, "keep"]]);
  assert.equal(readFileSync(out, "utf8"), "revert=11 abc123\ndone=12\n");
});
