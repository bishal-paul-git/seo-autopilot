// Google listings for the packs, with the user's own access: the Business Profile for local businesses (the profile against
// the site, opening hours, description, categories, review replies and pace) and Merchant Center for shops (disapproved and
// demoted products, feed links that are broken or off-site). Each part runs only when its pack applies and its access is set
// (see src/lib/google-business.mjs); --force ignores the pack check. Reads only; never replies to a review or edits a product.
//   npx seo-autopilot run listings [--force]
// Writes listings.json and listings.md.
import { readJson, writeJson, writeText, today as todayFn } from "../core/util.mjs";
import { detectVerticals } from "../analysis/verticals.mjs";
import { businessProfile, merchantCenter } from "../lib/google-business.mjs";
import { analyseProfile, analyseMerchant, listingsMarkdown } from "../analysis/listings.mjs";

export const description = "Google listings: Business Profile against the site and review replies (local pack); Merchant Center product issues (e-commerce pack)";

/** `deps`: fetch, env, today, gbpToken, merchantToken. For tests. */
export async function run({ site, flags = {} }, deps = {}) {
  const env = deps.env || process.env, f = deps.fetch || globalThis.fetch, s = site.paths.state, day = deps.today || todayFn();
  const packs = new Set(detectVerticals({ profile: readJson(`${s}/site-profile.json`, null), site }).map((p) => p.pack));
  const wantLocal = flags.force || packs.has("local"), wantShop = flags.force || packs.has("ecommerce");
  const notes = [];
  let gbp = null, merchant = null;
  if (wantLocal && !businessProfile.enabled(env)) notes.push("Business Profile: not connected. Set GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN and GBP_LOCATION (see docs/jobs.md).");
  if (wantLocal && businessProfile.enabled(env)) {
    try { gbp = analyseProfile(await businessProfile.read({ fetch: f, env, token: deps.gbpToken }), { owner: site.business || {}, siteUrl: site.url, today: day }); }
    catch (e) { notes.push(e.message); }
  }
  if (wantShop && !merchantCenter.enabled(env)) notes.push("Merchant Center: not connected. Set MERCHANT_ACCOUNT_ID and the service account (GOOGLE_KEY_JSON), added as a user of the Merchant Center account.");
  if (wantShop && merchantCenter.enabled(env)) {
    try { merchant = analyseMerchant(await merchantCenter.products({ fetch: f, env, token: deps.merchantToken }), { siteUrl: site.url, auditPages: readJson(`${s}/audit.json`, { pages: [] }).pages || [] }); }
    catch (e) { notes.push(e.message); }
  }
  if (!wantLocal && !wantShop) notes.push("Neither the local nor the e-commerce pack applies to this site; nothing to check. Set \"verticals\" in the config or run with --force.");
  const findings = [...(gbp?.findings || []), ...(merchant?.findings || [])];
  writeJson(`${s}/listings.json`, { generatedAt: new Date().toISOString(), gbp, merchant, findings, notes });
  writeText(`${s}/listings.md`, listingsMarkdown({ siteName: site.name, gbp, merchant, notes }));
  console.log(`listings: ${site.id}: ${gbp ? "Business Profile checked" : "no Business Profile"}, ${merchant ? `${merchant.products} product(s) checked` : "no Merchant Center"}; ${findings.length} finding(s).${notes.length ? ` ${notes.length} note(s) in listings.md.` : ""}`);
}
