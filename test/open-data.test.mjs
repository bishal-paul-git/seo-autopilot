// Open data with no key: Wikipedia pageviews (topic interest) and Stack Exchange questions, request shapes, parsing, the pure
// summaries and the keywords job with recorded-style responses. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wikipedia, stackexchange, decode, wikiLang } from "../src/lib/open-data.mjs";
import { interest, communityQuestions, openDataMarkdown } from "../src/analysis/keywords.mjs";
import { validate } from "../src/core/config.mjs";

const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const views = (list) => list.map((v, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, views: v }));

test("wikipedia: search finds the article, pageviews cover the last 12 full months, a User-Agent is sent", async () => {
  const calls = [];
  const f = async (u, init) => { calls.push({ u: String(u), init }); return String(u).includes("w/api.php") ? res({ query: { search: [{ title: "Web hosting service" }] } }) : res({ items: [{ timestamp: "2025100100", views: 120 }, { timestamp: "2026090100", views: 90 }] }); };
  const a = await wikipedia.article("web hosting", "DE", { fetch: f });
  assert.deepEqual(a, { title: "Web hosting service", lang: "de", url: "https://de.wikipedia.org/wiki/Web_hosting_service" });
  assert.match(calls[0].u, /^https:\/\/de\.wikipedia\.org\/w\/api\.php\?.*srsearch=web\+hosting/);
  assert.match(calls[0].init.headers["User-Agent"], /seo-autopilot/);
  const pv = await wikipedia.pageviews("Web hosting service", "en", { fetch: f, today: new Date("2026-10-23T00:00:00Z") });
  assert.equal(calls[1].u, "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Web_hosting_service/monthly/2025100100/2026090100");
  assert.deepEqual(pv, [{ month: "2025-10", views: 120 }, { month: "2026-09", views: 90 }]);
  assert.equal(await wikipedia.article("zzz", "GB", { fetch: async () => res({ query: { search: [] } }) }), null);
  assert.equal(wikiLang("UK"), "en");
});

test("stackexchange: questions with decoded titles; a key is optional; API errors are named", async () => {
  let url;
  const f = async (u) => { url = String(u); return res({ items: [{ title: "How do I move my site to a new host &amp; keep rankings?", link: "https://webmasters.stackexchange.com/q/1", view_count: 5400, score: 12, answer_count: 3, is_answered: true, creation_date: 1700000000 }], quota_remaining: 290 }); };
  const q = await stackexchange.questions("web hosting", "webmasters", { fetch: f, env: {} });
  assert.deepEqual(q[0], { title: "How do I move my site to a new host & keep rankings?", url: "https://webmasters.stackexchange.com/q/1", site: "webmasters", views: 5400, score: 12, answers: 3, answered: true, created: "2023-11-14" });
  assert.match(url, /search\/advanced\?.*q=web\+hosting.*site=webmasters/); assert.doesNotMatch(url, /key=/);
  await stackexchange.questions("x", "webmasters", { fetch: f, env: { STACKEXCHANGE_KEY: "k1" } }); assert.match(url, /key=k1/);
  await assert.rejects(stackexchange.questions("x", "nosuch", { fetch: async () => res({ error_id: 400, error_name: "bad_parameter" }), env: {} }), /stackexchange: bad_parameter/);
  assert.equal(decode("It&#39;s &lt;b&gt; &#x41;"), "It's <b> A");
});

test("interest: average, last 3 months against the 3 before, peak; too little data is null", () => {
  const i = interest(views([100, 100, 100, 100, 100, 100, 100, 100, 100, 150, 150, 150]));
  assert.deepEqual([i.average, i.recent, i.change, i.peak], [113, 150, 50, "2026-10"]);
  assert.equal(interest(views([1, 2, 3])), null); assert.equal(interest(views([0, 0, 0, 0, 0, 0])), null);
});

test("community questions: most viewed first, duplicates dropped, covered when a page title holds most of the words", () => {
  const items = [{ title: "How to choose web hosting", url: "u1", views: 10, answers: 1 }, { title: "Is shared hosting safe for email", url: "u2", views: 900, answers: 0 }, { title: "How to choose web hosting", url: "u1", views: 10, answers: 1 }];
  const out = communityQuestions(items, [{ url: "https://s.test/choose", title: "Choosing web hosting: a guide" }]);
  assert.deepEqual(out.map((q) => [q.url, q.covered]), [["u2", null], ["u1", "https://s.test/choose"]]);
  const md = openDataMarkdown({ topics: [{ seed: "web hosting", article: { title: "Web hosting service", url: "https://en.wikipedia.org/wiki/Web_hosting_service" }, interest: { average: 113, change: 50, peak: "2026-10" } }], community: out });
  assert.match(md, /\| web hosting \| \[Web hosting service\].* \| 113 \| \+50% \| 2026-10 \|/); assert.match(md, /no page covers it/);
  assert.equal(openDataMarkdown({}), "");
});

test("config: research.stackExchangeSites must be a list of strings", () => {
  const base = (r) => ({ sites: [{ id: "s", name: "S", url: "https://s.test/", research: r }] });
  assert.ok(validate(base({ stackExchangeSites: "webmasters" })).some((e) => /stackExchangeSites must be a list/.test(e)));
  assert.ok(!validate(base({ stackExchangeSites: ["webmasters"] })).some((e) => /stackExchangeSites/.test(e)));
});

test("keywords job: topic interest and community questions join the report; --no-open-data skips both", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-open-")), state = join(root, "state"); mkdirSync(state);
  const site = { id: "s", name: "S", url: "https://s.test/", research: { stackExchangeSites: ["webmasters"] }, paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/keywords.mjs");
  const months = Array.from({ length: 12 }, (_, i) => ({ timestamp: `2025${String(i + 1).padStart(2, "0")}0100`, views: 100 + i }));
  const hits = [];
  const f = async (u) => {
    u = String(u); hits.push(u);
    if (u.includes("w/api.php")) return res({ query: { search: [{ title: "Web hosting service" }] } });
    if (u.includes("wikimedia.org")) return res({ items: months });
    if (u.includes("stackexchange")) return res({ items: [{ title: "Cheapest web hosting for a small charity?", link: "https://webmasters.stackexchange.com/q/9", view_count: 300, answer_count: 2 }] });
    return res({}, 404);
  };
  const log = console.log; console.log = () => {};
  try {
    await run({ site, flags: {}, positional: ["web hosting"] }, { env: {}, fetch: f, delayMs: 0, today: new Date("2026-01-15T00:00:00Z") });
    const r = JSON.parse(readFileSync(join(state, "keywords.json"), "utf8"));
    assert.equal(r.topics[0].article.title, "Web hosting service"); assert.equal(r.topics[0].interest.average, 106);
    assert.equal(r.community[0].url, "https://webmasters.stackexchange.com/q/9");
    assert.match(readFileSync(join(state, "keywords.md"), "utf8"), /Topic interest \(Wikipedia pageviews\)[\s\S]*Questions people ask in communities/);
    hits.length = 0;
    await run({ site, flags: { "no-open-data": true }, positional: ["web hosting"] }, { env: {}, fetch: f, delayMs: 0 });
    assert.ok(!hits.some((u) => /wikipedia|wikimedia|stackexchange/.test(u)));
  } finally { console.log = log; }
});
