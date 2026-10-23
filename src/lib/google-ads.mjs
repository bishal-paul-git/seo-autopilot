// Google Keyword Planner through the Google Ads API (KeywordPlanIdeaService.GenerateKeywordIdeas), with the user's own Google
// Ads account. Free to call. Keyword ideas, average monthly searches, competition and top-of-page bid ranges, as Google
// estimates them. Request and response shapes follow Google's REST reference; not yet run against a live account.
//
//   GOOGLE_ADS_DEVELOPER_TOKEN    from the API Center of a Google Ads manager account. New tokens work with test accounts
//                                 only until Google approves a higher access level.
//   GOOGLE_ADS_CUSTOMER_ID        the Ads account to plan in (dashes are fine)
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID  optional: the manager account, when access to the customer goes through it
//   sign-in, either:
//     GOOGLE_ADS_CLIENT_ID + GOOGLE_ADS_CLIENT_SECRET + GOOGLE_ADS_REFRESH_TOKEN   OAuth with the adwords scope (Google's default)
//     GOOGLE_KEY_JSON / GOOGLE_KEY_FILE   the service account, once its email is added as a user of the Ads account
//   GOOGLE_ADS_API_VERSION        optional, default v24 (Google retires each version about a year after release)
//   GOOGLE_ADS_LANGUAGE           optional language constant id, default 1000 (English)
// Tokens go in headers only and are never logged or put in errors.
import { getToken } from "./google-auth.mjs";
import { market } from "./research-sources.mjs";

export const ADWORDS_SCOPE = "https://www.googleapis.com/auth/adwords";
// Geo target constant ids (Google Ads geotargets list) for the markets the research suite knows.
const GEO = { GB: 2826, US: 2840, CA: 2124, AU: 2036, IE: 2372, DE: 2276, FR: 2250, ES: 2724, IT: 2380, NL: 2528, IN: 2356, NZ: 2554, ZA: 2710 };
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

const oauthSet = (env) => Boolean(env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET && env.GOOGLE_ADS_REFRESH_TOKEN);
const customer = (id) => String(id || "").replace(/\D/g, "");
const money = (micros) => (micros == null ? null : Math.round(Number(micros) / 1e4) / 100);

/** An access token: OAuth refresh token when set (fetch injectable), else the service account. */
async function accessToken(env, f) {
  if (oauthSet(env)) {
    const r = await f("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: env.GOOGLE_ADS_CLIENT_ID, client_secret: env.GOOGLE_ADS_CLIENT_SECRET, refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) throw new Error(`google-ads: sign-in failed (${j.error || `HTTP ${r.status}`})`);
    return j.access_token;
  }
  return (await getToken([ADWORDS_SCOPE])).token;
}

/** The most useful message from a Google Ads error body, with a hint for the usual first-run problem. */
export function adsError(status, j) {
  const detail = j?.error?.details?.flatMap((d) => d.errors || [])[0];
  const msg = detail?.message || j?.error?.message || `HTTP ${status}`;
  const code = JSON.stringify(detail?.errorCode || {});
  const hint = /DEVELOPER_TOKEN_NOT_APPROVED|DEVELOPER_TOKEN_PROHIBITED/.test(code + msg) ? " The developer token works only with test accounts until Google approves a higher access level (API Center)."
    : /USER_PERMISSION_DENIED/.test(code) ? " Set GOOGLE_ADS_LOGIN_CUSTOMER_ID to the manager account, or give the signed-in user access to the customer."
    : "";
  return new Error(`google-ads: ${msg}${hint}`);
}

/** Months oldest first, last 12: [{ month: "2026-09", searches }]. */
export function monthly(list = []) {
  return list.map((x) => ({ y: Number(x.year), m: MONTHS.indexOf(x.month) + 1, searches: x.monthlySearches == null ? null : Number(x.monthlySearches) }))
    .filter((x) => x.y && x.m > 0).sort((a, b) => a.y - b.y || a.m - b.m).slice(-12)
    .map((x) => ({ month: `${x.y}-${String(x.m).padStart(2, "0")}`, searches: x.searches }));
}

/** One idea from the API into the research suite's shape. Bids are in the Ads account's currency. */
export function parseIdea(r) {
  const k = r.keywordIdeaMetrics || {};
  const months = monthly(k.monthlySearchVolumes);
  return {
    query: String(r.text || "").toLowerCase().trim(),
    volume: k.avgMonthlySearches == null ? null : Number(k.avgMonthlySearches),
    competition: k.competition && !/UNSPECIFIED|UNKNOWN/.test(k.competition) ? k.competition.toLowerCase() : null,
    competitionIndex: k.competitionIndex == null ? null : Number(k.competitionIndex),
    bidLow: money(k.lowTopOfPageBidMicros), bidHigh: money(k.highTopOfPageBidMicros),
    trend: months.map((x) => x.searches ?? 0), months,
  };
}

export const planner = {
  name: "google-ads",
  enabled: (env) => Boolean(env.GOOGLE_ADS_DEVELOPER_TOKEN && customer(env.GOOGLE_ADS_CUSTOMER_ID) && (oauthSet(env) || env.GOOGLE_KEY_JSON || env.GOOGLE_KEY_FILE)),
  /** Keyword ideas for up to 20 seeds in the market: [{ query, volume, competition, competitionIndex, bidLow, bidHigh, trend, months }]. */
  async ideas(seeds, m, { fetch: f = fetch, env = process.env, limit = 300, token = null } = {}) {
    const geo = GEO[market(m)];
    if (!geo) throw new Error(`google-ads: no geo target for market ${market(m)}`);
    const id = customer(env.GOOGLE_ADS_CUSTOMER_ID), v = env.GOOGLE_ADS_API_VERSION || "v24";
    const headers = { Authorization: `Bearer ${token || (await accessToken(env, f))}`, "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN, "Content-Type": "application/json" };
    if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers["login-customer-id"] = customer(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
    const body = {
      keywordSeed: { keywords: seeds.slice(0, 20) }, language: `languageConstants/${env.GOOGLE_ADS_LANGUAGE || 1000}`,
      geoTargetConstants: [`geoTargetConstants/${geo}`], keywordPlanNetwork: "GOOGLE_SEARCH", includeAdultKeywords: false, pageSize: limit,
    };
    let r;
    try { r = await f(`https://googleads.googleapis.com/${v}/customers/${id}:generateKeywordIdeas`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) }); }
    catch (e) { throw new Error(`google-ads: request failed (${e.name || "error"})`); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw adsError(r.status, j);
    return (j.results || []).map(parseIdea).filter((k) => k.query);
  },
};
