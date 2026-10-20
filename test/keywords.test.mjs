// Keyword explorer: merging sources without inventing numbers, grouping by shared results, difficulty and gaps.
// Providers are mocked; the request shapes follow their public docs and are not tested live.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { terms, readability, stem } from "../src/analysis/text.mjs";
import { mergeCandidates, label, groupKeywords, difficulty, explore, demand } from "../src/analysis/keywords.mjs";
import { bing, dataforseo, openpagerank, suggest } from "../src/lib/research-sources.mjs";

test("text: light stemming merges plural and -ing forms; readability needs enough words", () => {
  assert.deepEqual(terms("Invoices invoice pricing price companies hosting hosted"), ["invoic", "invoic", "pric", "pric", "company", "host", "host"]);
  assert.equal(stem("business"), "business"); assert.equal(stem("class"), "class");
  assert.equal(readability("Too short."), null);
  const r = readability("This is a plain sentence. It is short and clear. People can read it with ease and they like that. We keep words small so the score stays high and the text flows well.");
  assert.ok(r.flesch > 60 && r.wordsPerSentence < 15);
});

test("merge: one record per query with each source's own numbers; brand and off-topic queries are left out", () => {
  const list = mergeCandidates({
    gsc: [{ query: "Web Hosting UK", page: "/hosting", clicks: 3, impressions: 100, position: 8 }, { query: "web hosting uk", page: "/blog", clicks: 0, impressions: 50, position: 20 }, { query: "acme login", impressions: 40, position: 1 }, { query: "pizza recipes", impressions: 90, position: 30 }],
    bing: [{ query: "web hosting uk", bingImpressions: 30 }],
    ideas: [{ query: "cheap web hosting", volume: 1900, cpc: 2.1, difficulty: 41, intent: "commercial" }],
    suggest: [{ query: "web hosting for wordpress" }],
  }, { seeds: ["web hosting"], brandTerms: ["acme"] });
  const byQ = Object.fromEntries(list.map((k) => [k.query, k]));
  assert.deepEqual(Object.keys(byQ).sort(), ["cheap web hosting", "web hosting for wordpress", "web hosting uk"]);
  assert.equal(byQ["web hosting uk"].impressions, 150); assert.equal(byQ["web hosting uk"].position, 12, "impression-weighted position");
  assert.deepEqual(byQ["web hosting uk"].sources, ["search-console", "bing"]);
  assert.equal(byQ["web hosting for wordpress"].volume, null, "a suggestion has no volume");
  assert.deepEqual(demand(byQ["web hosting for wordpress"]), { value: 0, basis: "no volume data" });
  assert.equal(label(byQ["cheap web hosting"]).intent, "commercial");
  assert.equal(label({ query: "how to move a website to new hosting" }).question, true);
  assert.equal(label({ query: "plumber near me" }).local, true);
});

test("grouping: shared top-10 results decide topics when known; same words otherwise", () => {
  const ks = [{ query: "web hosting", volume: 5000 }, { query: "website hosting", volume: 900 }, { query: "hosting for websites", volume: 100 }, { query: "domain names", volume: 3000 }].map((k) => label({ impressions: 0, clicks: 0, ...k }));
  const u = (...n) => n.map((i) => `https://r${i}.test/`);
  const serps = { "web hosting": u(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), "website hosting": u(1, 2, 3, 11, 12, 13, 14, 15, 16, 17), "domain names": u(20, 21, 22, 23, 24, 25, 26, 27, 28, 29), "hosting for websites": u(2, 3, 30, 31, 32, 33, 34, 35, 36, 37) };
  const g = groupKeywords(ks, { serps });
  assert.deepEqual(g.map((x) => [x.parent.query, x.members.map((m) => m.query)]), [["web hosting", ["web hosting", "website hosting"]], ["domain names", ["domain names"]], ["hosting for websites", ["hosting for websites"]]], "2 shared URLs is not enough");
  const lexical = groupKeywords([label({ query: "hosting website", volume: 10 }), label({ query: "website hosting", volume: 20 }), label({ query: "website builder", volume: 5 })]);
  assert.deepEqual(lexical.map((x) => x.members.length), [2, 1]); assert.equal(lexical[0].method, "same words");
});

test("difficulty: the provider's figure, else the average authority of at least 5 top-10 domains, else unknown", () => {
  assert.deepEqual(difficulty({ difficulty: 41.6 }), { value: 42, basis: "provider keyword difficulty" });
  const serp = ["a", "b", "c", "d", "e", "f"].map((d) => ({ domain: `${d}.test` }));
  assert.equal(difficulty({}, { serp, authority: { "a.test": 8, "b.test": 6, "c.test": 4, "d.test": 4, "e.test": 3 } }).value, 50);
  assert.equal(difficulty({}, { serp, authority: { "a.test": 8 } }), null, "too few known domains");
});

test("explore: gaps are topics no page owns; owner comes from Search Console or a covering title", () => {
  const r = explore({ gsc: [{ query: "web hosting", page: "https://s.test/hosting", impressions: 300, clicks: 5, position: 9 }], ideas: [{ query: "domain names", volume: 2000 }, { query: "ssl certificate", volume: 800 }] },
    { pages: [{ url: "https://s.test/ssl", title: "SSL certificates explained" }] });
  const g = Object.fromEntries(r.groups.map((x) => [x.parent, x]));
  assert.equal(g["web hosting"].owner.url, "https://s.test/hosting");
  assert.equal(g["ssl certificate"].owner.url, "https://s.test/ssl");
  assert.deepEqual(r.gaps.map((x) => x.parent), ["domain names"]);
  assert.ok(g["web hosting"].opportunity > 0);
});

const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test("sources: request shapes and parsing for Bing, DataForSEO, Open PageRank and autocomplete; keys never in errors", async () => {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("GetRelatedKeywords")) return res({ d: [{ Query: "Web Hosting UK", Impressions: 120 }] });
    if (String(url).includes("keyword_ideas")) return res({ tasks: [{ status_code: 20000, result: [{ items: [{ keyword: "cheap hosting", keyword_info: { search_volume: 1900, cpc: 2, monthly_searches: [{ search_volume: 2 }, { search_volume: 1 }] }, keyword_properties: { keyword_difficulty: 33 }, search_intent_info: { main_intent: "commercial" } }] }] }] });
    if (String(url).includes("ranked_keywords")) return res({ tasks: [{ status_code: 20000, result: [{ items: [{ keyword_data: { keyword: "vps hosting", keyword_info: { search_volume: 700 } }, ranked_serp_element: { serp_item: { rank_group: 4, url: "https://c.test/vps", etv: 55 } } }] }] }] });
    if (String(url).includes("openpagerank")) return res({ response: [{ status_code: 200, domain: "a.test", page_rank_decimal: 5.5 }, { status_code: 404, domain: "zz.test" }] });
    if (String(url).includes("suggestqueries")) return res(["x", ["Web hosting free", "web hosting uk"]]);
    return res({}, 404);
  };
  const env = { BING_WEBMASTER_API_KEY: "bk", DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p", OPENPAGERANK_API_KEY: "ok" };
  assert.deepEqual(await bing.related("web hosting", "GB", { fetch: f, env, today: new Date("2026-10-20") }), [{ query: "web hosting uk", bingImpressions: 120 }]);
  assert.match(calls[0].url, /country=gb&language=en-GB&startDate=2026-07-20&endDate=2026-10-18/);
  const ideas = await dataforseo.ideas(["hosting"], "US", { fetch: f, env });
  assert.deepEqual(ideas[0], { query: "cheap hosting", volume: 1900, cpc: 2, competition: null, difficulty: 33, intent: "commercial", trend: [1, 2] });
  assert.equal(JSON.parse(calls[1].init.body)[0].location_name, "United States");
  assert.match(calls[1].init.headers.Authorization, /^Basic /);
  assert.deepEqual(await dataforseo.ranked("c.test", "GB", { fetch: f, env }), [{ query: "vps hosting", position: 4, url: "https://c.test/vps", volume: 700, traffic: 55, intent: null }]);
  assert.deepEqual(await openpagerank.authority(["https://www.a.test/x", "zz.test"], { fetch: f, env }), { "a.test": 5.5 });
  assert.equal(calls[3].init.headers["API-OPR"], "ok");
  assert.deepEqual((await suggest.expand("web hosting", "GB", { fetch: f, max: 2, delayMs: 0 })).map((x) => x.query), ["web hosting free", "web hosting uk"]);
  const bad = async () => res({}, 401);
  await assert.rejects(() => bing.related("x", "GB", { fetch: bad, env }), (e) => /key rejected/.test(e.message) && !e.message.includes("bk"));
});

test("keywords job: Search Console alone works; with a SERP provider and Open PageRank it groups by results and scores difficulty", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-kw-")); const state = join(root, "state"); mkdirSync(state); mkdirSync(join(root, "content"));
  writeFileSync(join(root, "content", "a.md"), "---\ntitle: Web hosting plans\nslug: hosting\n---\nText");
  writeFileSync(join(state, "gsc-rows.json"), JSON.stringify({ rows: [{ query: "web hosting", page: "https://s.test/hosting", impressions: 400, clicks: 4, position: 11 }, { query: "website hosting", page: "https://s.test/hosting", impressions: 90, clicks: 1, position: 14 }, { query: "acme", impressions: 50, position: 1 }] }));
  const site = { id: "s", name: "S", url: "https://s.test/", brandTerms: ["acme"], content: { type: "markdown", dir: "content", urlPattern: "/{slug}" }, paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/keywords.mjs");
  const log = console.log; console.log = () => {};
  const u = (...n) => n.map((i) => ({ url: `https://r${i}.test/p`, title: "", position: i }));
  const f = async (url) => {
    url = String(url);
    if (url.includes("serpapi")) return res({ organic_results: (url.includes("website") ? u(1, 2, 3, 4, 11, 12, 13, 14, 15, 16) : u(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)).map((x) => ({ link: x.url, title: "", position: x.position })), related_questions: [{ link: "https://r1.test/p" }] });
    if (url.includes("openpagerank")) return res({ response: Array.from({ length: 16 }, (_, i) => ({ status_code: 200, domain: `r${i + 1}.test`, page_rank_decimal: 4 })) });
    return res({}, 404);
  };
  try {
    await run({ site, flags: {}, positional: [] }, { env: {}, fetch: f, delayMs: 0 });
    let r = JSON.parse(readFileSync(join(state, "keywords.json"), "utf8"));
    assert.deepEqual(r.sourcesUsed, ["search-console"]); assert.equal(r.groups.find((g) => g.parent === "web hosting").owner.url, "https://s.test/hosting");
    assert.ok(!r.list.some((k) => k.query === "acme"), "own brand left out");
    await run({ site, flags: { serp: 5 }, positional: ["hosting"] }, { env: { SERPAPI_KEY: "k", OPENPAGERANK_API_KEY: "o" }, fetch: f, delayMs: 0 });
    r = JSON.parse(readFileSync(join(state, "keywords.json"), "utf8"));
    const g = r.groups.find((x) => x.parent === "web hosting");
    assert.deepEqual(g.members, ["web hosting", "website hosting"]); assert.equal(g.method, "shared results");
    assert.deepEqual(g.difficulty, { value: 40, basis: "average Open PageRank of 10 top-10 domains" });
    assert.match(readFileSync(join(state, "keywords.md"), "utf8"), /Topics by opportunity/);
  } finally { console.log = log; }
});
