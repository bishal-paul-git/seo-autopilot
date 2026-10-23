// Google listings for the packs: Business Profile against the site, review replies and pace, Merchant Center issues and feed
// links, routing, and the job end to end with recorded-style responses (request shapes checked, no network).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profileFacts, reviewFacts, reviewStats, analyseProfile, analyseMerchant } from "../src/analysis/listings.mjs";
import { businessProfile, merchantCenter } from "../src/lib/google-business.mjs";
import { routeAgents } from "../src/analysis/agent-router.mjs";

const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const LOC = {
  name: "locations/456", title: "Acme Dental Ltd", phoneNumbers: { primaryPhone: "020 7946 0001" }, websiteUri: "https://other.test/",
  storefrontAddress: { addressLines: ["1 High St"], locality: "London", postalCode: "N1 1AA" }, categories: { primaryCategory: { displayName: "Dentist" } }, profile: { description: "" }, openInfo: { status: "OPEN" },
};
const rev = (date, stars, reply) => ({ starRating: stars, createTime: `${date}T10:00:00Z`, reviewer: { displayName: "Private Person" }, comment: "private text", ...(reply ? { reviewReply: { comment: "Thanks", updateTime: `${reply}T10:00:00Z` } } : {}) });
const REVIEWS = [rev("2026-10-20", "TWO"), rev("2026-10-01", "FIVE", "2026-10-03"), rev("2026-06-10", "FIVE", "2026-06-11"), rev("2026-06-01", "FOUR", "2026-06-05"), rev("2026-05-20", "FIVE", "2026-05-21"), rev("2026-05-10", "FIVE", "2026-05-12")];

test("profile facts and review facts keep no reviewer names or review text", () => {
  assert.equal(profileFacts(LOC).address, "1 High St, London, N1 1AA");
  const r = reviewFacts(REVIEWS);
  assert.deepEqual(Object.keys(r[0]).sort(), ["date", "replied", "replyDays", "stars"]);
  assert.ok(!JSON.stringify(r).includes("Private"));
  assert.deepEqual(r[1], { stars: 5, date: "2026-10-01", replied: true, replyDays: 2 });
});

test("review stats: last 90 days against the 90 before, reply rate, median reply time, unanswered", () => {
  const s = reviewStats(reviewFacts(REVIEWS), "2026-10-23");
  assert.deepEqual([s.last90, s.previous90, s.responseRate, s.medianReplyDays, s.unanswered30, s.lowUnanswered], [2, 4, 83, 2, 1, 1]);
});

test("profile findings: phone and website disagree, no hours, no description; name differs only by Ltd is not a finding", () => {
  const r = analyseProfile({ location: LOC, reviews: REVIEWS, averageRating: 4.6, totalReviewCount: 31 }, { owner: { name: "Acme Dental", phone: "+44 20 7946 0000", address: "1 High Street, London, N1 1AA" }, siteUrl: "https://www.acme.test/", today: "2026-10-23" });
  const ids = r.findings.map((f) => f.id);
  assert.deepEqual(ids, ["gbp-phone-differs", "gbp-website-elsewhere", "gbp-no-hours", "gbp-no-description", "gbp-one-category", "reviews-unanswered", "reviews-low-unanswered"]);
  assert.equal(r.reviews.totalReviewCount, 31);
  assert.ok(!ids.includes("gbp-address-differs"), "St and Street compare equal");
});

test("merchant: disapproved first, demoted, broken and off-site links cross-checked with the audit", () => {
  const products = [
    { offerId: "a", productAttributes: { link: "https://shop.test/p/a" }, productStatus: { itemLevelIssues: [{ code: "price_mismatch", severity: "DISAPPROVED", description: "Mismatched price", attribute: "price" }] } },
    { offerId: "b", productAttributes: { link: "https://shop.test/p/b" }, productStatus: { itemLevelIssues: [{ code: "missing_gtin", severity: "DEMOTED", description: "Missing GTIN" }, { code: "x", severity: "NOT_IMPACTED" }] } },
    { offerId: "c", productAttributes: { link: "https://elsewhere.test/c" }, productStatus: {} },
    { offerId: "d", productAttributes: { link: "https://shop.test/p/d" }, productStatus: { itemLevelIssues: [{ code: "price_mismatch", severity: "DISAPPROVED", description: "Mismatched price" }] } },
  ];
  const r = analyseMerchant(products, { siteUrl: "https://shop.test/", auditPages: [{ url: "https://shop.test/p/d", status: 404 }, { url: "https://shop.test/p/a", status: 200 }] });
  assert.deepEqual([r.products, r.disapproved, r.demoted], [4, 2, 1]);
  assert.deepEqual(r.findings.map((f) => f.id), ["merchant-disapproved", "merchant-demoted", "merchant-broken-links", "merchant-links-elsewhere"]);
  assert.deepEqual(r.issues.map((i) => [i.code, i.count]), [["price_mismatch", 2], ["missing_gtin", 1]]);
  assert.match(r.findings[0].detail, /Mismatched price \(2\)/);
});

test("clients: Business Profile signs in with the refresh token and reads the location and reviews; Merchant pages through products", async () => {
  const calls = [];
  const f = async (u, init) => {
    u = String(u); calls.push({ u, init });
    if (u.includes("oauth2")) return res({ access_token: "at-1" });
    if (u.includes("mybusinessbusinessinformation")) return res(LOC);
    if (u.includes("/reviews")) return res(u.includes("pageToken") ? { reviews: [REVIEWS[1]] } : { reviews: [REVIEWS[0]], averageRating: 4.6, totalReviewCount: 31, nextPageToken: "n2" });
    return res({}, 404);
  };
  const env = { GBP_CLIENT_ID: "c", GBP_CLIENT_SECRET: "cs", GBP_REFRESH_TOKEN: "rt", GBP_LOCATION: "accounts/123/locations/456" };
  assert.equal(businessProfile.enabled(env), true); assert.equal(businessProfile.enabled({ ...env, GBP_LOCATION: "456" }), false);
  const g = await businessProfile.read({ fetch: f, env });
  assert.equal(g.reviews.length, 2); assert.equal(g.totalReviewCount, 31);
  assert.match(calls[1].u, /mybusinessbusinessinformation\.googleapis\.com\/v1\/locations\/456\?readMask=/);
  assert.match(calls[2].u, /mybusiness\.googleapis\.com\/v4\/accounts\/123\/locations\/456\/reviews\?pageSize=50/);
  assert.equal(calls[1].init.headers.Authorization, "Bearer at-1");
  const m = [];
  const mf = async (u) => { m.push(String(u)); return res(String(u).includes("pageToken") ? { products: [{ offerId: "b" }] } : { products: [{ offerId: "a" }], nextPageToken: "p2" }); };
  const prods = await merchantCenter.products({ fetch: mf, env: { MERCHANT_ACCOUNT_ID: "98-76", GOOGLE_KEY_JSON: "{}" }, token: "t" });
  assert.deepEqual(prods.map((p) => p.offerId), ["a", "b"]);
  assert.match(m[0], /merchantapi\.googleapis\.com\/products\/v1\/accounts\/9876\/products\?pageSize=1000/);
  await assert.rejects(merchantCenter.products({ fetch: async () => res({ error: { status: "PERMISSION_DENIED", message: "denied" } }, 403), env: { MERCHANT_ACCOUNT_ID: "1" }, token: "secret-tok" }), (e) => /merchant-center: denied \(check/.test(e.message) && !e.message.includes("secret-tok"));
});

test("routing: profile disagreements, gaps, reviews and Merchant problems each reach their agent", () => {
  const listings = { findings: [{ id: "gbp-phone-differs", severity: "high", title: "phone", detail: "d" }, { id: "gbp-no-hours", severity: "medium", title: "hours", detail: "d" }, { id: "reviews-unanswered", severity: "medium", title: "1 unanswered", detail: "Reply" }, { id: "merchant-disapproved", severity: "high", title: "2 disapproved", detail: "x", pages: ["https://shop.test/p/a"] }] };
  const steps = routeAgents({ listings }).steps, agents = steps.map((s) => s.agent);
  for (const a of ["seo-local-citation-auditor", "seo-local-gbp-optimizer", "seo-local-review-manager", "seo-ecommerce"]) assert.ok(agents.includes(a), a);
  assert.deepEqual(steps.find((s) => s.agent === "seo-ecommerce").targets, ["/p/a"]);
});

test("job: runs only the parts whose pack applies and whose access is set; writes listings.json", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-listings-")), state = join(root, "state"); mkdirSync(state);
  writeFileSync(join(state, "audit.json"), JSON.stringify({ pages: [] }));
  const { run } = await import("../src/jobs/listings.mjs");
  const log = console.log; console.log = () => {};
  const env = { GBP_CLIENT_ID: "c", GBP_CLIENT_SECRET: "cs", GBP_REFRESH_TOKEN: "rt", GBP_LOCATION: "accounts/1/locations/2" };
  const f = async (u) => (String(u).includes("mybusinessbusinessinformation") ? res(LOC) : String(u).includes("/reviews") ? res({ reviews: REVIEWS }) : res({}, 404));
  try {
    await run({ site: { id: "s", name: "S", url: "https://acme.test/", verticals: ["local"], paths: { state } } }, { env, fetch: f, gbpToken: "t", today: "2026-10-23" });
    let r = JSON.parse(readFileSync(join(state, "listings.json"), "utf8"));
    assert.equal(r.gbp.profile.name, "Acme Dental Ltd"); assert.equal(r.merchant, null);
    assert.ok(r.findings.some((x) => x.id === "gbp-website-elsewhere"));
    assert.match(readFileSync(join(state, "listings.md"), "utf8"), /## Business Profile/);
    await run({ site: { id: "s", name: "S", url: "https://acme.test/", verticals: [], paths: { state } } }, { env, fetch: f, gbpToken: "t" });
    r = JSON.parse(readFileSync(join(state, "listings.json"), "utf8"));
    assert.equal(r.gbp, null); assert.match(r.notes[0], /Neither the local nor the e-commerce pack/);
  } finally { console.log = log; }
});
