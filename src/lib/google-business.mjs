// Google Business Profile and Merchant Center clients, with the user's own Google access. `fetch` is injectable so tests never
// touch the network. Tokens go in headers only, never into errors or logs. Request and response shapes follow Google's REST
// references; neither has been run against a live account.
//
//   Business Profile (local pack). Google gives these APIs to approved projects only: request access for your Google Cloud
//   project first (Business Profile APIs, "Application for Basic API Access"). Service accounts cannot sign in; use OAuth with
//   the business.manage scope from a Google account that manages the profile.
//     GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN   OAuth client and refresh token
//     GBP_LOCATION                                         accounts/<account id>/locations/<location id>
//   Merchant Center (e-commerce pack), Merchant API. Add the service account's email as a user of the Merchant Center account.
//     GOOGLE_KEY_JSON / GOOGLE_KEY_FILE                    the service account (scope: content)
//     MERCHANT_ACCOUNT_ID                                  the Merchant Center account id
//     MERCHANT_API_VERSION                                 optional, default v1
import { getToken } from "./google-auth.mjs";

export const SCOPES = { business: "https://www.googleapis.com/auth/business.manage", content: "https://www.googleapis.com/auth/content" };

async function oauth(env, prefix, f) {
  const r = await f("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: env[`${prefix}_CLIENT_ID`], client_secret: env[`${prefix}_CLIENT_SECRET`], refresh_token: env[`${prefix}_REFRESH_TOKEN`] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`sign-in failed (${j.error || `HTTP ${r.status}`})`);
  return j.access_token;
}

async function getJson(f, name, url, token) {
  let r;
  try { r = await f(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) }); } catch (e) { throw new Error(`${name}: request failed (${e.name || "error"})`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const status = j.error?.status || "";
    throw new Error(`${name}: ${j.error?.message || `HTTP ${r.status}`}${status === "PERMISSION_DENIED" || r.status === 403 ? " (check that the signed-in account manages it and, for Business Profile, that Google approved API access for the project)" : ""}`);
  }
  return j;
}

/** Follow nextPageToken up to `pages` pages, collecting `key`. */
async function paged(fetchPage, key, pages) {
  const out = []; let token = "";
  for (let i = 0; i < pages; i++) { const j = await fetchPage(token); out.push(...(j[key] || [])); token = j.nextPageToken; if (!token) break; }
  return out;
}

const READ_MASK = "name,title,phoneNumbers,storefrontAddress,websiteUri,regularHours,categories,profile,openInfo";

export const businessProfile = {
  name: "business-profile",
  enabled: (env) => Boolean(env.GBP_CLIENT_ID && env.GBP_CLIENT_SECRET && env.GBP_REFRESH_TOKEN && /^accounts\/[^/]+\/locations\/[^/]+$/.test(env.GBP_LOCATION || "")),
  /** The location's profile and up to 200 newest reviews. */
  async read({ fetch: f = fetch, env = process.env, token = null } = {}) {
    let t = token;
    if (!t) { try { t = await oauth(env, "GBP", f); } catch (e) { throw new Error(`business-profile: ${e.message}`); } }
    const location = await getJson(f, "business-profile", `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${env.GBP_LOCATION.split("/")[3]}?readMask=${READ_MASK}`, t);
    let meta = {};
    const reviews = await paged(async (pt) => {
      const j = await getJson(f, "business-profile reviews", `https://mybusiness.googleapis.com/v4/${env.GBP_LOCATION}/reviews?${new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc", ...(pt ? { pageToken: pt } : {}) })}`, t);
      if (!pt) meta = { averageRating: j.averageRating ?? null, totalReviewCount: j.totalReviewCount ?? null };
      return j;
    }, "reviews", 4);
    return { location, reviews, ...meta };
  },
};

export const merchantCenter = {
  name: "merchant-center",
  enabled: (env) => Boolean(env.MERCHANT_ACCOUNT_ID && (env.GOOGLE_KEY_JSON || env.GOOGLE_KEY_FILE)),
  /** Up to 5,000 products with their status and item-level issues. */
  async products({ fetch: f = fetch, env = process.env, token = null } = {}) {
    const t = token || (await getToken([SCOPES.content])).token;
    const v = env.MERCHANT_API_VERSION || "v1", id = String(env.MERCHANT_ACCOUNT_ID).replace(/\D/g, "");
    return paged((pt) => getJson(f, "merchant-center", `https://merchantapi.googleapis.com/products/${v}/accounts/${id}/products?${new URLSearchParams({ pageSize: "1000", ...(pt ? { pageToken: pt } : {}) })}`, t), "products", 5);
  },
};
