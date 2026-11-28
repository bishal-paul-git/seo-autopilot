// The market code against REAL DataForSEO responses (recorded 2026-11-28, generic queries, redacted), not hand-written stand-ins:
// the requests carry the site's location and language, and the real Arabic and English rows parse into usable keyword rows.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataforseo } from "../src/lib/research-sources.mjs";
import { resolveMarket } from "../src/lib/market.mjs";

const rec = (name) => readFileSync(new URL(`./fixtures/dataforseo/${name}.json`, import.meta.url), "utf8");
const env = { DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p" };
const stub = (body) => { const sent = []; return { sent, fetch: async (url, init) => { sent.push({ url: String(url), task: JSON.parse(init.body)[0] }); return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }); } }; };
const SA = resolveMarket({ location_code: 2682, language_code: "ar", languages: ["ar", "en"] }, "market");
const US = resolveMarket({ location_code: 2840, language_code: "en" }, "market");

test("recorded keyword ideas (Saudi Arabia, Arabic): the request carries 2682/ar and the real rows parse", async () => {
  const s = stub(rec("keyword-ideas-sa-ar"));
  const rows = await dataforseo.ideas(["أحذية رياضية"], SA, { fetch: s.fetch, env });
  assert.match(s.sent[0].url, /dataforseo_labs\/google\/keyword_ideas\/live$/);
  assert.deepEqual([s.sent[0].task.location_code, s.sent[0].task.language_code], [2682, "ar"]);
  assert.equal(rows.length, 10);
  assert.ok(rows.every((r) => /\p{Script=Arabic}/u.test(r.query)), "every real idea is Arabic text, kept as is");
  assert.ok(rows.every((r) => Number.isFinite(r.volume) && r.volume >= 0), "volumes are numbers");
  assert.ok(rows.some((r) => r.volume > 1000), "the real volumes are not zeroed");
  assert.ok(rows.every((r) => Array.isArray(r.trend)));
});

test("recorded keyword ideas (US, English): same parser, English rows", async () => {
  const s = stub(rec("keyword-ideas-us-en"));
  const rows = await dataforseo.ideas(["running shoes"], US, { fetch: s.fetch, env });
  assert.deepEqual([s.sent[0].task.location_code, s.sent[0].task.language_code], [2840, "en"]);
  assert.equal(rows.length, 10);
  assert.ok(rows.every((r) => /[a-z]/.test(r.query)));
  assert.ok(rows.some((r) => r.volume > 1000));
});

test("recorded ranked keywords (wikipedia.org, both markets): position, url and volume are read from the real shape", async () => {
  for (const [name, m, loc, lang] of [["ranked-keywords-sa-ar", SA, 2682, "ar"], ["ranked-keywords-us-en", US, 2840, "en"]]) {
    const s = stub(rec(name));
    const rows = await dataforseo.ranked("wikipedia.org", m, { fetch: s.fetch, env });
    assert.deepEqual([s.sent[0].task.target, s.sent[0].task.location_code, s.sent[0].task.language_code], ["wikipedia.org", loc, lang], name);
    assert.equal(rows.length, 10, name);
    assert.ok(rows.every((r) => r.query && Number.isInteger(r.position) && /^https?:\/\//.test(r.url)), `${name}: query, integer position and url on every row`);
    assert.ok(rows.every((r) => r.url.includes("wikipedia.org")), name);
  }
});
