// The AEO engine (dataforseo.ask) against REAL DataForSEO responses (recorded 2026-11-28, generic queries, redacted), not
// hand-written stand-ins: AI Overview (US/en), AI Mode (SA/ar) and LLM responses (SA/ar). The paid POST is served with the recorded
// body; the guard is the real one (in-memory ledger), so the cost it records is the cost the API reported.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCostGuard, memoryLedger } from "../src/lib/dataforseo.mjs";
import { resolveMarket } from "../src/lib/market.mjs";
import { dataforseo } from "../src/lib/ai-engines.mjs";
import { DFS_ENV } from "./dfs-fixtures.mjs";

const dir = new URL("./fixtures/dataforseo/", import.meta.url);
const rec = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
const manifest = rec("manifest");
const NOW = () => new Date("2026-11-28T10:00:00Z");
const US = resolveMarket({ location_code: 2840, language_code: "en" }, "t");
const SA = resolveMarket({ location_code: 2682, language_code: "ar", languages: ["ar", "en"] }, "t");

function ask(name, { market, mode, lang }) {
  const body = rec(name);
  const posts = [];
  const fetch = async (url, init = {}) => {
    const ok = (b) => ({ ok: true, status: 200, json: async () => b });
    if (String(url).endsWith("/appendix/user_data")) return ok({ tasks: [{ status_code: 20000, result: [{ money: { balance: 50 } }] }] });
    posts.push({ url: String(url), body: JSON.parse(init.body) });
    return ok(body);
  };
  const ledger = memoryLedger();
  const guard = createCostGuard({ cfg: { monthlyCapUsd: 1, minBalanceUsd: 5 }, job: "recorded", env: DFS_ENV, fetch, ledger, notify: async () => ({ sent: false }), now: NOW });
  return dataforseo.ask("q", { guard, market, mode, lang, env: {} }).then((r) => ({ r, posts, ledger }));
}
const cost = (name) => manifest.calls.find((c) => c.name === name).costUsd;

test("AI Overview, US/en: the recorded block is present, has text, resolves real citations and records the real cost", async () => {
  const { r, posts, ledger } = await ask("ai-overview-us-en", { market: US, mode: "ai_overview" });
  assert.equal(r.present, true);
  assert.ok(r.text.length > 1000, `text ${r.text.length} chars`);
  assert.ok(r.citations.length >= 3, `${r.citations.length} citations`);
  for (const c of r.citations) assert.ok(c.domain && !/^(www\.)?google\.com$/.test(c.domain) && /^https?:\/\//.test(c.url), JSON.stringify(c));
  assert.ok(r.unresolved > 0, "the real block has Google redirect and product rows that cannot be resolved to a site");
  assert.equal(r.costUsd, cost("ai-overview-us-en"));
  assert.ok(Math.abs(ledger.load().months["2026-11"].usd - r.costUsd) < 1e-9);
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /serp\/google\/organic\/live\/advanced$/);
  assert.equal(posts[0].body[0].location_code, 2840);
  assert.equal(posts[0].body[0].language_code, "en");
  assert.equal(posts[0].body[0].load_async_ai_overview, true);
});

test("AI Mode, SA/ar: the answer comes back as an ai_overview-typed item with Arabic text and citations", async () => {
  const { r, posts } = await ask("ai-mode-sa-ar", { market: SA, mode: "ai_mode", lang: "ar" });
  assert.equal(r.present, true);
  assert.equal(r.model, "ai_mode");
  assert.match(r.text, /[؀-ۿ]/, "Arabic text");
  assert.ok(r.citations.length >= 1);
  assert.equal(r.costUsd, cost("ai-mode-sa-ar"));
  assert.match(posts[0].url, /serp\/google\/ai_mode\/live\/advanced$/);
  assert.equal(posts[0].body[0].location_code, 2682);
  assert.equal(posts[0].body[0].language_code, "ar");
});

test("LLM responses, SA/ar: the message item's sections give the text and the annotations give the citations; the real cost is recorded", async () => {
  const { r, posts, ledger } = await ask("llm-responses-sa-ar", { market: SA, mode: "llm_responses", lang: "ar" });
  assert.equal(r.present, true);
  assert.match(r.text, /[؀-ۿ]/, "Arabic text");
  assert.ok(r.citations.length >= 3, `${r.citations.length} citations`);
  assert.equal(r.unresolved, 0);
  assert.ok(r.model && r.model !== "llm_responses");
  assert.equal(r.costUsd, cost("llm-responses-sa-ar"));
  assert.ok(r.costUsd > 0.03 && r.costUsd < 0.05, "web search on: about 3 cents, under the 0.05 estimate");
  assert.ok(Math.abs(ledger.load().months["2026-11"].usd - r.costUsd) < 1e-9);
  assert.equal(posts[0].body[0].web_search, true);
  assert.equal(posts[0].body[0].web_search_country_iso_code, "SA");
});
