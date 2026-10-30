// Client portal snapshot: keywords and totals from Search Console rows, page scores, location grouping, GA4 visits,
// the job end to end (portal.json) and the push request (token in the header only, never in an error).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keywordRows, pageRows, locationRows, buildSnapshot, isIndexed } from "../src/analysis/portal.mjs";
import { traffic } from "../src/lib/ga4.mjs";

const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const U = "https://plumber.test";
const GSC = {
  window: { start: "2026-09-01", end: "2026-09-28" },
  rows: [
    { query: "plumber leeds", page: `${U}/areas/leeds/`, clicks: 2, impressions: 100, position: 8 },
    { query: "plumber leeds", page: `${U}/`, clicks: 0, impressions: 20, position: 14 },
    { query: "boiler repair", page: `${U}/boilers`, clicks: 1, impressions: 40, position: 20 },
  ],
  prevRows: [{ query: "plumber leeds", page: `${U}/`, clicks: 0, impressions: 50, position: 12 }],
};
const AUDIT = {
  summary: { pagesCrawled: 4, bySeverity: { high: 0, medium: 1, low: 1 } },
  issues: [{ url: `${U}/boilers`, rule: "title-long", severity: "medium" }, { url: `${U}/boilers`, rule: "desc-long", severity: "low" }],
  pages: [
    { url: `${U}/`, status: 200, title: "Home", words: 800, description: "d" },
    { url: `${U}/boilers`, status: 200, title: "Boilers", words: 200, description: "" },
    { url: `${U}/areas/leeds/`, status: 200, title: "Leeds", words: 500, description: "d" },
    { url: `${U}/areas/leeds/headingley`, status: 200, title: "Headingley", words: 500, description: "d" },
    { url: `${U}/gone`, status: 404 },
  ],
};
const INSPECT = { results: { [`${U}/`]: { coverage: "Submitted and indexed" }, [`${U}/areas/leeds/headingley`]: { coverage: "Discovered - currently not indexed" } } };

test("keywords: totals for both windows, impression-weighted position, top page as a path", () => {
  const { period, keywords } = keywordRows(GSC);
  assert.deepEqual(period.cur, { impressions: 160, clicks: 3, ctr: 1.88, position: 11.8, queries: 2 });
  assert.equal(period.prev.impressions, 50);
  assert.deepEqual(keywords[0], { q: "plumber leeds", i: 120, c: 2, pos: 9, prevPos: 12, page: "/areas/leeds/" });
  assert.equal(keywords[1].prevPos, null);
});

test("page score: issues by severity, not indexed, thin and no description; non-200 pages left out", () => {
  const pages = pageRows({ audit: AUDIT, inspect: INSPECT.results, pageDaily: { [`${U}/`]: { "2026-09-02": [1, 30, 5] } } });
  const by = Object.fromEntries(pages.map((p) => [p.path, p]));
  assert.equal(pages.length, 4);
  assert.equal(by["/"].score, 100); assert.equal(by["/"].i, 30); assert.equal(by["/"].c, 1);
  assert.equal(by["/boilers"].score, 100 - 10 - 3 - 10 - 5);
  assert.equal(by["/areas/leeds/headingley"].score, 80);
  assert.equal(by["/areas/leeds/"].indexed, null, "never inspected: no penalty, shown as unknown");
  assert.ok(isIndexed("Indexed, not submitted in sitemap") && !isIndexed("Crawled - currently not indexed"));
});

test("locations: grouped by area with towns; a custom pattern; a bad pattern gives none", () => {
  const pages = pageRows({ audit: AUDIT, inspect: INSPECT.results });
  const [leeds] = locationRows(pages);
  assert.deepEqual({ area: leeds.area, pages: leeds.pages, towns: leeds.towns.map((t) => [t.name, t.indexed]) }, { area: "Leeds", pages: 2, towns: [["Headingley", false]] });
  assert.equal(locationRows(pages, "^/boilers()$").length, 1);
  assert.deepEqual(locationRows(pages, "(("), []);
});

test("snapshot: every section present; missing reports give empty sections; GA4 not connected says so", () => {
  const s = buildSnapshot({ site: { id: "p", name: "Plumber", url: `${U}/` }, reports: { gscRows: GSC, audit: AUDIT, inspect: INSPECT, profile: { platform: { name: "WordPress" } } }, now: "2026-09-30T00:00:00Z", options: { market: "UK" } });
  assert.equal(s.version, 1); assert.equal(s.site.platform, "WordPress"); assert.equal(s.site.market, "UK");
  assert.deepEqual(s.coverage, [["Submitted and indexed", 1], ["Discovered - currently not indexed", 1]]);
  assert.deepEqual(s.notIndexed, [{ url: "/areas/leeds/headingley", state: "Discovered - currently not indexed" }]);
  assert.equal(s.integrations.find((x) => x.name === "Google Analytics 4").ok, false);
  const empty = buildSnapshot({ site: { id: "e" }, reports: {} });
  assert.deepEqual([empty.keywords, empty.pages, empty.locations, empty.runs, empty.audit, empty.rank], [[], [], [], [], null, null]);
});

test("GA4 traffic: both windows in one call per dimension, split by the dateRange dimension", async () => {
  const bodies = [];
  const f = async (u, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    const dim = b.dimensions[0]?.name;
    const row = (k, range, s) => ({ dimensionValues: [...(dim ? [{ value: k }] : []), { value: range }], metricValues: [{ value: String(s) }, { value: String(s - 1) }] });
    return res({ rows: dim === "sessionDefaultChannelGroup" ? [row("Organic Search", "cur", 40), row("Direct", "cur", 10), row("Organic Search", "prev", 30)] : [row("x", "cur", 50), row("x", "prev", 30)] });
  };
  const t = await traffic("123", "tok", { fetchFn: f });
  assert.equal(bodies.length, 5);
  assert.deepEqual(bodies[0].dateRanges.map((d) => d.name), ["cur", "prev"]);
  assert.deepEqual(t.channels.cur.map((x) => [x.key, x.sessions]), [["Organic Search", 40], ["Direct", 10]]);
  assert.deepEqual(t.channels.prev, [{ key: "Organic Search", sessions: 30, users: 29 }]);
  assert.equal(t.total.cur[0].sessions, 50);
});

test("job: writes portal.json; --push sends the snapshot with the token in the header; errors hide the token", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-portal-")), state = join(root, "state"); mkdirSync(state);
  writeFileSync(join(state, "gsc-rows.json"), JSON.stringify(GSC));
  writeFileSync(join(state, "audit.json"), JSON.stringify(AUDIT));
  writeFileSync(join(state, "agent-runs.jsonl"), `${JSON.stringify({ at: "2026-09-29T06:00:00Z", agent: "seo-strategist", task: "Plan", costUsd: 0.12 })}\nnot json\n`);
  writeFileSync(join(state, "insights.json"), "");
  const { run, push } = await import("../src/jobs/portal.mjs");
  const calls = [];
  const f = async (u, init) => { calls.push({ u, init }); return res({ ok: true, site: "plumber", at: "2026-09-30T06:00:00Z" }); };
  const env = { SEO_PORTAL_URL: "https://portal.test/functions/v1/ingest", SEO_PORTAL_TOKEN: "spt_secret" };
  const log = console.log; console.log = () => {};
  try {
    await run({ site: { id: "p", name: "Plumber", url: `${U}/`, paths: { state } }, flags: { push: true } }, { env, fetch: f, now: "2026-09-30T06:00:00Z" });
  } finally { console.log = log; }
  const snap = JSON.parse(readFileSync(join(state, "portal.json"), "utf8"));
  assert.equal(snap.runs.length, 1); assert.equal(snap.runs[0].cost, 0.12); assert.equal(snap.window, null);
  assert.equal(calls[0].u, env.SEO_PORTAL_URL);
  assert.equal(calls[0].init.headers.Authorization, "Bearer spt_secret");
  assert.equal(JSON.parse(calls[0].init.body).snapshot.site.id, "p");
  await assert.rejects(push(snap, { env, fetch: async () => res({ error: "bad token spt_secret" }, 401) }), (e) => /HTTP 401/.test(e.message) && /revoked/.test(e.message) && !e.message.includes("spt_secret"));
  await assert.rejects(push(snap, { env: {} }), /set SEO_PORTAL_URL/);
  await assert.rejects(push(snap, { env: { ...env, SEO_PORTAL_URL: "http://portal.test" } }), /https/);
});

test("issues and decisions: kinds from labels; approve labels, comments and starts drafting; hold; decline closes", async () => {
  const { issueRows, decisionActions } = await import("../src/analysis/portal.mjs");
  const rows = issueRows([{ number: 7, title: "Refresh /boilers", labels: [{ name: "seo-proposal" }, { name: "seo-refresh" }], html_url: "u7" }, { number: 9, title: "New page", labels: ["seo-topic", "approved"] }]);
  assert.deepEqual(rows.map((r) => [r.number, r.kind, r.approved]), [[9, "new page", true], [7, "refresh", false]]);
  const a = decisionActions({ issue: 7, decision: "approve", by: "ann@agency.test", note: "go" }, rows[1], { ref: "main" });
  assert.deepEqual(a.map((x) => x.type), ["label", "comment", "dispatch"]);
  assert.match(a[1].body, /Approved in the client portal by ann@agency\.test\.\n\n> go/);
  assert.equal(a[2].workflow, "seo-implement.yml");
  assert.deepEqual(decisionActions({ issue: 7, decision: "hold" }, rows[1])[0].labels, ["seo-hold"]);
  assert.deepEqual(decisionActions({ issue: 7, decision: "decline" }, rows[1]).map((x) => x.type), ["comment", "close"]);
  assert.deepEqual(decisionActions({ issue: 99, decision: "approve" }, undefined), []);
});

test("job: lists proposals into the snapshot, applies the portal's decisions on GitHub, then acknowledges them", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-portal-dec-")), state = join(root, "state"); mkdirSync(state);
  const { run } = await import("../src/jobs/portal.mjs");
  const ghCalls = [];
  const gh = async (path, init = {}) => {
    ghCalls.push([init.method || "GET", path, init.body ? JSON.parse(init.body) : null]);
    if (path.startsWith("/issues?labels=seo-proposal")) return res([{ number: 7, title: "Refresh /boilers", labels: [{ name: "seo-proposal" }] }, { number: 8, title: "Not really", labels: [{ name: "seo-proposal" }] }]);
    if (path.startsWith("/issues?")) return res([]);
    if (path === "/issues/8/comments") return res({}, 403);
    return res({});
  };
  const posts = [];
  const f = async (u, init) => {
    const b = JSON.parse(init.body); posts.push(b);
    return res(b.snapshot ? { ok: true, at: "t", decisions: [{ id: 1, issue: 7, decision: "approve", by: "ann@agency.test" }, { id: 2, issue: 8, decision: "decline" }, { id: 3, issue: 55, decision: "hold" }] } : { ok: true, decisions: [] });
  };
  const log = console.log; console.log = () => {};
  try {
    await run({ site: { id: "p", name: "P", url: "https://p.test/", labels: { proposal: "seo-proposal", topic: "seo-topic", approved: "approved" }, paths: { state } }, flags: { push: true } },
      { env: { SEO_PORTAL_URL: "https://portal.test/functions/v1/ingest", SEO_PORTAL_TOKEN: "spt_x", GITHUB_REF_NAME: "main" }, fetch: f, gh, now: "t" });
  } finally { console.log = log; }
  assert.deepEqual(posts[0].snapshot.issues.map((i) => i.number), [8, 7]);
  assert.ok(ghCalls.some(([m, p, b]) => m === "POST" && p === "/issues/7/labels" && b.labels[0] === "approved"));
  assert.ok(ghCalls.some(([m, p, b]) => m === "POST" && p === "/actions/workflows/seo-implement.yml/dispatches" && b.inputs.issue === "7" && b.ref === "main"));
  assert.ok(ghCalls.some(([m, p]) => m === "PATCH" && p === "/issues/8"), "decline still tries to close");
  // 1 applied; 2 failed (comment refused) so it is retried next run; 3 is not open any more, so it is acknowledged.
  assert.deepEqual(posts[1], { applied: [1, 3] });
});
