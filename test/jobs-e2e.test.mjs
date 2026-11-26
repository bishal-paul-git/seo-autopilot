// Runs the real jobs end to end against a fake Google and a fake website (global fetch is replaced), in a temp project.
// This is the test that would have caught a job that parses but crashes when it runs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { init } from "../src/cli/init.mjs";
import { runJob } from "../src/jobs/index.mjs";

const SITE = "https://shop.test/";
const page = (title, body, extra = "") => `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="${"A useful description of this page for readers. ".repeat(2)}"><link rel="canonical" href="${SITE}${extra}"><meta property="og:title" content="${title}"><meta property="og:image" content="${SITE}i.jpg"><meta name="viewport" content="width=device-width"></head><body><h1>${title}</h1><p>${body}</p><a href="${SITE}guide">guide</a></body></html>`;
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

const PAGES = {
  "/": page("Home page of the shop", words(300), ""),
  "/guide": page("How to choose a widget", words(400), "guide"),
};
const SITEMAP = `<?xml version="1.0"?><urlset>${Object.keys(PAGES).map((p) => `<url><loc>${SITE.slice(0, -1)}${p}</loc></url>`).join("")}</urlset>`;

function fakeFetch(calls) {
  return async (input, init = {}) => {
    const url = String(input?.url || input);
    calls.push(url);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    if (url === "https://oauth.test/token") return json({ access_token: "tok" });
    if (url.includes("/searchAnalytics/query")) {
      const dims = JSON.parse(init.body || "{}").dimensions || [];
      const row = (keys, clicks, impressions, position) => ({ keys, clicks, impressions, ctr: clicks / impressions, position });
      if (!dims.length) return json({ rows: [row([], 12, 400, 14)] });
      if (dims.join() === "query") return json({ rows: [row(["widget guide"], 2, 120, 9), row(["how to choose a widget"], 1, 90, 12)] });
      if (dims.join() === "page") return json({ rows: [row([`${SITE}guide`], 3, 200, 10)] });
      return json({ rows: [row(["widget guide", `${SITE}guide`], 2, 120, 9)] });
    }
    if (url.includes("urlInspection")) return json({ inspectionResult: { indexStatusResult: { coverageState: "Submitted and indexed", lastCrawlTime: "2026-10-01T00:00:00Z" } } });
    if (url === `${SITE}sitemap.xml`) return new Response(SITEMAP, { headers: { "content-type": "application/xml" } });
    if (url === `${SITE}robots.txt`) return new Response("User-agent: *\nAllow: /\n\nUser-agent: PerplexityBot\nDisallow: /\n\nSitemap: " + SITE + "sitemap.xml\n", { headers: { "content-type": "text/plain" } });
    if (url === `${SITE}llms.txt`) return new Response("# Shop\n- [Guide](" + SITE + "guide)\n", { headers: { "content-type": "text/plain" } });
    if (url.startsWith("https://www.googleapis.com/pagespeedonline")) return json({ lighthouseResult: { categories: { performance: { score: 0.42 } }, audits: { "largest-contentful-paint": { numericValue: 5200 }, "cumulative-layout-shift": { numericValue: 0.02 }, "total-blocking-time": { numericValue: 300 }, "uses-optimized-images": { title: "Efficiently encode images", details: { type: "opportunity", overallSavingsMs: 1200 } } } }, loadingExperience: { metrics: {} } });
    const path = url.replace(SITE.slice(0, -1), "").split("#")[0] || "/";
    if (url.startsWith(SITE) && PAGES[path]) return new Response(PAGES[path], { headers: { "content-type": "text/html" } });
    return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  };
}

async function project(t) {
  const dir = mkdtempSync(join(tmpdir(), "seo-e2e-"));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const saved = { fetch: globalThis.fetch, cwd: process.cwd(), env: { ...process.env }, log: console.log };
  process.env.GOOGLE_KEY_JSON = JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "https://oauth.test/token" });
  for (const k of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "SEO_INGEST_URL", "INDEXNOW_KEY"]) delete process.env[k];
  const calls = [];
  globalThis.fetch = fakeFetch(calls);
  console.log = () => {};
  process.chdir(dir);
  await init({ flags: { url: SITE, name: "Shop", "no-workflows": true } });
  t.after(() => { process.chdir(saved.cwd); globalThis.fetch = saved.fetch; console.log = saved.log; process.env = saved.env; });
  return { dir, calls, state: () => join(dir, ".seo-autopilot", "shop-test") };
}

test("daily, analyze, audit, geo, speed, priorities, digest and dashboard run end to end", async (t) => {
  const p = await project(t);
  await runJob("daily", { cwd: p.dir });
  assert.ok(existsSync(join(p.dir, ".seo-autopilot")), "state folder created");
  const stateDir = join(p.dir, ".seo-autopilot", readFileSync(join(p.dir, "seo-autopilot.config.json"), "utf8").match(/"id":\s*"([^"]+)"/)[1]);
  const rd = (f) => JSON.parse(readFileSync(join(stateDir, f), "utf8"));

  await runJob("analyze", { cwd: p.dir });
  assert.ok(rd("insights.json").strikingDistance, "insights written");

  await runJob("audit", { cwd: p.dir });
  const audit = rd("audit.json");
  assert.equal(audit.summary.pagesCrawled, 2);

  await runJob("geo", { cwd: p.dir, flags: { pages: "5" } });
  const geo = rd("geo.json");
  assert.ok(geo.robots.find((b) => b.name === "PerplexityBot").blocked, "Perplexity blocked is detected");
  assert.ok(geo.findings.find((f) => f.id === "ai-search-blocked"));
  assert.equal(geo.llms.present, true);

  await runJob("speed", { cwd: p.dir, flags: { pages: "2" } });
  const speed = rd("speed.json");
  assert.equal(speed.results[0].lab.score, 42);
  assert.match(speed.results[0].opportunities[0], /Efficiently encode images/);

  await runJob("priorities", { cwd: p.dir, flags: { dry: true } });
  const items = rd("priorities.json").items;
  assert.ok(items.some((i) => i.type === "speed"), "poor speed is prioritised");
  assert.ok(items.some((i) => i.type === "ai-search"), "blocked AI crawler is prioritised");

  await runJob("digest", { cwd: p.dir });
  const digest = readFileSync(join(stateDir, "weekly-digest.md"), "utf8");
  assert.match(digest, /Search Console/);
  assert.match(digest, /Top priorities/);

  await runJob("dashboard", { cwd: p.dir });
  const html = readFileSync(join(stateDir, "dashboard", "index.html"), "utf8");
  assert.ok(html.includes("AI search readiness") && html.includes("Speed (Core Web Vitals)"));
});

test("experiments log, evaluate and refresh run without errors", async (t) => {
  const p = await project(t);
  await runJob("experiments", { cwd: p.dir, positional: ["add", "/guide", "rewrote the title"] });
  await runJob("experiments", { cwd: p.dir });
  await runJob("refresh", { cwd: p.dir, flags: { dry: true } });
  assert.ok(true);
});

test("the request-indexing list shows the full URL to paste and never a Search Console page deep link", async (t) => {
  const p = await project(t);
  const stateDir = join(p.dir, ".seo-autopilot", readFileSync(join(p.dir, "seo-autopilot.config.json"), "utf8").match(/"id":\s*"([^"]+)"/)[1]);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "inspect-state.json"), JSON.stringify({ results: { [`${SITE}guide`]: { coverage: "URL is unknown to Google" }, [`${SITE}`]: { coverage: "Submitted and indexed" } } }));
  await runJob("indexing-queue", { cwd: p.dir, flags: { dry: true } });
  const md = readFileSync(join(stateDir, "request-indexing.md"), "utf8");
  assert.ok(md.includes(`${SITE}guide`), "the full URL is listed for copying");
  assert.ok(md.includes("https://search.google.com/search-console?resource_id="), "links to the property");
  assert.ok(!md.includes("search-console/inspect"), "no page deep link (it answers 404)");
});

// Content-loss guard and the content watch, end to end: a real git history in the temp project, the fake website, and the
// job outputs the seo-check and seo-watch workflows act on.
test("seo-check guard blocks a shrinking refresh; seo-watch reverts a harmful refresh, then unpublishes a harmful new page", async (t) => {
  const p = await project(t);
  const { spawnSync } = await import("node:child_process");
  const git = (...a) => { const r = spawnSync("git", a, { cwd: p.dir, encoding: "utf8" }); if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };
  const cfgFile = join(p.dir, "seo-autopilot.config.json");
  const cfg = JSON.parse(readFileSync(cfgFile, "utf8"));
  cfg.sites[0].content = { type: "markdown", dir: "content/blog", urlPattern: "/blog/{slug}" };
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  const blog = join(p.dir, "content", "blog"); mkdirSync(blog, { recursive: true });
  const post = (slug, title, keyword, n, extra = "") => `---\ntitle: ${title}\nslug: ${slug}\nkeyword: ${keyword}\n---\n\n# ${title}\n\n## Why it matters\n\n${words(n)}\n\nSee [the guide](/guide).${extra}\n`;
  writeFileSync(join(blog, "fit.md"), post("fit", "How to choose a running shoe", "running shoe fit", 900));
  writeFileSync(join(blog, "trail.md"), post("trail", "Best trail running shoes", "trail running shoes", 600));
  git("init", "-q", "-b", "main"); git("config", "user.email", "t@example.test"); git("config", "user.name", "t"); git("config", "commit.gpgsign", "false");
  git("add", "-A"); git("commit", "-qm", "site");

  // 1. seo-check: an seo/* branch that cuts the post to a third fails the guard (exit 1).
  git("checkout", "-qb", "seo/issue-4");
  writeFileSync(join(blog, "fit.md"), post("fit", "How to choose a running shoe", "running shoe fit", 250));
  git("commit", "-qam", "refresh fit");
  process.exitCode = 0;
  await runJob("content-guard", { cwd: p.dir, flags: { base: "main", branch: "seo/issue-4" } });
  assert.equal(process.exitCode, 1, "the shrinking refresh is blocked");
  process.exitCode = 0;
  const guard = JSON.parse(readFileSync(join(p.state(), "content-guard.json"), "utf8"));
  assert.equal(guard.pages[0].status, "fail"); assert.match(guard.pages[0].reasons[0], /words fell/);

  // 2. Two changes merged 25 days ago: a refresh (#5) and a new page (#6) on the same topic as an existing one.
  git("checkout", "-q", "main");
  writeFileSync(join(blog, "fit.md"), post("fit", "How to choose a running shoe", "running shoe fit", 950, "\n\n## Sizing\n\nMore."));
  git("commit", "-qam", "Refresh fit (#5)"); const sha5 = git("rev-parse", "HEAD");
  writeFileSync(join(blog, "trail-beginners.md"), post("trail-beginners", "Trail running shoes for beginners", "trail running shoes", 700));
  git("add", "-A"); git("commit", "-qm", "New page (#6)"); const sha6 = git("rev-parse", "HEAD");
  const add = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10), merged = add(today, -25);
  const series = {};
  const fill = (url, from, to, clicks) => { series[url] ||= {}; for (let d = from; d <= to; d = add(d, 1)) series[url][d] = [clicks, 300, 6]; };
  const u = (slug) => `${SITE}blog/${slug}`;
  for (const c of ["c1", "c2", "c3"]) fill(`${SITE}${c}`, add(merged, -30), add(today, -2), 10);
  fill(u("fit"), add(merged, -30), add(merged, -1), 12); fill(u("fit"), merged, add(today, -2), 4);     // refresh: 12 -> 4 a day
  fill(u("trail"), add(merged, -30), add(merged, -1), 12); fill(u("trail"), merged, add(today, -2), 3); // the older page loses clicks
  fill(u("trail-beginners"), merged, add(today, -2), 1);                                                // and the new page barely gets any
  mkdirSync(p.state(), { recursive: true });
  writeFileSync(join(p.state(), "page-daily.json"), JSON.stringify(series));
  const prs = [
    { number: 5, mergedAt: merged + "T10:00:00Z", mergeCommit: { oid: sha5 }, files: [{ path: "content/blog/fit.md" }], headRefName: "seo/issue-5", labels: [{ name: "seo-refresh" }] },
    { number: 6, mergedAt: merged + "T11:00:00Z", mergeCommit: { oid: sha6 }, files: [{ path: "content/blog/trail-beginners.md" }], headRefName: "seo/issue-6", labels: [{ name: "seo-topic" }] },
    { number: 7, mergedAt: merged + "T12:00:00Z", mergeCommit: { oid: sha6 }, files: [{ path: "content/blog/trail.md" }], headRefName: "fix/typo", labels: [] },
  ];
  const tmp = mkdtempSync(join(tmpdir(), "seo-e2e-watch-"));
  writeFileSync(join(tmp, "content.json"), JSON.stringify(prs)); writeFileSync(join(tmp, "prs.json"), "[]"); writeFileSync(join(tmp, "reverts.json"), "[]");
  const base = globalThis.fetch;
  globalThis.fetch = async (input, init) => (String(input?.url || input).startsWith(`${SITE}blog/`) ? new Response("<html><head><title>x</title></head><body>ok</body></html>", { headers: { "content-type": "text/html" } }) : base(input, init));
  const outputs = async (flags) => {
    const out = join(tmp, "out"); writeFileSync(out, ""); process.env.GITHUB_OUTPUT = out;
    try { await runJob("watch", { cwd: p.dir, flags }); } finally { delete process.env.GITHUB_OUTPUT; }
    return Object.fromEntries(readFileSync(out, "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  };
  const first = await outputs({ prs: join(tmp, "prs.json"), content: join(tmp, "content.json"), reverts: join(tmp, "reverts.json") });
  assert.equal(first.revert, `5 ${sha5} refresh`, "the refresh is reverted first (the revert job runs watch --git-revert on its merge commit)");
  assert.match(first.reason, /clicks fell/);
  const list = JSON.parse(readFileSync(join(p.state(), "watch-content.json"), "utf8")).entries;
  assert.deepEqual(list.map((e) => [e.pr, e.kind, e.status]), [[5, "refresh", "revert"], [6, "new-page", "revert"]], "a person's own branch (#7) is not watched");
  assert.deepEqual(list[1].related, [u("trail")]);

  // 3. Next day: the revert for #5 exists, so #6 comes next; the workflow unpublishes it through the adapter.
  writeFileSync(join(tmp, "reverts.json"), JSON.stringify(["seo/revert-5"]));
  const second = await outputs({ prs: join(tmp, "prs.json"), content: join(tmp, "content.json"), reverts: join(tmp, "reverts.json") });
  assert.equal(second.revert, `6 ${sha6} new-page`);
  assert.match(second.reason, /taking their place/);
  git("checkout", "-qb", "seo/revert-6");
  const un = await outputs({ unpublish: "6" });
  assert.equal(un.unpublished, "1");
  const after = readFileSync(join(blog, "trail-beginners.md"), "utf8");
  assert.match(after, /^---\ntitle: Trail running shoes for beginners\nslug: trail-beginners\nkeyword: trail running shoes\ndraft: true\nhold: true\n---/, "draft and hold set; file, slug and text kept");
  git("commit", "-qam", "Unpublish the new page from #6 (seo-watch)");
  globalThis.fetch = base;
  // 4. The unpublish pull request passes the content-loss guard only as what seo-watch made: opened and labelled by the
  //    bot, and exactly the adapter's unpublish of the page #6 added. On its own, draft: true is a page-setting change.
  process.exitCode = 0;
  await runJob("content-guard", { cwd: p.dir, flags: { base: "main", branch: "seo/revert-6" } });
  assert.equal(process.exitCode, 1, "without the bot's provenance the unpublish is checked like any change");
  const bot = "github-actions[bot]";
  writeFileSync(join(tmp, "events.jsonl"), JSON.stringify({ event: "labeled", label: "seo-revert", actor: bot, type: "Bot", created_at: new Date().toISOString() }) + "\n");
  writeFileSync(join(tmp, "revert-of.json"), JSON.stringify({ number: 6, merged: true, mergeCommit: sha6, headRefName: "seo/issue-6", commits: ["New page (#6)"] }));
  process.exitCode = 0;
  await runJob("content-guard", { cwd: p.dir, flags: { base: "main", branch: "seo/revert-6", author: bot, labels: "seo-revert", events: join(tmp, "events.jsonl"), "revert-of": join(tmp, "revert-of.json") } });
  assert.equal(process.exitCode, 0);
  process.exitCode = 0;
});
