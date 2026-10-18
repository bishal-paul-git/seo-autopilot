// The optional Python and Go engines. Each test skips cleanly when the tool is not installed, so `npm test` works anywhere;
// CI installs both so they always run there.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/cli/init.mjs";
import { runJob } from "../src/jobs/index.mjs";
import { findPython } from "../src/lib/python.mjs";
import { findGoEngine } from "../src/audit/engines.mjs";
import { crawlSite } from "../src/audit/crawl.mjs";
import { loadConfig } from "../src/core/config.mjs";

const py = findPython();
const go = findGoEngine();

async function quiet(fn) { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } }

test("python deepdive writes topics, anomalies and trends from saved Search Console data", { skip: !py && "python 3.10+ not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "seo-py-"));
  const cwd = process.cwd(); process.chdir(dir);
  try {
    await quiet(() => init({ flags: { url: "https://py.test/", name: "Py", "no-workflows": true } }));
    const cfg = loadConfig({ cwd: dir });
    const state = cfg.sites[0].paths.state;
    mkdirSync(state, { recursive: true });
    const rows = [["ai voice agent for dentists", 60], ["ai voice agents for dental practices", 40], ["crm migration checklist", 50], ["crm data migration checklist", 30]].map(([query, impressions]) => ({ query, page: "https://py.test/p", clicks: 0, impressions, position: 12 }));
    writeFileSync(join(state, "gsc-rows.json"), JSON.stringify({ window: { start: "2026-09-01", end: "2026-09-28" }, rows }));
    const daily = {}; const d0 = Date.parse("2026-09-01");
    for (let i = 0; i < 30; i++) daily[new Date(d0 + i * 864e5).toISOString().slice(0, 10)] = [1, i === 29 ? 400 : 100 + (i % 3), 10];
    writeFileSync(join(state, "page-daily.json"), JSON.stringify({ "https://py.test/p": daily }));
    await quiet(() => runJob("deepdive", { cwd: dir }));
    const out = JSON.parse(readFileSync(join(state, "deepdive.json"), "utf8"));
    assert.equal(out.clusters.length, 2);
    assert.ok(out.unusualDays.some((u) => u.direction === "up"), "the spike is found");
    assert.ok(readFileSync(join(state, "deepdive.md"), "utf8").includes("Topics"));
  } finally { process.chdir(cwd); }
});

test("running the agent job without a name explains what is available and does not fail", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seo-agent-"));
  const cwd = process.cwd(); process.chdir(dir);
  const lines = []; const log = console.log; console.log = (m) => lines.push(String(m));
  try {
    await init({ flags: { url: "https://ag.test/", name: "Ag", "no-workflows": true } });
    await runJob("agent", { cwd: dir, positional: [] });
  } finally { console.log = log; process.chdir(cwd); }
  assert.ok(lines.some((l) => /seo-strategist/.test(l) && /seo-researcher/.test(l)));
});

test("the Go crawler gives the same audit data as the built-in crawler", { skip: !go && "Go toolchain or seo-crawl not found" }, async () => {
  const pages = {
    "/": `<html lang="en"><head><title>Home page title here</title><meta name="description" content="${"d".repeat(100)}"><link rel="canonical" href="BASE/"></head><body><header><h2>Brand</h2></header><main><h1>Home</h1><!-- <h2>hidden</h2> --><h2>Intro</h2></main><a href="/a">a</a><a href="/missing">m</a><a href="/old">o</a></body></html>`,
    "/a": `<html lang="en"><head><title>Page A title here ok</title><link rel="canonical" href="BASE/a"></head><body><nav><h3>Menu</h3></nav><h1>A</h1><h2>Part <b>one</b></h2><h4>Deep</h4><a href="/">home</a><footer><h4>Contact</h4></footer><script type="application/ld+json">{"@type":"FAQPage"}</script></body></html>`,
    "/new": `<html lang="en"><head><title>New page title here</title></head><body><h1>New</h1></body></html>`,
  };
  const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === "/sitemap.xml") { res.setHeader("content-type", "application/xml"); return res.end(`<urlset>${["/", "/a", "/old"].map((p) => `<url><loc>${base}${p}</loc></url>`).join("")}</urlset>`); }
    if (req.url === "/robots.txt") { res.setHeader("content-type", "text/plain"); return res.end("User-agent: *\nAllow: /\n"); }
    if (req.url === "/old") { res.statusCode = 301; res.setHeader("location", "/mid"); return res.end(); }
    if (req.url === "/mid") { res.statusCode = 302; res.setHeader("location", "/new"); return res.end(); }
    if (pages[req.url]) { res.setHeader("content-type", "text/html"); return res.end(pages[req.url].replaceAll("BASE", base)); }
    res.statusCode = 404; res.setHeader("content-type", "text/html"); res.end("nope");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${server.address().port}/`;
    const site = { url: base, sitemap: `${base}sitemap.xml`, audit: {} };
    const a = await quiet(() => crawlSite(site, { engine: "node" }));
    const b = await quiet(() => crawlSite(site, { engine: "go" }));
    const norm = (r) => r.pages.map((p) => ({ url: p.url.replace(/\/$/, ""), status: p.status, chain: p.chain.length, title: p.title, h1: p.h1s[0] || "", inSitemap: p.inSitemap, inbound: p.inbound, depth: p.depth, jsonld: p.jsonld.types.join(), canonical: p.canonical || null, headings: JSON.stringify(p.headings) })).sort((x, y) => x.url.localeCompare(y.url));
    assert.deepEqual(norm(b), norm(a));
    assert.deepEqual([...b.ctx.brokenTargets.keys()].sort(), [...a.ctx.brokenTargets.keys()].sort());
    assert.equal(b.ctx.robotsTxt, a.ctx.robotsTxt);
  } finally { server.close(); }
});
