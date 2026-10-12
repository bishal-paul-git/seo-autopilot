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
