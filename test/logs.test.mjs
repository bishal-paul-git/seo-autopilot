// Crawler log analysis: parsing common log formats, telling crawlers apart, and never keeping visitor detail.
// Sample lines are shaped like real logs; DNS verification is not exercised here (no network in tests).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLine, crawlerOf, createCollector } from "../src/analysis/logs.mjs";
import { routeAgents } from "../src/analysis/agent-router.mjs";

const GOOGLE = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const line = (ip, path, status, ua, t = "18/Oct/2026:10:00:00 +0100") => `${ip} - - [${t}] "GET ${path} HTTP/1.1" ${status} 512 "-" "${ua}"`;

test("parsing: combined format with a time zone, the plain common format, and JSON lines from a CDN", () => {
  assert.deepEqual(parseLine(line("66.249.66.1", "/a?x=1", 200, GOOGLE)), { ip: "66.249.66.1", time: "2026-10-18T09:00:00.000Z", method: "GET", path: "/a?x=1", status: 200, ua: GOOGLE });
  assert.equal(parseLine('1.2.3.4 - - [18/Oct/2026:10:00:00 -0530] "GET / HTTP/1.0" 404 0').time, "2026-10-18T15:30:00.000Z");
  const j = parseLine(JSON.stringify({ ClientIP: "1.1.1.1", ClientRequestURI: "/b", EdgeResponseStatus: 301, ClientRequestUserAgent: "GPTBot/1.1", EdgeStartTimestamp: 1792317600000000000 }));
  assert.equal(j.path, "/b"); assert.equal(j.status, 301); assert.equal(j.ua, "GPTBot/1.1"); assert.match(j.time, /^20\d\d-/);
  assert.equal(parseLine("not a log line"), null);
  assert.equal(parseLine("{broken json"), null);
});

test("crawlers: the specific name wins (image vs web, user vs training vs search), and people are not crawlers", () => {
  assert.equal(crawlerOf(GOOGLE).name, "Googlebot");
  assert.equal(crawlerOf("Googlebot-Image/1.0").name, "Googlebot-Image");
  assert.deepEqual(["Mozilla/5.0; Claude-User/1.0", "ClaudeBot/1.0", "Claude-SearchBot/1.0", "OAI-SearchBot/1.0", "ChatGPT-User/1.0", "GPTBot/1.1"].map((u) => crawlerOf(u).kind), ["ai-user", "ai-training", "ai-search", "ai-search", "ai-user", "ai-training"]);
  assert.equal(crawlerOf("Mozilla/5.0 (Windows NT 10.0) Chrome/120"), null);
});

test("collector: crawl waste, sitemap pages not crawled, noindex crawling, assets set aside, fakes left out", () => {
  const c = createCollector();
  for (let i = 0; i < 70; i++) c.add(parseLine(line("66.249.66.1", `/page-${i % 7}`, 200, GOOGLE)));
  for (let i = 0; i < 20; i++) c.add(parseLine(line("66.249.66.1", "/old", 404, GOOGLE)));
  for (let i = 0; i < 15; i++) c.add(parseLine(line("66.249.66.1", "/list?sort=price", 200, GOOGLE)));
  for (let i = 0; i < 10; i++) c.add(parseLine(line("66.249.66.1", "/app.js", 200, GOOGLE)));
  for (let i = 0; i < 6; i++) c.add(parseLine(line("66.249.66.1", `/tag/${i}`, 200, GOOGLE)));
  c.add(parseLine(line("6.6.6.6", "/x", 200, GOOGLE)), { verified: false });
  c.add(parseLine(line("9.9.9.9", "/", 200, "Mozilla/5.0 Chrome/120")));
  const sitemapPaths = [...Array.from({ length: 7 }, (_, i) => `/page-${i}`), ...Array.from({ length: 8 }, (_, i) => `/never-${i}`)];
  const r = c.finish({ sitemapPaths, noindexPaths: Array.from({ length: 6 }, (_, i) => `/tag/${i}`) });
  const g = r.crawlers.find((x) => x.name === "Googlebot");
  assert.equal(g.hits, 121); assert.equal(g.failedVerify, 1); assert.equal(g.assetShare, 8);
  assert.equal(r.googlebot.wastedShare, 32, "20 errors + 15 parameter requests of 111 page requests");
  assert.equal(r.googlebot.sitemapNotCrawledCount, 8);
  assert.deepEqual(r.findings.map((f) => f.id).sort(), ["crawl-waste", "fake-googlebot", "noindex-crawled", "sitemap-not-crawled"]);
  assert.ok(!JSON.stringify(r).includes("66.249.66.1"), "no IP address in the totals");
});

test("collector: logs with no Googlebot say so instead of inventing figures", () => {
  const c = createCollector();
  c.add(parseLine(line("1.1.1.1", "/", 200, "GPTBot/1.1")));
  const r = c.finish({ sitemapPaths: ["/a"] });
  assert.deepEqual(r.findings.map((f) => f.id), ["no-googlebot"]);
  assert.equal(r.googlebot, undefined);
});

test("router: medium crawl findings send the log analyst in the fix phase; low ones do not", () => {
  const base = { profile: { mode: "edit", signals: { structuredData: ["Organization"] } } };
  const p = routeAgents({ ...base, logs: { findings: [{ id: "crawl-waste", severity: "medium", title: "32% wasted" }], googlebot: { errors: [{ path: "/old" }], redirects: [] } } });
  const s = p.steps.find((x) => x.agent === "seo-log-analyst");
  assert.equal(s.phase, "fix"); assert.match(s.prompt, /logs\.json/); assert.deepEqual(s.targets, ["/old"]);
  assert.ok(!routeAgents({ ...base, logs: { findings: [{ id: "noindex-crawled", severity: "low", title: "x" }] } }).steps.some((x) => x.agent === "seo-log-analyst"));
});

test("logs job: reads plain and gzipped files, matches the audit, writes totals only, and explains when there are no logs", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-logs-"));
  const state = join(root, "state"), data = join(root, "data");
  mkdirSync(join(data, "logs"), { recursive: true }); mkdirSync(state);
  writeFileSync(join(data, "logs", "access.log"), [line("66.249.66.9", "/a", 200, GOOGLE), line("66.249.66.9", "/gone", 404, GOOGLE), "garbage"].join("\n"));
  writeFileSync(join(data, "logs", "access.log.1.gz"), gzipSync(line("20.15.1.1", "/a", 200, "OAI-SearchBot/1.0") + "\n"));
  writeFileSync(join(state, "audit.json"), JSON.stringify({ generatedAt: "t", pages: [{ url: "https://s.test/a", status: 200, inSitemap: true }, { url: "https://s.test/b", status: 200, inSitemap: true }] }));
  const site = { id: "s", name: "S", url: "https://s.test/", paths: { state, root, data } };
  const log = console.log; let out = ""; console.log = (m) => { out += m; };
  try { await (await import("../src/jobs/logs.mjs")).run({ site, flags: {} }); } finally { console.log = log; }
  const raw = readFileSync(join(state, "logs.json"), "utf8");
  const r = JSON.parse(raw);
  assert.equal(r.files, 2); assert.equal(r.unparsed, 1);
  assert.deepEqual(r.crawlers.map((c) => c.name).sort(), ["Googlebot", "OAI-SearchBot"]);
  assert.deepEqual(r.googlebot.sitemapNotCrawled, ["/b"]);
  assert.ok(!raw.includes("66.249.66.9") && !out.includes("66.249.66.9") && !raw.includes("20.15.1.1"), "IP addresses never reach the report");
  assert.match(out, /identified by user agent only \(claimed\)/);
  let msg = ""; console.log = (m) => { msg = m; };
  try { await (await import("../src/jobs/logs.mjs")).run({ site: { ...site, paths: { ...site.paths, data: join(root, "none") } }, flags: {} }); } finally { console.log = log; }
  assert.match(msg, /No access logs found/);
});
