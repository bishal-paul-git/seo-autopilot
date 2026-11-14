// Central speed checks (D56): a weekly phone check of the home page and top pages with one platform PageSpeed key, plus
// the site's real-user numbers from the Chrome UX Report, stored for the agents; planned only when the Worker has the
// key. Mocked Google; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSpeedHandler, speedDue, speedPages, speedForAgents } from "../src/god/speed.mjs";
import { agentInput } from "../src/god/agent-runner.mjs";
import { MemoryStore } from "../src/god/stores.mjs";
import { tick } from "../src/god/tick.mjs";

const NOW = "2026-11-30T12:00:00Z", SITE = { id: "A", name: "P", url: "https://www.plumber.test/" };
const jsonRes = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
const SC = { kind: "report", key: "search_console", value: { pages: [
  { url: "https://www.plumber.test/a", clicks: 2, impressions: 50 }, { url: "https://www.plumber.test/b", clicks: 9, impressions: 10 },
  { url: "https://evil.test/x", clicks: 99, impressions: 999 }, { url: "https://plumber.test/c", clicks: 5, impressions: 5 }, { url: "https://www.plumber.test/d", clicks: 1, impressions: 1 }] } };

function google({ psiStatus = 200, cruxStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, o = {}) => {
    const u = new URL(url); calls.push({ u, body: o.body ? JSON.parse(o.body) : null });
    if (u.pathname.startsWith("/pagespeedonline")) return psiStatus !== 200 ? jsonRes({ error: { message: "API key not valid" } }, psiStatus) : jsonRes({
      lighthouseResult: { categories: { performance: { score: 0.71 } }, audits: { "largest-contentful-paint": { numericValue: 3120.4567 }, "cumulative-layout-shift": { numericValue: 0.05 }, "total-blocking-time": { numericValue: 210 } } },
      loadingExperience: { overall_category: "AVERAGE", metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2600 }, INTERACTION_TO_NEXT_PAINT: { percentile: 180 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 4 } } } });
    if (u.pathname.endsWith("records:queryRecord")) return cruxStatus === 404 ? jsonRes({ error: { message: "chrome ux report data not found" } }, 404)
      : jsonRes({ record: { metrics: { largest_contentful_paint: { percentiles: { p75: 2400 } }, interaction_to_next_paint: { percentiles: { p75: 150 } }, cumulative_layout_shift: { percentiles: { p75: "0.03" } } } } });
    return jsonRes({}, 500);
  };
  return { fetchImpl, calls };
}

test("pages: the home page first, then the top pages by clicks on the same host, capped", () => {
  assert.deepEqual(speedPages(SITE.url, [SC], 4), ["https://www.plumber.test/", "https://www.plumber.test/b", "https://plumber.test/c", "https://www.plumber.test/a"]);
  assert.deepEqual(speedPages("https://plumber.test/shop/", [], 4), ["https://plumber.test/"], "home only without Search Console");
  assert.equal(speedPages(SITE.url, [SC], 0).length, 1, "at least the home page");
});

test("speed job: phone checks with the platform key and few fields; real-user numbers; stored for the agents; free", async () => {
  const store = new MemoryStore(); store.writeMemory("A", [SC]);
  const g = google();
  const out = await makeSpeedHandler({ store, siteOf: async () => SITE, apiKey: "platform-key", fetchImpl: g.fetchImpl, now: () => NOW, maxPages: 3 })({ siteId: "A" });
  const psi = g.calls.filter((c) => c.u.pathname.startsWith("/pagespeedonline"));
  assert.equal(psi.length, 3);
  assert.ok(psi.every((c) => c.u.searchParams.get("key") === "platform-key" && c.u.searchParams.get("strategy") === "mobile" && /^lighthouseResult\(/.test(c.u.searchParams.get("fields"))));
  const crux = g.calls.find((c) => c.u.pathname.endsWith("records:queryRecord"));
  assert.deepEqual(crux.body, { origin: "https://www.plumber.test", formFactor: "PHONE", metrics: ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift"] });
  assert.equal(out.costUsd, 0);
  assert.match(out.evidence[0], /3 of 3 pages measured; home page performance 71\/100; real users \(75th percentile\) LCP 2400 ms, INP 150 ms, CLS 0\.03/);
  const r = store.readMemory("A").find((m) => m.key === "speed");
  assert.equal(r.basis, "verified");
  assert.deepEqual(r.value.pages[0], { url: "https://www.plumber.test/", score: 71, lab: { lcpMs: 3120.457, cls: 0.05, tbtMs: 210 }, field: { lcpMs: 2600, inpMs: 180, cls: 0.04, category: "AVERAGE" } });
  assert.ok(!JSON.stringify(r.value).includes("platform-key"), "the key is never stored");
  assert.equal(speedForAgents(r.value).device, "phone");
  assert.ok(JSON.parse(agentInput({ kind: "agent:seo-speed", inputs: {}, title: "t" }, store.readMemory("A"), SITE).split("\n")[1]).speed.pages.length, "agents read it");
});

test("speed job: no real-user data is a note; every page failing fails the job and stores nothing", async () => {
  const store = new MemoryStore();
  const quiet = google({ cruxStatus: 404 });
  const out = await makeSpeedHandler({ store, siteOf: async () => SITE, apiKey: "k", fetchImpl: quiet.fetchImpl, now: () => NOW })({ siteId: "A" });
  assert.match(out.evidence[0], /too few visits/);
  const broken = new MemoryStore();
  await assert.rejects(makeSpeedHandler({ store: broken, siteOf: async () => SITE, apiKey: "bad", fetchImpl: google({ psiStatus: 400 }).fetchImpl, now: () => NOW })({ siteId: "A" }), /API key not valid/);
  assert.equal(broken.readMemory("A").length, 0);
});

test("planning: weekly, only when the Worker has the PageSpeed key", async () => {
  assert.ok(speedDue([], NOW));
  assert.ok(!speedDue([{ kind: "report", key: "speed", value: { generatedAt: "2026-11-25T12:00:00Z" } }], NOW), "5 days old");
  assert.ok(speedDue([{ kind: "report", key: "speed", value: { generatedAt: "2026-11-23T11:00:00Z" } }], NOW), "a week old");
  const store = new MemoryStore(); store.clock = () => NOW; store.sites = [SITE];
  const handlers = { speed_snapshot: async () => ({ evidence: [] }) };
  const r = await tick({ store, handlers, now: NOW, maxJobs: 0 });
  assert.ok(r.sites[0].queued.some((q) => q.kind === "speed_snapshot"));
  const again = await tick({ store, handlers, now: NOW, maxJobs: 0 });
  assert.ok(!again.sites[0].queued.some((q) => q.kind === "speed_snapshot"), "not twice");
  const none = new MemoryStore(); none.sites = [SITE];
  assert.ok(!(await tick({ store: none, handlers: {}, now: NOW, maxJobs: 0 })).sites[0].queued.some((q) => q.kind === "speed_snapshot"), "never without the key");
});
