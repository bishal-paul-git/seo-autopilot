// The market (location + language): parsing, validation, config, init, doctor, and that no provider call happens without one.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLocation, parseLanguage, resolveMarket, inLanguage, languageFor, siteMarket, withLocation, marketFromFlag, marketLabel, requireMarket, adsLanguageId, googleGl, MarketError, LANGUAGES, LOCATIONS } from "../src/lib/market.mjs";
import { validate, loadConfig } from "../src/core/config.mjs";
import { init } from "../src/cli/init.mjs";
import { marketReport } from "../src/cli/doctor.mjs";
import { SA_AR } from "./market-fixtures.mjs";
import { testGuard } from "./dfs-fixtures.mjs";

const SA = { location_code: 2682, language_code: "ar", languages: ["ar", "en"] };
const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const quiet = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

test("location: a DataForSEO code, a country name, an alias or a two-letter code all resolve; anything else throws and says how to fix it", () => {
  assert.deepEqual(parseLocation(2682), { code: 2682, country: "SA", name: "Saudi Arabia" });
  assert.deepEqual(parseLocation("2682"), { code: 2682, country: "SA", name: "Saudi Arabia" });
  assert.deepEqual(parseLocation("Saudi Arabia"), { code: 2682, country: "SA", name: "Saudi Arabia" });
  assert.equal(parseLocation("saudi arabia").code, 2682, "names are case-insensitive");
  assert.equal(parseLocation("SA").code, 2682); assert.equal(parseLocation("uk").code, 2826); assert.equal(parseLocation("UAE").code, 2784); assert.equal(parseLocation("USA").code, 2840);
  assert.deepEqual(parseLocation(1006886), { code: 1006886, country: null, name: null }, "a code outside the table (a city) passes through; the config must then name its country");
  for (const bad of ["Atlantis", "XX", "", "  ", null, undefined, 0, -5, 2.5, "26x2", {}, []]) assert.throws(() => parseLocation(bad, "market.location"), (e) => e instanceof MarketError && /market\.location/.test(e.message), `rejects ${JSON.stringify(bad)}`);
  assert.throws(() => parseLocation("Atlantis"), /unknown location "Atlantis".*"Saudi Arabia".*location_code/s);
  assert.equal(new Set(LOCATIONS.map((l) => l.code)).size, LOCATIONS.length, "no duplicate location codes in the table");
  assert.equal(new Set(LOCATIONS.map((l) => l.country)).size, LOCATIONS.length, "no duplicate countries in the table");
});

test("language: two-letter ISO codes from the supported list, lower-cased; names, region tags and unknown codes throw", () => {
  assert.equal(parseLanguage("ar"), "ar"); assert.equal(parseLanguage("EN"), "en"); assert.equal(parseLanguage(" de "), "de");
  for (const bad of ["english", "en-GB", "e", "", null, undefined, 5, "xx", "zh"]) assert.throws(() => parseLanguage(bad, "market.language_code"), (e) => e instanceof MarketError && /market\.language_code/.test(e.message), `rejects ${JSON.stringify(bad)}`);
  assert.throws(() => parseLanguage("xx"), /not supported\. Supported: en, /);
  assert.equal(LANGUAGES.ar[1], 1019); assert.equal(LANGUAGES.en[1], 1000);
});

test("resolveMarket: the Saudi example, the name form, languages-only, and every way to get it wrong", () => {
  assert.deepEqual(resolveMarket(SA), { locationCode: 2682, locationName: "Saudi Arabia", country: "SA", languageCode: "ar", languages: ["ar", "en"] });
  assert.deepEqual(resolveMarket({ location: "Saudi Arabia", languages: ["ar", "en"] }), resolveMarket(SA));
  assert.deepEqual(resolveMarket({ location_code: 2840, language_code: "en" }).languages, ["en"]);
  assert.deepEqual(resolveMarket({ location_code: 1006886, country: "sa", language_code: "ar" }), { locationCode: 1006886, locationName: "location 1006886", country: "SA", languageCode: "ar", languages: ["ar"] });
  assert.deepEqual(resolveMarket({ location_code: 2682, languages: ["ar", "AR", "en"] }).languages, ["ar", "en"], "duplicates collapse");
  const cases = [
    [undefined, /market: missing.*nothing is assumed.*"location_code": 2682/s],
    [null, /market: missing/], ["SA", /must be an object/], [["ar"], /must be an object/],
    [{ language_code: "ar" }, /market\.location: missing/],
    [{ location_code: 2682 }, /market\.language_code: missing/],
    [{ location_code: 2682, location: "Saudi Arabia", language_code: "ar" }, /either location_code or location, not both/],
    [{ location: "Atlantis", language_code: "ar" }, /unknown location "Atlantis"/],
    [{ location_code: "abc", language_code: "ar" }, /market\.location_code: unknown location "abc"/],
    [{ location_code: 0, language_code: "ar" }, /not a valid location code/],
    [{ location_code: 1006886, language_code: "ar" }, /not in the built-in table.*"country": "SA"/],
    [{ location_code: 2682, country: "AE", language_code: "ar" }, /disagrees with location 2682/],
    [{ location_code: 2682, country: "Saudi", language_code: "ar" }, /two-letter country code/],
    [{ location_code: 2682, language_code: "english" }, /not a two-letter language code/],
    [{ location_code: 2682, language_code: "xx" }, /language "xx" is not supported/],
    [{ location_code: 2682, languages: [] }, /non-empty list/], [{ location_code: 2682, languages: "ar" }, /non-empty list/],
    [{ location_code: 2682, languages: ["ar", "xx"] }, /languages\[1\].*not supported/],
    [{ location_code: 2682, language_code: "en", languages: ["ar", "en"] }, /language_code "en" is not the first of languages/],
    [{ location_code: 2682, language_code: "ar", currency: "SAR" }, /unknown key "currency"/],
  ];
  for (const [raw, re] of cases) assert.throws(() => resolveMarket(raw, "site"), (e) => e instanceof MarketError && re.test(e.message), JSON.stringify(raw));
});

test("languages of a multi-language site: the first is primary; another one must be listed; text in a listed language is researched in it", () => {
  assert.equal(SA_AR.languageCode, "ar");
  assert.equal(inLanguage(SA_AR, "en").languageCode, "en"); assert.equal(inLanguage(SA_AR, undefined), SA_AR);
  assert.throws(() => inLanguage(SA_AR, "fr"), /"fr" is not one of this site's languages \["ar", "en"\]/);
  assert.equal(inLanguage(SA_AR, "en").locationCode, 2682, "the location does not change with the language");
  assert.equal(languageFor(SA_AR, "كيف أختار مزود خدمة").languageCode, "ar");
  assert.equal(languageFor(SA_AR, "how to choose a supplier for the shop").languageCode, "en");
  assert.equal(languageFor(SA_AR, "xyz").languageCode, "ar", "no clear signal: the primary language");
  assert.equal(languageFor(resolveMarket({ location_code: 2682, language_code: "ar" }), "how to choose a supplier for the shop").languageCode, "ar", "English is not one of this site's languages, so it is not used");
  assert.equal(languageFor(SA_AR, "كيف أختار", "en").languageCode, "en", "an explicit language wins over detection");
  assert.throws(() => languageFor(SA_AR, "x", "fr"), /not one of this site's languages/);
});

test("providers take a resolved market only: bare codes, nothing and half-made objects are refused", () => {
  assert.equal(requireMarket(SA_AR, "x"), SA_AR);
  for (const bad of [undefined, null, "GB", "SA", 2682, {}, { locationCode: 2682 }, { locationCode: "2682", country: "SA", languageCode: "ar" }]) assert.throws(() => requireMarket(bad, "dataforseo"), /dataforseo: no market given/);
  assert.equal(adsLanguageId(SA_AR), 1019); assert.equal(googleGl(SA_AR), "sa"); assert.equal(googleGl(resolveMarket({ location: "UK", language_code: "en" })), "uk");
  assert.equal(marketLabel(SA_AR), "Saudi Arabia (2682), ar");
  assert.equal(withLocation(SA_AR, "AE").locationCode, 2784); assert.equal(withLocation(SA_AR, "AE").languageCode, "ar");
  assert.throws(() => withLocation(SA_AR, 1006886), /not in the built-in table/);
});

test("siteMarket: a site with no market keeps the old United Kingdom / English behaviour, flagged and warned about; the old country keys still choose the country", () => {
  assert.equal(siteMarket({ id: "s", market: SA }).locationCode, 2682);
  assert.equal(siteMarket({ id: "s", market: SA }, "en").languageCode, "en");
  const warnings = [], warn = console.warn; console.warn = (...a) => warnings.push(a.join(" "));
  try {
    const none = siteMarket({ id: "shop" });
    assert.deepEqual([none.locationCode, none.country, none.languageCode, none.assumed], [2826, "GB", "en", true]);
    assert.match(marketLabel(none), /United Kingdom \(2826\), en \(assumed/);
    siteMarket({ id: "shop" });
    assert.equal(warnings.length, 1, "one warning per site and process");
    assert.match(warnings[0], /site "shop": no "market" in the config, so the United Kingdom and English are used, as before.*"location_code": 2682/s);
    const us = siteMarket({ id: "s2", research: { market: "us" } });
    assert.deepEqual([us.locationCode, us.languageCode, us.assumed], [2840, "en", true]);
    assert.equal(siteMarket({ id: "s3", citations: { market: "GB" } }).locationCode, 2826);
    assert.throws(() => siteMarket({ id: "s4", research: { market: "zz" } }), /research\.market: unknown location "zz"/);
    assert.equal(siteMarket({ id: "s", market: SA }).assumed, undefined, "an explicit market is never flagged");
  } finally { console.warn = warn; }
  assert.throws(() => siteMarket({ id: "bad", market: { location: "Atlantis", language_code: "en" } }), /site "bad"\.market\.location: unknown location "Atlantis"/);
});

test("init --market: 'location:language[,language]' becomes an explicit, validated config block; a bad one fails before anything is written", () => {
  assert.deepEqual(marketFromFlag("2682:ar,en"), { location_code: 2682, language_code: "ar", languages: ["ar", "en"] });
  assert.deepEqual(marketFromFlag("Saudi Arabia:ar"), { location_code: 2682, language_code: "ar" });
  assert.deepEqual(marketFromFlag("us:en"), { location_code: 2840, language_code: "en" });
  for (const bad of ["", "2682", "2682:", ":ar", "Atlantis:en", "2682:xx", "2682:ar,xx", "1006886:ar"]) assert.throws(() => marketFromFlag(bad), MarketError, JSON.stringify(bad));
});

const tmp = () => mkdtempSync(join(tmpdir(), "seo-market-"));
test("init: writes the market when given, and says plainly when it is not set (no market is written)", async () => {
  const d = tmp();
  await quiet(() => init({ cwd: d, flags: { url: "https://example.com/", market: "2682:ar,en", "no-workflows": true }, interactive: false }));
  const cfg = JSON.parse(readFileSync(join(d, "seo-autopilot.config.json"), "utf8"));
  assert.deepEqual(cfg.sites[0].market, SA);
  assert.deepEqual(validate(cfg), []);
  assert.deepEqual(siteMarket(loadConfig({ cwd: d }).sites[0]).languages, ["ar", "en"]);

  const e = tmp(), lines = [];
  const log = console.log; console.log = (...a) => lines.push(a.join(" "));
  try { await init({ cwd: e, flags: { url: "https://example.com/", "no-workflows": true }, interactive: false }); } finally { console.log = log; }
  assert.equal(JSON.parse(readFileSync(join(e, "seo-autopilot.config.json"), "utf8")).sites[0].market, undefined, "no market is written");
  assert.match(lines.join("\n"), /no market is set.*United Kingdom in English, as before.*"location_code": 2682.*--market 2682:ar,en/s);

  await assert.rejects(() => quiet(() => init({ cwd: tmp(), flags: { url: "https://example.com/", market: "Atlantis:en", "no-workflows": true }, interactive: false })), /unknown location "Atlantis"/);
  await assert.rejects(() => quiet(() => init({ cwd: tmp(), flags: { url: "https://example.com/", market: true, "no-workflows": true }, interactive: false })), /--market needs a value/);
});

test("config: a present market is checked when the config loads; a missing one is not an error until a research job needs it", () => {
  const base = { id: "s", url: "https://s.test/", searchConsoleProperty: "sc-domain:s.test", sitemap: "https://s.test/sitemap.xml" };
  assert.deepEqual(validate({ sites: [base] }), [], "audit-only users are not broken");
  assert.deepEqual(validate({ sites: [{ ...base, market: SA }] }), []);
  const errs = validate({ sites: [{ ...base, market: { location: "Atlantis", language_code: "en" } }, { ...base, id: "t", market: { location_code: 2682 } }] });
  assert.equal(errs.length, 2); assert.match(errs[0], /^sites\[0\]\.market\.location: unknown location "Atlantis"/); assert.match(errs[1], /^sites\[1\]\.market\.language_code: missing/);
});

test("doctor: reports the market, warns (and names paid keys) when it is missing, fails when it is wrong", () => {
  assert.deepEqual(marketReport({ id: "s", market: SA }, {}), [["ok", "market: Saudi Arabia (2682), ar; languages ar, en"]]);
  const missing = marketReport({ id: "s" }, {});
  assert.equal(missing.length, 1); assert.equal(missing[0][0], "warn"); assert.match(missing[0][1], /no "market" in the config: United Kingdom and English are assumed, as before\. Set "market"/);
  const paid = marketReport({ id: "s" }, { DATAFORSEO_LOGIN: "l" });
  assert.equal(paid[0][0], "warn"); assert.match(paid[0][1], /DATAFORSEO_LOGIN spend in that market/);
  assert.match(marketReport({ id: "s", research: { market: "US" } }, {})[0][1], /United States and English are assumed/);
  assert.equal(marketReport({ id: "s", market: { location: "Atlantis", language_code: "en" } }, {})[0][0], "bad");
  const odd = marketReport({ id: "s", market: SA, language: "fr-FR", research: { market: "US" } }, {});
  assert.deepEqual(odd.map((x) => x[0]), ["ok", "warn", "warn"]); assert.match(odd[1][1], /language "fr-FR" is not one of market\.languages/); assert.match(odd[2][1], /research\.market is ignored because "market" is set/);
});

// ---- the jobs: a missing or unknown market stops them before the first request ----
function tmpSite(extra = {}) {
  const root = tmp(), state = join(root, ".seo-autopilot", "s"), data = join(root, "seo-autopilot");
  mkdirSync(state, { recursive: true }); mkdirSync(data, { recursive: true });
  return { root, state, data, site: { id: "s", name: "S", url: "https://s.test/", sitemap: "https://s.test/sitemap.xml", paths: { root, state, data }, limits: {}, ...extra } };
}
const guard = () => { const calls = []; return { calls, fetch: async (u) => { calls.push(String(u)); return res({}, 500); } }; };

test("keywords: with a key or seeds that would call a provider, no market keeps the old UK / English behaviour with a warning; an unknown one stops it before any request", async () => {
  const { run } = await import("../src/jobs/keywords.mjs");
  const { site, state } = tmpSite();
  writeFileSync(join(state, "gsc-rows.json"), JSON.stringify({ rows: [{ query: "web hosting", page: "https://s.test/h", impressions: 400, clicks: 4, position: 11 }] }));
  const g = guard();
  const warn = console.warn; console.warn = () => {};
  const sentTo = [];
  try {
    const f = async (u, init) => { if (init?.body) { const t = JSON.parse(init.body)[0]; sentTo.push([t.location_code, t.language_code]); } return res({}, 500); };
    const env = { DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p" };
    await quiet(() => run({ site, flags: {}, positional: ["hosting"] }, { env, fetch: f, delayMs: 0, guard: testGuard({ fetch: f, env }) }));
  } finally { console.warn = warn; }
  assert.deepEqual(sentTo, [[2826, "en"]], "no market: the old United Kingdom / English request, as before");
  await assert.rejects(() => quiet(() => run({ site: { ...site, market: { location: "Atlantis", language_code: "en" } }, flags: {}, positional: ["hosting"] }, { env: { BRAVE_API_KEY: "k" }, fetch: g.fetch, delayMs: 0 })), /unknown location "Atlantis"/);
  assert.deepEqual(g.calls, [], "no request was made");
  await quiet(() => run({ site, flags: {}, positional: [] }, { env: {}, fetch: g.fetch, delayMs: 0 }));
  await quiet(() => run({ site, flags: { "no-open-data": true }, positional: ["hosting"] }, { env: {}, fetch: g.fetch, delayMs: 0 }));
  assert.deepEqual(g.calls, [], "Search Console alone needs no market and makes no request");
  assert.equal(JSON.parse(readFileSync(join(state, "keywords.json"), "utf8")).market, null);
});

test("keywords: a Saudi site asks DataForSEO for Arabic ideas for Arabic seeds and English ideas for English seeds, in one request per language", async () => {
  const { run } = await import("../src/jobs/keywords.mjs");
  const { site, state } = tmpSite({ market: SA });
  const sent = [];
  const f = async (url, init) => {
    url = String(url);
    if (url.includes("keyword_ideas")) { const t = JSON.parse(init.body)[0]; sent.push([t.location_code, t.language_code, t.keywords]); return res({ tasks: [{ status_code: 20000, result: [{ items: [] }] }] }); }
    return res({}, 404);
  };
  const dfsEnv = { DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p" }, guard = testGuard({ fetch: f, env: dfsEnv });
  await quiet(() => run({ site, flags: { "no-open-data": true }, positional: ["استضافة مواقع", "web hosting for the shop", "خوادم"] }, { env: dfsEnv, fetch: f, delayMs: 0, guard }));
  assert.deepEqual(sent, [[2682, "ar", ["استضافة مواقع", "خوادم"]], [2682, "en", ["web hosting for the shop"]]]);
  assert.equal(JSON.parse(readFileSync(join(state, "keywords.json"), "utf8")).market, "Saudi Arabia (2682), ar");
  sent.length = 0;
  await quiet(() => run({ site, flags: { "no-open-data": true, language: "en" }, positional: ["استضافة مواقع"] }, { env: dfsEnv, fetch: f, delayMs: 0, guard }));
  assert.deepEqual(sent.map((s) => s[1]), ["en"], "--language overrides detection");
  await assert.rejects(() => quiet(() => run({ site, flags: { language: "fr" }, positional: ["x"] }, { env: { DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p" }, fetch: f, delayMs: 0 })), /"fr" is not one of this site's languages/);
});

test("rank --serp: tracked queries are checked in the language they are written in, in the site's location; no market keeps the old behaviour", async () => {
  const { run } = await import("../src/jobs/rank.mjs");
  const { site, data } = tmpSite({ market: SA });
  writeFileSync(join(data, "tracked-queries.json"), JSON.stringify(["كيف أختار مزود خدمة", "how to choose a supplier for the shop"]));
  const sent = [];
  const f = async (url, init) => { sent.push(JSON.parse(init.body)[0]); return res({ tasks: [{ status_code: 20000, result: [{ items: [] }] }] }); };
  const env = { DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p" };
  const deps = { env, fetch: f, delayMs: 0, today: "2026-11-20", guard: testGuard({ fetch: f, env }) };
  await quiet(() => run({ site, flags: { offline: true, serp: true } }, deps));
  assert.deepEqual(sent.map((b) => [b.location_code, b.language_code]), [[2682, "ar"], [2682, "en"]]);
  sent.length = 0;
  const warn = console.warn; console.warn = () => {};
  try { await quiet(() => run({ site: { ...site, id: "no-market", market: undefined }, flags: { offline: true, serp: true } }, deps)); } finally { console.warn = warn; }
  assert.deepEqual(sent.map((b) => [b.location_code, b.language_code]), [[2826, "en"], [2826, "en"]], "no market: the old United Kingdom / English check, as before");
});
