// Google Keyword Planner through the Google Ads API: request shape, parsing, errors without secrets, demand ranking, and the
// keywords job with a recorded-style fake API (no network). Not yet run against a live Ads account.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planner, parseIdea, monthly, adsError } from "../src/lib/google-ads.mjs";
import { mergeCandidates, demand } from "../src/analysis/keywords.mjs";

const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ENV = { GOOGLE_ADS_DEVELOPER_TOKEN: "dev-secret", GOOGLE_ADS_CUSTOMER_ID: "123-456-7890", GOOGLE_ADS_CLIENT_ID: "cid", GOOGLE_ADS_CLIENT_SECRET: "csecret", GOOGLE_ADS_REFRESH_TOKEN: "rtok" };
const IDEA = {
  text: "Web Hosting UK",
  keywordIdeaMetrics: {
    avgMonthlySearches: "2400", competition: "HIGH", competitionIndex: "87", lowTopOfPageBidMicros: "1250000", highTopOfPageBidMicros: "6420000",
    monthlySearchVolumes: [{ month: "SEPTEMBER", year: "2026", monthlySearches: "2900" }, { month: "AUGUST", year: "2026", monthlySearches: "1900" }],
  },
};

test("enabled: developer token, customer and a sign-in are all needed", () => {
  assert.equal(planner.enabled(ENV), true);
  assert.equal(planner.enabled({ ...ENV, GOOGLE_ADS_DEVELOPER_TOKEN: "" }), false);
  assert.equal(planner.enabled({ GOOGLE_ADS_DEVELOPER_TOKEN: "d", GOOGLE_ADS_CUSTOMER_ID: "1" }), false, "no sign-in");
  assert.equal(planner.enabled({ GOOGLE_ADS_DEVELOPER_TOKEN: "d", GOOGLE_ADS_CUSTOMER_ID: "1", GOOGLE_KEY_JSON: "{}" }), true, "service account");
});

test("parse: volume, competition, bids in currency units, months oldest first; unknown competition is null", () => {
  const k = parseIdea(IDEA);
  assert.deepEqual(k, { query: "web hosting uk", volume: 2400, competition: "high", competitionIndex: 87, bidLow: 1.25, bidHigh: 6.42, trend: [1900, 2900], months: [{ month: "2026-08", searches: 1900 }, { month: "2026-09", searches: 2900 }] });
  assert.equal(parseIdea({ text: "x", keywordIdeaMetrics: { competition: "UNSPECIFIED" } }).competition, null);
  assert.equal(parseIdea({ text: "x" }).volume, null, "no metrics: no number invented");
  assert.equal(monthly(Array.from({ length: 14 }, (_, i) => ({ month: "JANUARY", year: String(2010 + i), monthlySearches: "1" }))).length, 12);
});

test("request: refresh-token sign-in, then generateKeywordIdeas on the customer with headers, geo and language", async () => {
  const calls = [];
  const f = async (u, init) => { calls.push({ u: String(u), init }); return String(u).includes("oauth2") ? res({ access_token: "at-1" }) : res({ results: [IDEA] }); };
  const out = await planner.ideas(["web hosting"], "UK", { fetch: f, env: { ...ENV, GOOGLE_ADS_LOGIN_CUSTOMER_ID: "999-000-1111" } });
  assert.equal(out[0].volume, 2400);
  assert.equal(calls[0].init.body.get("grant_type"), "refresh_token");
  assert.equal(calls[1].u, "https://googleads.googleapis.com/v24/customers/1234567890:generateKeywordIdeas");
  const h = calls[1].init.headers, b = JSON.parse(calls[1].init.body);
  assert.equal(h.Authorization, "Bearer at-1"); assert.equal(h["developer-token"], "dev-secret"); assert.equal(h["login-customer-id"], "9990001111");
  assert.deepEqual(b.keywordSeed, { keywords: ["web hosting"] });
  assert.deepEqual(b.geoTargetConstants, ["geoTargetConstants/2826"]); assert.equal(b.language, "languageConstants/1000"); assert.equal(b.keywordPlanNetwork, "GOOGLE_SEARCH");
  await planner.ideas(["x"], "US", { fetch: async (u) => { calls.push({ u: String(u) }); return res({ results: [] }); }, env: { ...ENV, GOOGLE_ADS_API_VERSION: "v23" }, token: "t" });
  assert.match(calls.at(-1).u, /\/v23\/customers\//, "version override; an injected token skips sign-in");
});

test("errors: the Google Ads message with a hint, never a token or secret", async () => {
  const notApproved = { error: { code: 403, message: "The caller does not have permission", details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" }, message: "The developer token is only approved for use with test accounts." }] }] } };
  await assert.rejects(planner.ideas(["x"], "GB", { fetch: async () => res(notApproved, 403), env: ENV, token: "at-secret" }),
    (e) => /only approved for use with test accounts/.test(e.message) && /higher access level/.test(e.message) && !/dev-secret|at-secret|rtok|csecret/.test(e.message));
  await assert.rejects(planner.ideas(["x"], "GB", { fetch: async () => res({ error: "invalid_grant" }, 400), env: ENV }), (e) => /sign-in failed \(invalid_grant\)/.test(e.message) && !/rtok/.test(e.message));
  await assert.rejects(planner.ideas(["x"], "BR", { fetch: async () => res({}), env: ENV, token: "t" }), /no geo target/);
  assert.match(adsError(403, { error: { details: [{ errors: [{ errorCode: { authorizationError: "USER_PERMISSION_DENIED" }, message: "denied" }] }] } }).message, /GOOGLE_ADS_LOGIN_CUSTOMER_ID/);
});

test("demand: Keyword Planner volume ranks above a third-party estimate, Bing and Search Console", () => {
  const [k] = mergeCandidates({ planner: [parseIdea(IDEA)], ideas: [{ query: "web hosting uk", volume: 5000, competition: 0.9 }], gsc: [{ query: "web hosting uk", impressions: 300 }] });
  assert.deepEqual(k.sources, ["search-console", "provider", "google-ads"]);
  assert.deepEqual(demand(k), { value: 2400, basis: "Google Keyword Planner monthly searches (Google's estimate)" });
  assert.equal(k.volume, 5000, "the provider's own figure is kept beside Google's");
  assert.deepEqual(k.bid, { low: 1.25, high: 6.42 }); assert.equal(k.competition, "high");
});

test("keywords job: planner ideas join the report; a failing planner is a note, not a stop", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-ads-")), state = join(root, "state"); mkdirSync(state);
  const site = { id: "s", name: "S", url: "https://s.test/", sitemap: "https://s.test/none.xml", paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/keywords.mjs");
  const log = console.log; console.log = () => {};
  try {
    await run({ site, flags: {}, positional: ["web hosting"] }, { env: ENV, adsToken: "t", delayMs: 0, fetch: async (u) => (String(u).includes("googleads") ? res({ results: [IDEA, { text: "cheap web hosting", keywordIdeaMetrics: { avgMonthlySearches: "880" } }] }) : res({}, 404)) });
    let r = JSON.parse(readFileSync(join(state, "keywords.json"), "utf8"));
    assert.ok(r.sourcesUsed.includes("google-ads"));
    assert.equal(r.list[0].query, "web hosting uk"); assert.match(r.list[0].sources.join(), /google-ads/);
    assert.match(readFileSync(join(state, "keywords.md"), "utf8"), /Google Keyword Planner monthly searches/);
    await run({ site, flags: {}, positional: ["web hosting"] }, { env: ENV, adsToken: "t", delayMs: 0, fetch: async () => res({ error: { message: "quota" } }, 429) });
    r = JSON.parse(readFileSync(join(state, "keywords.json"), "utf8"));
    assert.ok(r.notes.some((n) => /^google-ads: .*quota/.test(n)));
  } finally { console.log = log; }
});
