// Search Console beyond web search: sitemap findings, search-type totals and drops, shares, the mobile CTR check, routing,
// and the job end to end with a recorded-style fake API (request shapes checked, no network).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sitemapFindings, typeTotals, typeFindings, shares, deviceFindings } from "../src/analysis/gsc.mjs";
import { routeAgents } from "../src/analysis/agent-router.mjs";
import { run, consoleApi } from "../src/jobs/gsc.mjs";

test("sitemaps: none submitted, config sitemap missing, errors, warnings, stale, pending", () => {
  assert.equal(sitemapFindings([], { configured: "https://s.test/sitemap.xml" })[0].id, "sitemap-none-submitted");
  const list = [
    { path: "https://s.test/old-sitemap.xml", lastDownloaded: "2026-08-01T00:00:00Z", errors: "2", warnings: "0" },
    { path: "https://s.test/news.xml", lastDownloaded: "2026-10-20T00:00:00Z", errors: "0", warnings: "5", isPending: true },
  ];
  const ids = sitemapFindings(list, { configured: "https://s.test/sitemap.xml", today: "2026-10-23" }).map((f) => f.id);
  assert.deepEqual(ids, ["sitemap-not-submitted", "sitemap-errors", "sitemap-stale", "sitemap-warnings", "sitemap-pending"]);
  assert.deepEqual(sitemapFindings([{ path: "https://s.test/sitemap.xml/", lastDownloaded: "2026-10-20T00:00:00Z", errors: "0", warnings: "0" }], { configured: "https://s.test/sitemap.xml", today: "2026-10-23" }), [], "a trailing slash is the same sitemap");
});

test("search types: totals against the previous period; a real Discover drop is a finding, a small one is not", () => {
  const rows = (clicks, impressions) => [{ clicks, impressions }];
  const t = typeTotals({ web: rows(500, 9000), discover: rows(40, 3000), image: rows(0, 0) }, { web: rows(480, 8800), discover: rows(200, 9000), image: rows(0, 0) });
  assert.deepEqual(t.map((x) => [x.type, x.change]), [["web", 4], ["discover", -80]], "empty types are left out");
  assert.deepEqual(typeFindings(t).map((f) => f.id), ["drop-discover"]);
  assert.deepEqual(typeFindings(typeTotals({ discover: rows(5, 100) }, { discover: rows(20, 300) })), [], "under 100 previous clicks is noise");
});

test("shares and the mobile click-through check", () => {
  const dev = shares([{ keys: ["MOBILE"], clicks: 100, impressions: 10000, position: 8 }, { keys: ["DESKTOP"], clicks: 300, impressions: 10000, position: 7 }]);
  assert.deepEqual(dev.map((d) => [d.key, d.share, d.ctr]), [["DESKTOP", 75, 3], ["MOBILE", 25, 1]]);
  assert.equal(deviceFindings(dev)[0].id, "mobile-ctr-low");
  assert.deepEqual(deviceFindings(shares([{ keys: ["MOBILE"], clicks: 100, impressions: 10000, position: 15 }, { keys: ["DESKTOP"], clicks: 300, impressions: 10000, position: 4 }])), [], "different positions explain it");
});

test("routing: sitemap errors block, so the indexing monitor runs first; drops go to the strategist", () => {
  const steps = routeAgents({ gsc: { findings: [{ id: "sitemap-errors", severity: "high", title: "2 errors" }, { id: "drop-discover", severity: "medium", title: "Discover fell 80%", detail: "200 → 40 clicks. More." }] } }).steps;
  const mon = steps.find((s) => s.agent === "seo-indexing-monitor"), strat = steps.find((s) => s.agent === "seo-strategist");
  assert.equal(mon.phase, "block"); assert.match(mon.why, /1 sitemap problem/);
  assert.match(strat.why, /Discover fell 80%/);
});

test("client: requests go to the site's own property with the type and dimensions; errors name the call, not the token", async () => {
  const calls = [];
  const f = async (u, init) => { calls.push({ u, init }); return new Response(JSON.stringify(u.endsWith("/sitemaps") ? { sitemap: [{ path: "x" }] } : { error: { message: "denied" } })); };
  const api = consoleApi({ searchConsoleProperty: "sc-domain:s.test" }, "tok-123", f);
  assert.deepEqual(await api.sitemaps(), [{ path: "x" }]);
  await assert.rejects(api.query({ type: "discover" }), (e) => /searchAnalytics\/query: denied/.test(e.message) && !/tok-123/.test(e.message));
  assert.match(calls[0].u, /sites\/sc-domain%3As\.test\/sitemaps$/);
  assert.equal(calls[1].init.method, "POST"); assert.equal(JSON.parse(calls[1].init.body).type, "discover");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok-123");
});

test("job: windows end 3 days back, every search type is asked twice, fresh days use dataState all, one failing call does not stop it", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-gsc-")), state = join(root, "state"); mkdirSync(state, { recursive: true });
  const bodies = [];
  const api = {
    sitemaps: async () => [{ path: "https://s.test/sitemap.xml", lastDownloaded: "2026-10-21T00:00:00Z", errors: "0", warnings: "0", contents: [{ type: "web", submitted: "120" }] }],
    query: async (b) => {
      bodies.push(b);
      if (b.type === "video") throw new Error("Search Console /searchAnalytics/query: not available");
      if (b.dataState === "all") return [{ keys: ["2026-10-21"], clicks: 9, impressions: 300 }];
      if (b.dimensions?.[0] === "device") return [{ keys: ["MOBILE"], clicks: 10, impressions: 100, position: 5 }];
      return b.type === "discover" ? [{ clicks: b.startDate === "2026-09-23" ? 50 : 150, impressions: 2000 }] : [];
    },
  };
  const log = console.log; console.log = () => {};
  try { await run({ site: { id: "s", name: "S", url: "https://s.test/", sitemap: "https://s.test/sitemap.xml", paths: { state } } }, { api, today: "2026-10-23" }); } finally { console.log = log; }
  const out = JSON.parse(readFileSync(join(state, "gsc.json"), "utf8"));
  assert.deepEqual(out.period, { from: "2026-09-23", to: "2026-10-20" });
  for (const t of ["web", "discover", "googleNews", "news", "image", "video"]) assert.equal(bodies.filter((b) => b.type === t && !b.dimensions.length).length, 2, t);
  assert.equal(out.types.find((t) => t.type === "discover").change, -67);
  assert.ok(out.findings.some((f) => f.id === "drop-discover"));
  assert.deepEqual(out.fresh, [{ date: "2026-10-21", clicks: 9, impressions: 300 }]);
  assert.equal(out.warnings.length, 2, "both video calls failed and were recorded");
  assert.match(readFileSync(join(state, "gsc.md"), "utf8"), /Latest days \(preliminary/);
});
