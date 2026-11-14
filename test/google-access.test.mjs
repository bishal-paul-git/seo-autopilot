// Give us read access (D56): the service account's email, "Check access" (authorised as the signed-in portal user, only
// this site's host returned), the service-account token with both scopes, and the hosted Search Console and GA4 reads of
// the properties bound to a site. Mocked Google and RPC; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { googleAccessRoute, accessFor, serviceEmail, gscCovers, GSC_SCOPE, GA_SCOPE, MAX_GA4_CHECKS } from "../src/god/google-access.mjs";
import { googleToken, makeSearchSnapshotHandler, makeSearchConsoleHandler, analyticsForAgents } from "../src/god/search-console.mjs";
import { MemoryStore } from "../src/god/stores.mjs";
import { tick } from "../src/god/tick.mjs";
import { handler } from "../cloud/worker/src/app.mjs";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY = JSON.stringify({ client_email: "seo-reader@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "https://oauth2.googleapis.com/token" });
const ENV = { GOOGLE_KEY_JSON: KEY, PORTAL_URL: "https://portal.test/", SUPABASE_URL: "https://ref.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SUPABASE_SERVICE_ROLE_KEY: "svc" };
const ORIGIN = "https://seo-god.x.workers.dev", SITE = "11111111-1111-4111-8111-111111111111";
const jsonRes = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });

/** Google and Supabase stand-ins. The service account can see two customers' properties: plumber.test and bakery.test. */
function world({ userOk = true } = {}) {
  const calls = [], rpcs = [];
  const fetchImpl = async (url, o = {}) => {
    const u = String(url); calls.push({ url: u, headers: o.headers || {}, body: o.body ? String(o.body) : "" });
    if (u === "https://ref.supabase.co/rest/v1/rpc/google_access_site") return userOk && o.headers.Authorization === "Bearer user-jwt" ? jsonRes({ site: SITE, url: "https://www.plumber.test/", role: "agency" }) : jsonRes({ message: "not allowed" }, 400);
    if (u === "https://oauth2.googleapis.com/token") return jsonRes({ access_token: "sa-access" });
    if (u === "https://www.googleapis.com/webmasters/v3/sites") return jsonRes({ siteEntry: [{ siteUrl: "sc-domain:plumber.test", permissionLevel: "siteRestrictedUser" }, { siteUrl: "https://bakery.test/", permissionLevel: "siteOwner" }, { siteUrl: "https://www.plumber.test/", permissionLevel: "siteUnverifiedUser" }] });
    if (u.startsWith("https://analyticsadmin.googleapis.com/v1beta/accountSummaries")) return jsonRes({ accountSummaries: [{ displayName: "Bakery", propertySummaries: [{ property: "properties/1", displayName: "Bakery web" }] }, { displayName: "Plumber Ltd", propertySummaries: [{ property: "properties/2", displayName: "Main site" }] }] });
    if (u.startsWith("https://analyticsadmin.googleapis.com/v1beta/properties/1/dataStreams")) return jsonRes({ dataStreams: [{ webStreamData: { defaultUri: "https://bakery.test" } }] });
    if (u.startsWith("https://analyticsadmin.googleapis.com/v1beta/properties/2/dataStreams")) return jsonRes({ dataStreams: [{ webStreamData: { defaultUri: "https://plumber.test/" } }] });
    return jsonRes({ error: { message: "unexpected " + u } }, 500);
  };
  const call = async (fn, args) => { rpcs.push({ fn, args }); return fn === "google_access_seen" ? { sites: args.p_choices.sites.map((x) => ({ ...x, taken: false })), ga4: args.p_choices.ga4.map((x) => ({ ...x, taken: false })), suggested: "sc-domain:plumber.test" } : null; };
  return { fetchImpl, call, calls, rpcs };
}
const req = (path, { method = "GET", body, auth } = {}) => new Request(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });

test("service account: the email only; the token asks for both read-only scopes", async () => {
  assert.equal(serviceEmail(KEY), "seo-reader@proj.iam.gserviceaccount.com"); assert.equal(serviceEmail("not json"), null);
  const w = world();
  const r = await googleAccessRoute(req("/google/account"), { env: ENV, fetchImpl: w.fetchImpl, call: w.call });
  const j = await r.json();
  assert.deepEqual(j, { ok: true, email: "seo-reader@proj.iam.gserviceaccount.com" });
  assert.equal(r.headers.get("access-control-allow-origin"), "https://portal.test");
  assert.ok(!JSON.stringify(j).includes("PRIVATE"), "never the key");
  assert.equal((await googleAccessRoute(req("/google/account"), { env: { ...ENV, GOOGLE_KEY_JSON: "" }, fetchImpl: w.fetchImpl, call: w.call })).status, 503);
  assert.equal(await googleAccessRoute(req("/health"), { env: ENV, fetchImpl: w.fetchImpl, call: w.call }), null);
  let sent = null;
  await googleToken(KEY, { scopes: [GSC_SCOPE, GA_SCOPE], fetchImpl: async (_u, o) => { sent = new URLSearchParams(o.body); return jsonRes({ access_token: "t" }); } });
  const claims = JSON.parse(Buffer.from(sent.get("assertion").split(".")[1], "base64url").toString());
  assert.equal(claims.scope, `${GSC_SCOPE} ${GA_SCOPE}`); assert.equal(claims.iss, "seo-reader@proj.iam.gserviceaccount.com");
  await googleToken(KEY, { fetchImpl: async (_u, o) => { sent = new URLSearchParams(o.body); return jsonRes({ access_token: "t" }); } });
  assert.equal(JSON.parse(Buffer.from(sent.get("assertion").split(".")[1], "base64url").toString()).scope, GSC_SCOPE, "Search Console only by default");
});

test("check access: only the signed-in user's allowed site, only its host; other customers' properties never leave the Worker", async () => {
  const w = world();
  assert.equal((await googleAccessRoute(req("/google/check", { method: "POST", body: { site: SITE } }), { env: ENV, fetchImpl: w.fetchImpl, call: w.call })).status, 401, "no token");
  const denied = world({ userOk: false });
  assert.equal((await googleAccessRoute(req("/google/check", { method: "POST", body: { site: SITE }, auth: "other-jwt" }), { env: ENV, fetchImpl: denied.fetchImpl, call: denied.call })).status, 403);
  assert.ok(!denied.calls.some((c) => c.url.includes("googleapis")), "no Google call for someone not allowed");
  const r = await googleAccessRoute(req("/google/check", { method: "POST", body: { site: SITE }, auth: "user-jwt" }), { env: ENV, fetchImpl: w.fetchImpl, call: w.call });
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.email, "seo-reader@proj.iam.gserviceaccount.com");
  assert.deepEqual(j.sites.map((s) => s.url), ["sc-domain:plumber.test"], "unverified and other hosts dropped");
  assert.deepEqual(j.ga4.map((g) => g.id), ["properties/2"], "only the GA4 property with a stream on this host");
  assert.ok(!JSON.stringify(j).includes("bakery") && !JSON.stringify(j).toLowerCase().includes("bakery web"), "nothing about the other customer");
  const user = w.calls.find((c) => c.url.endsWith("/google_access_site"));
  assert.equal(user.headers.apikey, "sb_publishable_x", "the database checks the user with the publishable key, not the service key");
  assert.equal(w.rpcs[0].fn, "google_access_seen"); assert.equal(w.rpcs[0].args.p_site, SITE);
  assert.ok(w.calls.filter((c) => c.url.includes("googleapis.com/") && !c.url.includes("oauth2")).every((c) => c.headers.Authorization === "Bearer sa-access"), "listed with the service account");
  assert.equal((await googleAccessRoute(req("/google/check", { method: "POST", body: { site: SITE }, auth: "user-jwt" }), { env: { ...ENV, SUPABASE_PUBLISHABLE_KEY: "" }, fetchImpl: w.fetchImpl, call: w.call })).status, 503);
});

test("check access: GA4 properties named after the site are checked first, with a cap and a plain note", async () => {
  const props = Array.from({ length: MAX_GA4_CHECKS + 5 }, (_, i) => ({ property: `properties/${i + 10}`, displayName: i === MAX_GA4_CHECKS + 4 ? "Plumber" : `Other ${i}` }));
  const asked = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith("/sites")) return jsonRes({});
    if (u.includes("accountSummaries")) return jsonRes({ accountSummaries: [{ displayName: "Agency", propertySummaries: props }] });
    asked.push(u); return jsonRes({ dataStreams: [{ webStreamData: { defaultUri: u.includes(`/properties/${MAX_GA4_CHECKS + 14}/`) ? "https://plumber.test" : "https://x.test" } }] });
  };
  const r = await accessFor("https://plumber.test/", { token: "t", fetchImpl });
  assert.equal(asked.length, MAX_GA4_CHECKS); assert.match(asked[0], new RegExp(`/properties/${MAX_GA4_CHECKS + 14}/`));
  assert.deepEqual(r.ga4.map((g) => g.name), ["Plumber"]); assert.match(r.errors[0], /only 30 of 35 properties were checked/);
  assert.ok(gscCovers("https://blog.plumber.test/", "sc-domain:plumber.test") && !gscCovers("https://plumber.test/", "sc-domain:notplumber.test"));
});

test("hosted reads of the bound properties: no admin confirmation, GA4 stored for the agents; a lost property escalates", async () => {
  const NOW = "2026-11-30T12:00:00Z", store = new MemoryStore(), calls = [];
  const fetchImpl = async (url, o) => {
    calls.push({ url: String(url), body: JSON.parse(o.body) });
    if (String(url).includes("analyticsdata")) return jsonRes({ rowCount: 2, totals: [{ metricValues: [{ value: "120" }, { value: "80" }, { value: "100" }] }],
      rows: [{ dimensionValues: [{ value: "/" }], metricValues: [{ value: "90" }, { value: "60" }, { value: "75" }] }, { dimensionValues: [{ value: "/boilers" }], metricValues: [{ value: "30" }, { value: "20" }, { value: "25" }] }] });
    return jsonRes({ rows: (JSON.parse(o.body).dimensions || []).length ? [] : [{ keys: [], clicks: 4, impressions: 90, ctr: 0.04, position: 9 }] });
  };
  let asked = 0;
  const site = async () => ({ id: "A", url: "https://plumber.test/" });
  const h = makeSearchSnapshotHandler({ store, siteOf: site, getToken: async () => "sa-token", allowed: async () => { asked++; return false; }, boundOf: async () => ({ gscProperty: "https://plumber.test/", ga4Property: "properties/111" }), fetchImpl, now: () => NOW });
  const out = await h({ siteId: "A" });
  assert.equal(asked, 0, "a bound property needs no admin confirmation");
  assert.match(out.evidence[0], /Search Console https:\/\/plumber\.test\/.*4 clicks.*property connected in the portal/);
  assert.match(out.evidence[1], /Analytics properties\/111: 120 visits, 2 landing pages stored/);
  assert.ok(calls.filter((c) => c.url.includes("webmasters")).every((c) => c.url.includes(encodeURIComponent("https://plumber.test/"))), "only the bound property");
  const ga = store.readMemory("A").find((m) => m.key === "analytics").value;
  assert.deepEqual(ga.totals, { sessions: 120, engagedSessions: 80, users: 100 }); assert.equal(analyticsForAgents(ga).landingPages[1].path, "/boilers");
  const lost = makeSearchSnapshotHandler({ store, siteOf: site, getToken: async () => "t", boundOf: async () => ({ gscProperty: "sc-domain:plumber.test", ga4Property: null }),
    fetchImpl: async () => jsonRes({ error: { message: "User does not have sufficient permission" } }, 403), now: () => NOW });
  assert.match((await lost({ siteId: "A" })).escalate, /can no longer read sc-domain:plumber\.test.*Check access/);
  // Nothing bound: the D34 path (admin confirmation) as before; no key at all: not connected.
  const d34 = makeSearchSnapshotHandler({ store, siteOf: site, getToken: async () => "t", allowed: async () => false, boundOf: async () => null, fetchImpl, now: () => NOW });
  assert.match((await d34({ siteId: "A" })).evidence[0], /no property is connected to this website and a platform admin has not confirmed it/);
  assert.match((await makeSearchSnapshotHandler({ store, siteOf: site, getToken: null, fetchImpl, now: () => NOW })({ siteId: "A" })).evidence[0], /no Google key/);
  const ga4only = makeSearchConsoleHandler({ store, siteOf: site, getToken: async () => "t", boundOf: async () => ({ gscProperty: null, ga4Property: "properties/1" }), fetchImpl, now: () => NOW });
  assert.match((await ga4only({ siteId: "A" })).evidence[0], /no property is connected/);
});

test("planning: the daily read is created only for a site that can be read (no job just to say 'not connected')", async () => {
  const store = new MemoryStore(); store.sites = [{ id: "A", url: "https://a.test/" }, { id: "B", url: "https://b.test/" }];
  const h = async () => ({ evidence: [] }); h.applies = async (id) => id === "A";
  const r = await tick({ store, handlers: { search_snapshot: h }, now: "2026-11-30T12:00:00Z", maxJobs: 0 });
  assert.deepEqual(r.sites.map((x) => x.queued.some((q) => q.kind === "search_snapshot")), [true, false]);
  const failing = async () => ({}); failing.applies = async () => { throw new Error("db down"); };
  const r2 = await tick({ store: new MemoryStore(), sites: [{ id: "C", url: "https://c.test/" }], handlers: { search_snapshot: failing }, now: "2026-11-30T12:00:00Z", maxJobs: 0 });
  assert.ok(!r2.sites[0].queued.some((q) => q.kind === "search_snapshot"), "unknown counts as no");
});

test("Worker: /google/* is served by the access routes; the old OAuth paths are gone; internal routes keep their token check", async (t) => {
  const real = globalThis.fetch; t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = async () => jsonRes(null);
  const env = { ...ENV, INTERNAL_TOKEN: "t".repeat(32) };
  assert.deepEqual(await (await handler.fetch(req("/google/account"), env)).json(), { ok: true, email: "seo-reader@proj.iam.gserviceaccount.com" });
  assert.equal((await handler.fetch(req("/oauth/google/start?state=x"), env)).status, 404);
  assert.equal((await handler.fetch(new Request(`${ORIGIN}/internal/run-job`, { method: "POST" }), env)).status, 403);
});
