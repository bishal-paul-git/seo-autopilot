// Competitor and keyword gap: competitor choice, missing/weak/shared, topics, winning pages and what is yours alone.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { competitors, keywordGap, strengths, winningPages, gapTopics } from "../src/analysis/gap.mjs";

test("competitors: your list wins; otherwise share of voice, with platforms such as Wikipedia set apart", () => {
  assert.deepEqual(competitors({ configured: ["www.Rival.test", "s.test"], own: "s.test" }).domains, ["rival.test"]);
  const c = competitors({ shareOfVoice: [{ domain: "en.wikipedia.org", share: 40 }, { domain: "s.test", share: 30, own: true }, { domain: "rival.test", share: 20 }, { domain: "youtube.com", share: 10 }], own: "s.test" });
  assert.deepEqual(c.domains, ["rival.test"]); assert.deepEqual(c.platforms, ["en.wikipedia.org", "youtube.com"]);
});

test("gap: missing, weak and shared by your position; most contested first; strengths are yours alone", () => {
  const own = new Map([["vps hosting", 14], ["web hosting", 4], ["domain transfer", 2]]);
  const theirs = {
    "a.test": [{ query: "VPS Hosting", position: 3, url: "https://a.test/vps", volume: 900 }, { query: "cheap hosting", position: 5, url: "https://a.test/cheap", volume: 2000 }, { query: "web hosting", position: 2, url: "https://a.test/" }, { query: "far away", position: 40 }],
    "b.test": [{ query: "cheap hosting", position: 7, url: "https://b.test/c" }, { query: "hosting cheap", position: 9, url: "https://a.test/cheap", volume: 300 }],
  };
  const g = keywordGap(own, theirs);
  assert.deepEqual(g.missing.map((x) => [x.query, x.competitors.length]), [["cheap hosting", 2], ["hosting cheap", 1]]);
  assert.deepEqual(g.weak.map((x) => [x.query, x.yours, x.volume]), [["vps hosting", 14, 900]]);
  assert.deepEqual(g.shared.map((x) => x.query), ["web hosting"]);
  assert.deepEqual(strengths(own, theirs), [{ query: "domain transfer", position: 2 }]);
  assert.deepEqual(winningPages([...g.missing, ...g.weak]).map((p) => [p.url, p.queries.length]).slice(0, 2), [["https://a.test/cheap", 2], ["https://b.test/c", 1]], "ties go to the page with more volume");
  const t = gapTopics([...g.missing, ...g.weak]);
  assert.deepEqual(t[0], { topic: "cheap hosting", intent: "transactional", queries: ["cheap hosting", "hosting cheap"], volume: 2300, competitors: ["a.test", "b.test"] });
});

const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test("gap job: with DataForSEO, every competitor query against your Search Console and provider positions", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-gap-")); const state = join(root, "state"); mkdirSync(state);
  writeFileSync(join(state, "gsc-rows.json"), JSON.stringify({ rows: [{ query: "vps hosting", impressions: 100, position: 15 }] }));
  const bodies = [];
  const f = async (url, init) => {
    const target = JSON.parse(init.body)[0].target; bodies.push(target);
    const items = target === "rival.test" ? [{ keyword_data: { keyword: "vps hosting", keyword_info: { search_volume: 900 } }, ranked_serp_element: { serp_item: { rank_group: 2, url: "https://rival.test/vps" } } }, { keyword_data: { keyword: "managed wordpress", keyword_info: { search_volume: 400 } }, ranked_serp_element: { serp_item: { rank_group: 6, url: "https://rival.test/wp" } } }]
      : [{ keyword_data: { keyword: "managed wordpress" }, ranked_serp_element: { serp_item: { rank_group: 9 } } }];
    return res({ tasks: [{ status_code: 20000, result: [{ items }] }] });
  };
  const site = { id: "s", name: "S", url: "https://s.test/", research: { competitors: ["rival.test"] }, paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/gap.mjs");
  const log = console.log; console.log = () => {};
  try { await run({ site, flags: {} }, { env: { DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p" }, fetch: f }); } finally { console.log = log; }
  assert.deepEqual(bodies, ["rival.test", "s.test"]);
  const r = JSON.parse(readFileSync(join(state, "gap.json"), "utf8"));
  assert.deepEqual(r.gap.weak.map((x) => x.query), ["vps hosting"]);
  assert.deepEqual(r.gap.shared.map((x) => x.query), ["managed wordpress"], "your provider position fills what Search Console did not report");
  assert.match(readFileSync(join(state, "gap.md"), "utf8"), /Gap topics/);
});

test("gap job: without a provider it compares the tracked queries' live results and says so", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-gap-")); const state = join(root, "state"); mkdirSync(state);
  writeFileSync(join(state, "rank.json"), JSON.stringify({ live: { shareOfVoice: [{ domain: "rival.test", share: 30 }, { domain: "s.test", share: 10, own: true }], perQuery: [
    { query: "web hosting", livePosition: null, results: [{ domain: "rival.test", position: 1, url: "https://rival.test/" }] },
    { query: "vps", livePosition: 2, results: [{ domain: "s.test", position: 2 }, { domain: "rival.test", position: 5, url: "https://rival.test/vps" }] },
  ] } }));
  const site = { id: "s", name: "S", url: "https://s.test/", paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/gap.mjs");
  const log = console.log; console.log = () => {};
  try { await run({ site, flags: {} }, { env: {} }); } finally { console.log = log; }
  const r = JSON.parse(readFileSync(join(state, "gap.json"), "utf8"));
  assert.deepEqual(r.competitors.domains, ["rival.test"]); assert.match(r.method, /tracked queries only/);
  assert.deepEqual(r.gap.missing.map((x) => x.query), ["web hosting"]); assert.deepEqual(r.gap.shared.map((x) => x.query), ["vps"]);
});
