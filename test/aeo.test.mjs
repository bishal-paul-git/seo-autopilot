// AEO tracking: config validation, Arabic/English alias matching, the DataForSEO engine (three modes, injected fetch, through the
// cost guard), per-run cap and the job. No network: every request goes to a stand-in fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAeo, resolveAeo, AeoError } from "../src/lib/aeo-config.mjs";
import { validate } from "../src/core/config.mjs";
import { mentionedNames, analyseAeo, aeoMarkdown } from "../src/analysis/aeo.mjs";
import { dataforseo, enabledEngines, ENGINES } from "../src/lib/ai-engines.mjs";
import { BudgetError } from "../src/lib/dataforseo.mjs";
import { resolveMarket, MarketError } from "../src/lib/market.mjs";
import { collect, run } from "../src/jobs/aeo.mjs";
import { testGuard, DFS_ENV } from "./dfs-fixtures.mjs";

const MARKET_RAW = { location_code: 2682, language_code: "ar", languages: ["ar", "en"] };
const market = resolveMarket(MARKET_RAW, "t");
const goodAeo = () => ({ prompts: [{ text: "أفضل تطبيقات المتجر لزيادة المبيعات", lang: "ar" }, { text: "best apps for an online store", lang: "en" }], aliases: ["مَنَار", "منار", "Acme Shop"], mode: "ai_overview" });

test("validateAeo: a good block passes; unknown mode, schedule, key, bad cost and an unsupported language are each named", () => {
  assert.deepEqual(validateAeo(goodAeo(), "aeo", MARKET_RAW), []);
  const bad = validateAeo({ ...goodAeo(), mode: "chat", schedule: "hourly", maxCostPerRunUsd: 0, extra: 1, prompts: [{ text: "x", lang: "fr" }, { text: "" }, 5] }, "aeo", MARKET_RAW).join("\n");
  assert.match(bad, /mode "chat" is not a mode/);
  assert.match(bad, /schedule "hourly" is not a schedule/);
  assert.match(bad, /maxCostPerRunUsd must be a number of US dollars above 0/);
  assert.match(bad, /unknown key "extra"/);
  assert.match(bad, /prompts\[0\]\.lang: .*"fr" is not one of this site's languages/);
  assert.match(bad, /prompts\[1\]\.text must be the question/);
  assert.match(bad, /prompts\[2\] must be text or/);
  assert.match(validateAeo({ aliases: ["xx"] }, "aeo").join(), /prompts must be a non-empty list/);
  assert.match(validateAeo({ prompts: ["q"], aliases: ["a"] }, "aeo").join(), /aliases must be a list of names/);
  assert.match(validateAeo({ prompts: [{ text: "x".repeat(501) }] }, "aeo").join(), /501 characters/);
});

test("config validate: aeo is checked with the site's market, and dataforseo may be named in research.engines", () => {
  const site = { id: "s", url: "https://s.test/", searchConsoleProperty: "https://s.test/", sitemap: "https://s.test/sitemap.xml", market: MARKET_RAW, aeo: { ...goodAeo(), mode: "nope" } };
  assert.match(validate({ sites: [site] }).join("\n"), /sites\[0\]\.aeo\.mode "nope"/);
  assert.deepEqual(validate({ sites: [{ ...site, aeo: goodAeo(), research: { engines: ["dataforseo"] } }] }), []);
});

test("resolveAeo: defaults (ai_mode, weekly), the market's main language for plain prompts, no market is an error", () => {
  const site = { id: "s", market: MARKET_RAW, aeo: { prompts: ["سؤال", { text: "a question", lang: "en" }], aliases: ["A", "Brand"].map((x) => x + "x") } };
  const a = resolveAeo(site);
  assert.deepEqual([a.mode, a.schedule, a.maxCostPerRunUsd], ["ai_mode", "weekly", 1]);
  assert.deepEqual(a.prompts, [{ text: "سؤال", lang: "ar" }, { text: "a question", lang: "en" }]);
  assert.equal(resolveAeo({ id: "s" }), null);
  assert.throws(() => resolveAeo({ id: "s", aeo: { prompts: ["q"] } }), MarketError);
  assert.throws(() => resolveAeo({ id: "s", market: MARKET_RAW, aeo: { prompts: ["q"], mode: "x" } }), AeoError);
});

test("mentionedNames: Arabic with and without diacritics, attached prefixes, whole words only; English and the domain", () => {
  const names = ["مَنَار", "منار", "acme shop", "acme.test"];
  assert.deepEqual(mentionedNames("يقدم موقع منار شرحا", names).length, 1);
  assert.ok(mentionedNames("مَنَار مدونة عربية", ["منار"]).length, "diacritics in the answer");
  assert.ok(mentionedNames("مدونة منار", ["مَنَار"]).length, "diacritics in the alias");
  assert.ok(mentionedNames("ينصح موقع ومنار بذلك", ["منار"]).length, "attached و");
  assert.ok(mentionedNames("اقرأ في بمنار", ["منار"]).length, "attached ب");
  assert.deepEqual(mentionedNames("منارات كثيرة", ["منار"]), [], "not inside a longer word");
  assert.deepEqual(mentionedNames("مدونة نعمى", ["منار"]), [], "the misspelling is a different word");
  assert.deepEqual(mentionedNames("See Acme  Shop and ACME.TEST today", names).sort(), ["acme shop", "acme.test"].sort());
  assert.deepEqual(mentionedNames("Acmeworks", ["Acme"]), []);
});

test("analyseAeo: answered, mentioned, cited, citation rank, rivals, per language, errors and skips kept apart", () => {
  const c = (d, p = "") => ({ url: `https://${d}/${p}`, domain: d });
  const r = analyseAeo([
    { q: "q1", lang: "ar", mode: "ai_overview", text: "نصيحة من موقع منار", citations: [c("rival.test"), c("www.acme.test", "a")], costUsd: 0.0055 },
    { q: "q2", lang: "ar", mode: "ai_overview", text: "", citations: [], costUsd: 0.0035 },
    { q: "q3", lang: "en", mode: "ai_overview", text: "Other answer", citations: [c("rival.test")], costUsd: 0.0055 },
    { q: "q4", lang: "en", mode: "ai_overview", error: "dataforseo: task status 40101", costUsd: 0 },
    { q: "q5", lang: "en", mode: "ai_overview", skipped: "cap" },
  ], { domain: "acme.test", names: ["منار"] });
  assert.deepEqual([r.totals.prompts, r.totals.asked, r.totals.answered, r.totals.mentioned, r.totals.cited, r.totals.errors, r.totals.skipped], [5, 3, 2, 1, 1, 1, 1]);
  assert.equal(r.rows[0].citationRank, 2);
  assert.deepEqual(r.rows[0].citedInstead, ["rival.test"]);
  assert.equal(r.rows[1].status, "no-answer");
  assert.deepEqual([r.byLang.ar.answered, r.byLang.en.answered], [1, 1]);
  assert.equal(r.totals.costUsd, 0.0145);
  assert.equal(r.topCited[0].domain, "rival.test");
  assert.match(aeoMarkdown(r, { mode: "ai_overview", siteName: "Acme", capUsd: 0.6, market: "Saudi Arabia (2682), ar" }), /Measured cost of this run: \$0\.0145/);
});

// --- the engine, through a real cost guard with a stand-in fetch ------------------------------------------------------------
const ok = (result, cost = 0.0055) => ({ ok: true, status: 200, json: async () => ({ status_code: 20000, cost, tasks: [{ status_code: 20000, cost, result: [result] }] }) });
const bad = (code, cost = 0) => ({ ok: true, status: 200, json: async () => ({ status_code: 20000, cost, tasks: [{ status_code: code, status_message: "Internal SE Server Error", cost, result: null }] }) });
const AI = { type: "ai_overview", markdown: "يوصى بتطبيقات مثل منار", references: [
  { type: "ai_overview_reference", domain: "apps.store.test", url: "https://apps.store.test/x", title: "Store app" },
  { type: "ai_overview_reference", domain: "google.com", url: "https://google.com/goto?url=ABCDEF", title: "no way to resolve" },
  { type: "ai_overview_reference", domain: "google.com", url: "https://google.com/goto?url=GHI", source: "acme.test", title: "resolved from the shown host" },
] };

function stub(responder) {
  const calls = [];
  const f = async (url, init) => { const body = JSON.parse(init.body)[0]; calls.push({ path: new URL(url).pathname.replace("/v3/", ""), body }); return responder(calls.length, body); };
  return { f, calls };
}

test("engine ai_overview: SERP request with the async AI Overview, market from the site, redirect rows resolved or counted unresolved", async () => {
  const { f, calls } = stub(() => ok({ items: [{ type: "organic", domain: "x.test", url: "https://x.test/" }, AI] }));
  const r = await dataforseo.ask("أفضل تطبيقات المتجر", { guard: testGuard({ fetch: f }), market, lang: "ar" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "serp/google/organic/live/advanced");
  assert.deepEqual(calls[0].body, { keyword: "أفضل تطبيقات المتجر", location_code: 2682, language_code: "ar", depth: 10, load_async_ai_overview: true });
  assert.deepEqual(r.citations.map((c) => c.domain), ["apps.store.test", "acme.test"]);
  assert.equal(r.unresolved, 1);
  assert.ok(!r.citations.some((c) => /google/.test(c.domain)), "google.com is never a cited domain");
  assert.deepEqual([r.engine, r.mode, r.present, r.costUsd], ["dataforseo", "ai_overview", true, 0.0055]);
  assert.match(r.text, /منار/);
});

test("engine ai_mode and llm_responses: their own endpoints, bodies and answer shapes", async () => {
  const mode = stub(() => ok({ items: [{ ...AI, type: "ai_overview" }] }, 0.012));
  const m = await dataforseo.ask("q", { guard: testGuard({ fetch: mode.f }), market, mode: "ai_mode", lang: "en" });
  assert.equal(mode.calls[0].path, "serp/google/ai_mode/live/advanced");
  assert.deepEqual(mode.calls[0].body, { keyword: "q", location_code: 2682, language_code: "en" });
  assert.equal(m.costUsd, 0.012);

  const llm = stub(() => ok({ model_name: "gpt-4.1-mini-2025-04-14", items: [{ type: "message", sections: [{ type: "text", text: "Use Acme Shop.", annotations: [{ title: "acme.test", url: "https://www.acme.test/a?utm_source=chatgpt.com" }, { title: "x", url: "https://other.test/" }] }] }] }, 0.03));
  const l = await dataforseo.ask("وش أفضل تطبيق؟", { guard: testGuard({ fetch: llm.f }), market, mode: "llm_responses", env: {} });
  assert.equal(llm.calls[0].path, "ai_optimization/chat_gpt/llm_responses/live");
  assert.deepEqual(llm.calls[0].body, { user_prompt: "وش أفضل تطبيق؟", model_name: "gpt-4.1-mini", web_search: true, web_search_country_iso_code: "SA", max_output_tokens: 1024 });
  assert.deepEqual(l.citations.map((c) => c.domain), ["acme.test", "other.test"]);
  assert.equal(l.model, "gpt-4.1-mini-2025-04-14");
  assert.equal(l.text, "Use Acme Shop.");
});

test("engine: one retry on task 40101 and its costs add up; a second failure throws; other task errors are not retried", async () => {
  let n = 0;
  const once = stub(() => (++n === 1 ? bad(40101, 0.001) : ok({ items: [AI] })));
  const r = await dataforseo.ask("q", { guard: testGuard({ fetch: once.f }), market, lang: "ar" });
  assert.equal(once.calls.length, 2);
  assert.equal(r.costUsd, 0.0065);
  const twice = stub(() => bad(40101));
  await assert.rejects(dataforseo.ask("q", { guard: testGuard({ fetch: twice.f }), market, lang: "ar" }), /task status 40101/);
  assert.equal(twice.calls.length, 2);
  const denied = stub(() => bad(40204));
  await assert.rejects(dataforseo.ask("q", { guard: testGuard({ fetch: denied.f }), market, lang: "ar" }), /task status 40204/);
  assert.equal(denied.calls.length, 1);
});

test("engine: no guard, no market, unknown mode or a language outside the market all fail before any request", async () => {
  const { f, calls } = stub(() => ok({ items: [] }));
  const guard = testGuard({ fetch: f });
  await assert.rejects(dataforseo.ask("q", { market }), (e) => e instanceof BudgetError && e.reason === "no-guard");
  await assert.rejects(dataforseo.ask("q", { guard }), MarketError);
  await assert.rejects(dataforseo.ask("q", { guard, market, mode: "voice" }), /unknown mode "voice"/);
  await assert.rejects(dataforseo.ask("q", { guard, market, lang: "fr" }), MarketError);
  assert.equal(calls.length, 0);
});

test("engine: a page with no AI block is an answer with present=false, not an error", async () => {
  const { f } = stub(() => ok({ items: [{ type: "organic", domain: "x.test", url: "https://x.test/" }] }, 0.0035));
  const r = await dataforseo.ask("q", { guard: testGuard({ fetch: f }), market, lang: "ar" });
  assert.deepEqual([r.present, r.text, r.citations, r.costUsd], [false, "", [], 0.0035]);
});

test("dataforseo is opt-in: credentials alone never start it, naming it does", () => {
  assert.ok(ENGINES.includes(dataforseo));
  assert.ok(!enabledEngines(DFS_ENV).includes(dataforseo));
  assert.ok(!enabledEngines(DFS_ENV, ["openai"]).includes(dataforseo));
  assert.ok(enabledEngines(DFS_ENV, ["dataforseo"]).includes(dataforseo));
  assert.ok(!enabledEngines({}, ["dataforseo"]).includes(dataforseo), "and it still needs credentials");
});

// --- collect and the job ------------------------------------------------------------------------------------------------------
test("collect: stops at the per-run cap with the rest skipped and a reason; the guard refusing also stops the run", async () => {
  const prompts = Array.from({ length: 6 }, (_, i) => ({ text: `q${i}`, lang: "ar" }));
  const { f, calls } = stub(() => ok({ items: [AI] }, 0.0055));
  const r = await collect({ prompts, mode: "ai_overview", market, guard: testGuard({ fetch: f }), maxCostUsd: 0.025, delayMs: 0 });
  // the first call is checked against the floor estimate 0.01, later ones against 1.5 x the dearest call so far (0.00825)
  assert.equal(r.answers.filter((a) => !a.skipped).length, calls.length);
  assert.ok(r.spentUsd <= 0.025);
  assert.match(r.stoppedBy, /per-run cap/);
  assert.ok(r.answers.at(-1).skipped);
  const refused = await collect({ prompts, mode: "ai_overview", market, guard: testGuard({ fetch: f, cfg: { monthlyCapUsd: 0.001 } }), maxCostUsd: 5, delayMs: 0 });
  assert.match(refused.stoppedBy, /cost guard refused \(monthly-cap\)/);
  assert.equal(refused.answers.length, 6);
  assert.ok(refused.answers.every((a) => a.skipped));
});

function project() {
  const dir = mkdtempSync(join(tmpdir(), "seo-aeo-"));
  const site = { id: "acme", name: "Acme Shop", url: "https://www.acme.test/", market: MARKET_RAW, aeo: { ...goodAeo(), schedule: "weekly" }, brandTerms: [], paths: { root: dir, state: join(dir, "state"), data: join(dir, "data") } };
  return site;
}

test("job aeo: asks every prompt through one guard, finds an Arabic alias and the domain, writes aeo.json and aeo.md with the measured cost", async () => {
  const site = project();
  const { f, calls } = stub((n) => ok({ items: [n === 1 ? { ...AI, markdown: "ينصح موقع منار بذلك", references: [{ domain: "acme.test", url: "https://www.acme.test/p" }] } : { ...AI, markdown: "no brand here", references: [{ domain: "rival.test", url: "https://rival.test/" }] }] }));
  const guard = testGuard({ fetch: f, job: "aeo" });
  const log = console.log; const out = []; console.log = (...a) => out.push(a.join(" "));
  try { await run({ site, flags: {} }, { env: DFS_ENV, guard, delayMs: 0, today: "2026-11-26" }); } finally { console.log = log; }
  assert.equal(calls.length, 2);
  const j = JSON.parse(readFileSync(join(site.paths.state, "aeo.json"), "utf8"));
  assert.deepEqual([j.totals.asked, j.totals.mentioned, j.totals.cited, j.totals.costUsd], [2, 1, 1, 0.011]);
  assert.deepEqual(j.history, [{ date: "2026-11-26", mode: "ai_overview", limited: false, asked: 2, answered: 2, mentioned: 1, cited: 1, costUsd: 0.011 }]);
  assert.match(readFileSync(join(site.paths.state, "aeo.md"), "utf8"), /Measured cost of this run: \$0\.011/);
  assert.match(out.join("\n"), /AI answer tracking: Acme Shop/);
  // a second run inside the week does nothing and sends no request
  const before = calls.length;
  console.log = (...a) => out.push(a.join(" "));
  try { await run({ site, flags: {} }, { env: DFS_ENV, guard, delayMs: 0, today: "2026-11-28" }); } finally { console.log = log; }
  assert.equal(calls.length, before);
  assert.match(out.at(-1), /schedule is weekly; the last run was 2026-11-26/);
  // --force and --limit/--mode run again
  console.log = () => {};
  try { await run({ site, flags: { force: true, limit: 1, mode: "ai_mode" } }, { env: DFS_ENV, guard, delayMs: 0, today: "2026-11-28" }); } finally { console.log = log; }
  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1).path, "serp/google/ai_mode/live/advanced");
});

test("job aeo: no aeo block, no credentials, or a bad mode never reaches the network", async () => {
  const site = project();
  const { f, calls } = stub(() => ok({ items: [] }));
  const log = console.log; const out = []; console.log = (...a) => out.push(a.join(" "));
  try {
    await run({ site: { ...site, aeo: undefined }, flags: {} }, { env: DFS_ENV, fetch: f });
    await run({ site, flags: {} }, { env: {}, fetch: f });
    await assert.rejects(run({ site, flags: { mode: "voice" } }, { env: DFS_ENV, fetch: f }), /unknown mode "voice"/);
    await assert.rejects(run({ site: { ...site, market: undefined }, flags: {} }, { env: DFS_ENV, fetch: f }), MarketError);
  } finally { console.log = log; }
  assert.equal(calls.length, 0);
  assert.ok(!existsSync(join(site.paths.state, "aeo.json")));
  assert.match(out[0], /no "aeo" block/);
  assert.match(out[1], /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are not set/);
});
