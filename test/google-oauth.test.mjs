// Connect with Google (D56): the Worker's OAuth routes (start, callback, property lists, disconnect), token refresh and
// revoke, and the hosted Search Console and GA4 reads with a site's own connection. Mocked Google and RPC; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { googleRoute, pkceChallenge, authUrl, oauthConfig, idTokenEmail, makeGoogleAccess, listProperties, SCOPES, GSC_SCOPE, GA_SCOPE } from "../src/god/google-oauth.mjs";
import { makeSearchSnapshotHandler, makeSearchConsoleHandler, analyticsForAgents } from "../src/god/search-console.mjs";
import { MemoryStore } from "../src/god/stores.mjs";
import { handler } from "../cloud/worker/src/app.mjs";

const ENV = { GOOGLE_OAUTH_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_OAUTH_CLIENT_SECRET: "client-secret-value", PORTAL_URL: "https://portal.test/" };
const ORIGIN = "https://seo-god.x.workers.dev";
const STATE = "a".repeat(64), SITE = "11111111-1111-4111-8111-111111111111", USER = "00000000-0000-0000-0000-00000000000a";
const idToken = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const jsonRes = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });

/** A Google stand-in and an RPC stand-in, recording every call. */
function world({ scope = SCOPES.join(" "), refresh = "refresh-token-xyz", tokenError = null, gaFails = false, target = { refreshToken: "stored-refresh", gscProperty: "sc-domain:plumber.test", ga4Property: "properties/111", email: "o@p.test" } } = {}) {
  const calls = [], rpcs = [];
  const fetchImpl = async (url, o = {}) => {
    const u = String(url), body = o.body ? String(o.body) : "";
    calls.push({ url: u, body, auth: o.headers?.Authorization || null });
    if (u === "https://oauth2.googleapis.com/token") {
      const p = new URLSearchParams(body);
      if (tokenError) return jsonRes({ error: tokenError, error_description: "Token has been expired or revoked." }, tokenError === "server" ? 500 : 400);
      if (p.get("grant_type") === "refresh_token") return jsonRes({ access_token: "fresh-access", expires_in: 3599, scope });
      return jsonRes({ access_token: "access-1", refresh_token: refresh, scope, id_token: idToken({ email: "owner@plumber.test", email_verified: true }) });
    }
    if (u === "https://oauth2.googleapis.com/revoke") return jsonRes({});
    if (u === "https://www.googleapis.com/webmasters/v3/sites") return jsonRes({ siteEntry: [{ siteUrl: "sc-domain:plumber.test", permissionLevel: "siteOwner" }, { siteUrl: "https://other.test/", permissionLevel: "siteUnverifiedUser" }] });
    if (u.startsWith("https://analyticsadmin.googleapis.com/v1beta/accountSummaries")) return gaFails ? jsonRes({ error: { message: "Google Analytics Admin API has not been used in project" } }, 403)
      : jsonRes({ accountSummaries: [{ displayName: "Plumber", propertySummaries: [{ property: "properties/111", displayName: "Plumber web" }, { property: "bad", displayName: "x" }] }] });
    return jsonRes({ error: { message: "unexpected " + u } }, 500);
  };
  const call = async (fn, args) => {
    rpcs.push({ fn, args });
    if (fn === "google_oauth_peek") return args.p_state === STATE ? { verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" } : null;
    if (fn === "google_oauth_take") return args.p_state === STATE ? { site: SITE, user: USER, verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", siteUrl: "https://plumber.test/" } : null;
    if (fn === "google_target") return target;
    if (fn === "google_set_choices") return { gscProperty: "sc-domain:plumber.test", ga4Property: null };
    return { ok: true };
  };
  return { fetchImpl, call, calls, rpcs };
}
const get = (path) => new Request(`${ORIGIN}${path}`);
const post = (path, body, origin = "https://portal.test") => new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });

test("PKCE S256 matches RFC 7636; the consent address asks for read-only scopes, offline access and consent", async () => {
  assert.equal(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const cfg = oauthConfig(ENV, ORIGIN);
  assert.equal(cfg.redirectUri, `${ORIGIN}/oauth/google/callback`);
  assert.equal(oauthConfig({ ...ENV, GOOGLE_OAUTH_REDIRECT_URI: "https://x.test/cb" }, ORIGIN).redirectUri, "https://x.test/cb");
  assert.equal(oauthConfig({ GOOGLE_OAUTH_CLIENT_ID: "x" }), null, "no secret, no OAuth");
  const u = new URL(await authUrl(cfg, { state: STATE, verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" }));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly");
  for (const [k, v] of [["access_type", "offline"], ["prompt", "consent"], ["code_challenge_method", "S256"], ["code_challenge", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"], ["state", STATE], ["response_type", "code"]]) assert.equal(u.searchParams.get(k), v, k);
  assert.ok(!u.toString().includes("client-secret-value"), "the secret never goes to the browser");
  assert.equal(idTokenEmail(idToken({ email: "a@b.test", email_verified: false })), null, "unverified email ignored");
  assert.equal(idTokenEmail("garbage"), null);
});

test("start: refuses without setup or with an unknown state; redirects to Google with the verifier's challenge", async () => {
  const w = world();
  assert.equal((await googleRoute(get(`/oauth/google/start?state=${STATE}`), { env: {}, fetchImpl: w.fetchImpl, call: w.call })).status, 503);
  assert.equal(await googleRoute(get("/health"), { env: ENV, fetchImpl: w.fetchImpl, call: w.call }), null, "other paths are not ours");
  const bad = await googleRoute(get(`/oauth/google/start?state=${"b".repeat(64)}`), { env: ENV, fetchImpl: w.fetchImpl, call: w.call });
  assert.equal(bad.status, 400); assert.match(await bad.text(), /expired or was already used/);
  const odd = await googleRoute(get("/oauth/google/start?state=<script>"), { env: ENV, fetchImpl: w.fetchImpl, call: w.call });
  assert.equal(odd.status, 400); assert.equal(w.rpcs.filter((r) => r.args.p_state === "<script>").length, 0, "malformed states never reach the database");
  const r = await googleRoute(get(`/oauth/google/start?state=${STATE}`), { env: ENV, fetchImpl: w.fetchImpl, call: w.call });
  assert.equal(r.status, 302); assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.match(r.headers.get("location"), /code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM/);
  assert.deepEqual(w.rpcs.filter((x) => x.fn === "google_oauth_take"), [], "start does not use the state up");
});

test("callback: exchanges the code with secret and verifier, lists properties, keeps the token pending, returns to the portal", async () => {
  const w = world();
  const r = await googleRoute(get(`/oauth/google/callback?state=${STATE}&code=auth-code-1&scope=x`), { env: ENV, fetchImpl: w.fetchImpl, call: w.call });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), `https://portal.test/?google_state=${STATE}`);
  const ex = new URLSearchParams(w.calls.find((c) => c.url.endsWith("/token")).body);
  assert.deepEqual([ex.get("grant_type"), ex.get("code"), ex.get("code_verifier"), ex.get("client_secret"), ex.get("redirect_uri")], ["authorization_code", "auth-code-1", "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "client-secret-value", `${ORIGIN}/oauth/google/callback`]);
  assert.equal(w.rpcs[0].fn, "google_oauth_take"); assert.equal(w.rpcs[0].args.p_purpose, "connect");
  const p = w.rpcs.find((x) => x.fn === "google_oauth_pending").args;
  assert.equal(p.p_refresh_token, "refresh-token-xyz"); assert.equal(p.p_email, "owner@plumber.test");
  assert.deepEqual(p.p_scopes, SCOPES);
  assert.deepEqual(p.p_choices.sites, [{ url: "sc-domain:plumber.test", level: "siteOwner" }], "unverified properties are not offered");
  assert.deepEqual(p.p_choices.ga4, [{ id: "properties/111", name: "Plumber web", account: "Plumber" }]);
  assert.ok(w.calls.filter((c) => c.url.includes("googleapis.com/") && !c.url.includes("oauth2")).every((c) => c.auth === "Bearer access-1"), "lists read with the new access token");
  assert.ok(!r.headers.get("location").includes("refresh"), "no token in the redirect");
});

test("callback: a used or unknown state, a denial, missing scopes, a failed exchange or Analytics not enabled", async () => {
  const w = world();
  assert.equal((await googleRoute(get(`/oauth/google/callback?state=${"c".repeat(64)}&code=x`), { env: ENV, fetchImpl: w.fetchImpl, call: w.call })).status, 400);
  const denied = await googleRoute(get(`/oauth/google/callback?state=${STATE}&error=access_denied`), { env: ENV, fetchImpl: w.fetchImpl, call: w.call });
  assert.equal(denied.headers.get("location"), "https://portal.test/?google=denied");
  assert.equal(w.calls.length, 0, "no call to Google after a denial");
  const none = world({ scope: "openid email" });
  const r = await googleRoute(get(`/oauth/google/callback?state=${STATE}&code=c`), { env: ENV, fetchImpl: none.fetchImpl, call: none.call });
  assert.equal(r.headers.get("location"), "https://portal.test/?google=scopes");
  assert.ok(none.calls.some((c) => c.url.endsWith("/revoke")), "a useless grant is revoked at once");
  assert.ok(!none.rpcs.some((x) => x.fn === "google_oauth_pending"));
  const gscOnly = world({ scope: `openid email ${GSC_SCOPE}`, gaFails: true });
  assert.equal((await googleRoute(get(`/oauth/google/callback?state=${STATE}&code=c`), { env: ENV, fetchImpl: gscOnly.fetchImpl, call: gscOnly.call })).headers.get("location"), `https://portal.test/?google_state=${STATE}`);
  assert.match(gscOnly.rpcs.find((x) => x.fn === "google_oauth_pending").args.p_choices.errors[0], /^Analytics: Google Analytics Admin API has not been used/);
  const broken = world({ tokenError: "invalid_grant" });
  assert.equal((await googleRoute(get(`/oauth/google/callback?state=${STATE}&code=c`), { env: ENV, fetchImpl: broken.fetchImpl, call: broken.call })).headers.get("location"), "https://portal.test/?google=error");
  const noRefresh = world({ refresh: null });
  assert.equal((await googleRoute(get(`/oauth/google/callback?state=${STATE}&code=c`), { env: ENV, fetchImpl: noRefresh.fetchImpl, call: noRefresh.call })).headers.get("location"), "https://portal.test/?google=norefresh");
});

test("property lists and disconnect: CORS for the portal only, the token stays on the server, revoke before removal", async () => {
  const w = world();
  const pre = await googleRoute(new Request(`${ORIGIN}/oauth/google/properties`, { method: "OPTIONS" }), { env: ENV, fetchImpl: w.fetchImpl, call: w.call });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get("access-control-allow-origin"), "https://portal.test");
  assert.equal((await googleRoute(post("/oauth/google/properties", { state: "x" }), { env: ENV, fetchImpl: w.fetchImpl, call: w.call })).status, 400);
  const r = await googleRoute(post("/oauth/google/properties", { state: STATE }), { env: ENV, fetchImpl: w.fetchImpl, call: w.call });
  const j = await r.json();
  assert.deepEqual({ ok: j.ok, sites: j.sites, ga4: j.ga4, gscProperty: j.gscProperty }, { ok: true, sites: 1, ga4: 1, gscProperty: "sc-domain:plumber.test" });
  assert.ok(!JSON.stringify(j).includes("refresh") && !JSON.stringify(j).includes("access"), "no token in the answer");
  assert.equal(w.rpcs[0].args.p_purpose, "list");
  assert.equal(new URLSearchParams(w.calls[0].body).get("refresh_token"), "stored-refresh");
  assert.ok(w.rpcs.some((x) => x.fn === "record_integration_status" && x.args.p_ok === true));
  const revoked = world({ tokenError: "invalid_grant" });
  const rr = await googleRoute(post("/oauth/google/properties", { state: STATE }), { env: ENV, fetchImpl: revoked.fetchImpl, call: revoked.call });
  assert.equal(rr.status, 502); assert.match((await rr.json()).error, /stopped working/);
  assert.ok(revoked.rpcs.some((x) => x.fn === "record_integration_status" && x.args.p_ok === false && /invalid_grant/.test(x.args.p_error)));
  const d = world();
  const dr = await (await googleRoute(post("/oauth/google/disconnect", { state: STATE }), { env: ENV, fetchImpl: d.fetchImpl, call: d.call })).json();
  assert.deepEqual(dr, { ok: true, revokedAtGoogle: true });
  assert.equal(new URLSearchParams(d.calls.find((c) => c.url.endsWith("/revoke")).body).get("token"), "stored-refresh");
  assert.deepEqual(d.rpcs.map((x) => x.fn), ["google_oauth_take", "google_target", "google_oauth_remove"]);
  assert.deepEqual(d.rpcs[2].args, { p_site: SITE, p_user: USER });
});

test("job access: a fresh token per site, cached; a revoked grant is reported and stops; Google being down retries", async () => {
  const w = world();
  const access = makeGoogleAccess({ cfg: oauthConfig(ENV), call: w.call, fetchImpl: w.fetchImpl });
  assert.deepEqual(await access(SITE), { token: "fresh-access", property: "sc-domain:plumber.test", ga4Property: "properties/111", email: "o@p.test" });
  await access(SITE); assert.equal(w.calls.length, 1, "cached within the invocation");
  assert.equal(await makeGoogleAccess({ cfg: oauthConfig(ENV), call: world({ target: null }).call, fetchImpl: w.fetchImpl })(SITE), null, "no connection");
  const bad = world({ tokenError: "invalid_grant" });
  assert.deepEqual(await makeGoogleAccess({ cfg: oauthConfig(ENV), call: bad.call, fetchImpl: bad.fetchImpl })(SITE), { error: "invalid_grant" });
  assert.ok(bad.rpcs.some((x) => x.fn === "record_integration_status" && x.args.p_provider === "google"));
  const down = world({ tokenError: "server" });
  await assert.rejects(makeGoogleAccess({ cfg: oauthConfig(ENV), call: down.call, fetchImpl: down.fetchImpl })(SITE));
});

test("hosted reads with the site's Google connection: chosen property only, no admin confirmation, GA4 stored for the agents", async () => {
  const NOW = "2026-11-30T12:00:00Z", store = new MemoryStore(), calls = [];
  const fetchImpl = async (url, o) => {
    calls.push({ url: String(url), body: JSON.parse(o.body), auth: o.headers.Authorization });
    if (String(url).includes("analyticsdata")) return jsonRes({ rowCount: 2, totals: [{ metricValues: [{ value: "120" }, { value: "80" }, { value: "100" }] }],
      rows: [{ dimensionValues: [{ value: "/" }], metricValues: [{ value: "90" }, { value: "60" }, { value: "75" }] }, { dimensionValues: [{ value: "/boilers" }], metricValues: [{ value: "30" }, { value: "20" }, { value: "25" }] }] });
    return jsonRes({ rows: (JSON.parse(o.body).dimensions || []).length ? [] : [{ keys: [], clicks: 4, impressions: 90, ctr: 0.04, position: 9 }] });
  };
  const oauthOf = async () => ({ token: "site-token", property: "https://plumber.test/", ga4Property: "properties/111" });
  let asked = 0;
  const h = makeSearchSnapshotHandler({ store, siteOf: async () => ({ id: "A", url: "https://plumber.test/" }), getToken: null, allowed: async () => { asked++; return false; }, oauthOf, fetchImpl, now: () => NOW });
  const out = await h({ siteId: "A" });
  assert.equal(asked, 0, "no admin confirmation for a site the customer connected");
  assert.match(out.evidence[0], /Search Console https:\/\/plumber\.test\/.*4 clicks.*the site's own Google connection/);
  assert.match(out.evidence[1], /Analytics properties\/111: 120 visits, 2 landing pages stored/);
  assert.ok(calls.every((c) => c.auth === "Bearer site-token"));
  assert.ok(calls.filter((c) => c.url.includes("webmasters")).every((c) => c.url.includes(encodeURIComponent("https://plumber.test/"))), "only the chosen property");
  const ga = store.readMemory("A").find((m) => m.key === "analytics").value;
  assert.deepEqual(ga.totals, { sessions: 120, engagedSessions: 80, users: 100 }); assert.equal(ga.from, "2026-10-31");
  assert.equal(analyticsForAgents(ga).landingPages[1].path, "/boilers");
  // The chosen property stops answering: escalate with what to do, never fall back to other forms.
  const lost = makeSearchSnapshotHandler({ store, siteOf: async () => ({ id: "A", url: "https://plumber.test/" }), getToken: null, oauthOf: async () => ({ token: "t", property: "sc-domain:plumber.test", ga4Property: null }),
    fetchImpl: async () => jsonRes({ error: { message: "User does not have sufficient permission" } }, 403), now: () => NOW });
  assert.match((await lost({ siteId: "A" })).escalate, /connected for this website cannot read sc-domain:plumber\.test any more/);
  // Broken connection, nothing chosen, nothing connected at all.
  const mk = (o, getToken = null) => makeSearchSnapshotHandler({ store, siteOf: async () => ({ id: "A", url: "https://plumber.test/" }), getToken, oauthOf: async () => o, fetchImpl, now: () => NOW });
  assert.match((await mk({ error: "invalid_grant" })({ siteId: "A" })).escalate, /stopped working \(invalid_grant\)/);
  assert.match((await mk({ token: "t", property: null, ga4Property: null })({ siteId: "A" })).evidence[0], /no Search Console or Analytics property is chosen/);
  assert.match((await mk(null)({ siteId: "A" })).evidence[0], /Connect with Google/);
  // Measurement job: same access rule.
  const m = makeSearchConsoleHandler({ store, siteOf: async () => ({ id: "A", url: "https://plumber.test/" }), getToken: null, oauthOf: async () => ({ token: "t", property: null }), fetchImpl, now: () => NOW });
  assert.match((await m({ siteId: "A" })).evidence[0], /no Search Console property is chosen/);
});

test("Worker: /oauth/google/* is served by the Google routes; internal routes keep their token check", async (t) => {
  const real = globalThis.fetch; t.after(() => { globalThis.fetch = real; });
  const seen = [];
  globalThis.fetch = async (url, o) => { seen.push(String(url)); return jsonRes(String(url).endsWith("/rpc/google_oauth_peek") ? { verifier: "v".repeat(64) } : null); };
  const env = { ...ENV, SUPABASE_URL: "https://ref.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", INTERNAL_TOKEN: "t".repeat(32) };
  const r = await handler.fetch(get(`/oauth/google/start?state=${STATE}`), env);
  assert.equal(r.status, 302); assert.match(r.headers.get("location"), /^https:\/\/accounts\.google\.com\//);
  assert.deepEqual(seen, ["https://ref.supabase.co/rest/v1/rpc/google_oauth_peek"]);
  assert.equal((await handler.fetch(new Request(`${ORIGIN}/internal/run-job`, { method: "POST" }), env)).status, 403);
  assert.equal((await handler.fetch(get(`/oauth/google/start?state=${STATE}`), { ...env, PORTAL_URL: "" })).status, 503, "no portal to return to: not offered");
});

test("listProperties follows Analytics pages and keeps only GA4 property ids", async () => {
  let n = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("webmasters")) return jsonRes({});
    n++; return jsonRes(n === 1 ? { accountSummaries: [{ displayName: "A", propertySummaries: [{ property: "properties/1", displayName: "One" }] }], nextPageToken: "p2" } : { accountSummaries: [{ displayName: "B", propertySummaries: [{ property: "properties/2" }] }] });
  };
  const l = await listProperties(oauthConfig(ENV), { token: "t", fetchImpl });
  assert.deepEqual(l.ga4.map((g) => g.id), ["properties/1", "properties/2"]); assert.equal(l.ga4[1].name, "properties/2");
  assert.deepEqual(l.sites, []); assert.deepEqual(l.errors, []);
  assert.ok(GA_SCOPE.endsWith("analytics.readonly"));
});

test("planning: the daily read is created only for a site that can be read (no job just to say 'not connected')", async () => {
  const { tick } = await import("../src/god/tick.mjs");
  const store = new MemoryStore(); store.sites = [{ id: "A", url: "https://a.test/" }, { id: "B", url: "https://b.test/" }];
  const h = async () => ({ evidence: [] }); h.applies = async (id) => id === "A";
  const r = await tick({ store, handlers: { search_snapshot: h }, now: "2026-11-30T12:00:00Z", maxJobs: 0 });
  assert.deepEqual(r.sites.map((x) => x.queued.some((q) => q.kind === "search_snapshot")), [true, false]);
  const failing = async () => ({}); failing.applies = async () => { throw new Error("db down"); };
  const r2 = await tick({ store: new MemoryStore(), sites: [{ id: "C", url: "https://c.test/" }], handlers: { search_snapshot: failing }, now: "2026-11-30T12:00:00Z", maxJobs: 0 });
  assert.ok(!r2.sites[0].queued.some((q) => q.kind === "search_snapshot"), "unknown counts as no");
});
