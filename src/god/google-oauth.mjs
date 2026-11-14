// Connect with Google for hosted sites (D56): the OAuth web-server flow in the Worker, so a customer signs in, presses
// Allow and picks their Search Console and GA4 properties instead of making a service account, a JSON key and secrets.
//
//   portal  --google_begin (RPC, signed in)-->  state (one-time, 10 min, PKCE verifier kept in the database)
//   browser --GET /oauth/google/start?state-->  Worker --302--> Google consent (PKCE S256, offline, prompt=consent)
//   Google  --GET /oauth/google/callback?code&state--> Worker: take the state once, exchange the code with the client
//           secret and verifier, list the account's properties, keep the refresh token PENDING in Vault, 302 to the portal
//   portal  --google_confirm (RPC, the same signed-in person)--> the token becomes the site's connection
// The last step is the login-CSRF guard: a sign-in someone else started cannot attach a victim's Google account to the
// other person's site, because only the person who started it can confirm it. The client secret and tokens never reach a
// browser. Read-only scopes. Works in Node and Workers (fetch and Web Crypto only).
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly", GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const SCOPES = ["openid", "email", GSC_SCOPE, GA_SCOPE];
const STATE_RE = /^[a-f0-9]{64}$/;

/** Google's endpoints; `base` replaces them all for local tests only (like GITHUB_API_URL). */
export function endpoints(base = "") {
  if (!base) return { auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", revoke: "https://oauth2.googleapis.com/revoke",
    sites: "https://www.googleapis.com/webmasters/v3/sites", accounts: "https://analyticsadmin.googleapis.com/v1beta/accountSummaries", data: "https://analyticsdata.googleapis.com/v1beta" };
  const b = String(base).replace(/\/$/, "");
  return { auth: `${b}/auth`, token: `${b}/token`, revoke: `${b}/revoke`, sites: `${b}/webmasters/v3/sites`, accounts: `${b}/v1beta/accountSummaries`, data: `${b}/v1beta` };
}

/** OAuth settings from the Worker's secrets and vars, or null when Connect with Google is not set up. */
export function oauthConfig(env, origin = "") {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) return null;
  return { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET, portalUrl: env.PORTAL_URL || "",
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI || `${origin}/oauth/google/callback`, base: env.GOOGLE_API_BASE || "" };
}

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
export async function pkceChallenge(verifier) { return b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))); }

/** Google's consent address for one attempt. */
export async function authUrl(cfg, { state, verifier }) {
  const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent",
    include_granted_scopes: "false", state, code_challenge: await pkceChallenge(verifier), code_challenge_method: "S256" });
  return `${endpoints(cfg.base).auth}?${q}`;
}

/** The email in an ID token received straight from Google's token endpoint over TLS (OpenID Connect: no signature check needed). */
export function idTokenEmail(idToken) {
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(String(idToken).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))));
    return p.email_verified === false ? null : p.email || null;
  } catch { return null; }
}

async function tokenCall(cfg, fetchImpl, params) {
  const r = await fetchImpl(endpoints(cfg.base).token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) { const e = new Error(`Google: ${j.error || `HTTP ${r.status}`}${j.error_description ? `: ${j.error_description}` : ""}`.slice(0, 200)); e.code = j.error || null; e.permanent = ["invalid_grant", "unauthorized_client", "invalid_client"].includes(j.error); throw e; }
  return j;
}

/** Code + verifier -> { accessToken, refreshToken, scopes, email }. */
export async function exchangeCode(cfg, { code, verifier, fetchImpl }) {
  const j = await tokenCall(cfg, fetchImpl, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: cfg.redirectUri });
  return { accessToken: j.access_token, refreshToken: j.refresh_token || null, scopes: String(j.scope || "").split(/\s+/).filter(Boolean), email: idTokenEmail(j.id_token) };
}

/** A fresh access token from the stored refresh token. A revoked grant throws with e.permanent = true. */
export async function refreshAccess(cfg, { refreshToken, fetchImpl }) {
  return (await tokenCall(cfg, fetchImpl, { grant_type: "refresh_token", refresh_token: refreshToken })).access_token;
}

/** Revoke at Google (refresh token: the whole grant). True when Google confirmed or the token was already invalid. */
export async function revoke(cfg, { token, fetchImpl }) {
  try {
    const r = await fetchImpl(endpoints(cfg.base).revoke, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString() });
    if (r.ok) return true;
    const j = await r.json().catch(() => ({}));
    return j.error === "invalid_token";
  } catch { return false; }
}

/** The Search Console properties (verified access only) and GA4 properties the account can read. */
export async function listProperties(cfg, { token, fetchImpl }) {
  const ep = endpoints(cfg.base), auth = { headers: { Authorization: `Bearer ${token}` } }, errors = [];
  const sites = await fetchImpl(ep.sites, auth).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`); return j.siteEntry || []; })
    .catch((e) => { errors.push(`Search Console: ${String(e.message).slice(0, 160)}`); return []; });
  const ga4 = [];
  try {
    let next = "";
    for (let page = 0; page < 3; page++) {
      const r = await fetchImpl(`${ep.accounts}?pageSize=200${next ? `&pageToken=${encodeURIComponent(next)}` : ""}`, auth);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
      for (const a of j.accountSummaries || []) for (const p of a.propertySummaries || []) if (/^properties\/\d+$/.test(p.property || "")) ga4.push({ id: p.property, name: String(p.displayName || p.property).slice(0, 120), account: String(a.displayName || "").slice(0, 120) });
      if (!(next = j.nextPageToken)) break;
    }
  } catch (e) { errors.push(`Analytics: ${String(e.message).slice(0, 160)}`); }
  return { sites: sites.filter((s) => s.siteUrl && s.permissionLevel !== "siteUnverifiedUser").map((s) => ({ url: String(s.siteUrl).slice(0, 300), level: s.permissionLevel || null })).slice(0, 500),
    ga4: ga4.slice(0, 500), errors };
}

/**
 * The site's own Google access for a job: null when the site has no Google connection, { error } when it stopped working
 * (reported on the site's integration so the agency sees it), else { token, property, ga4Property, email }.
 */
export function makeGoogleAccess({ cfg, call, fetchImpl }) {
  const cache = new Map();
  return (siteId) => {
    if (!cache.has(siteId)) cache.set(siteId, (async () => {
      const t = await call("google_target", { p_site: siteId });
      if (!t?.refreshToken) return null;
      try {
        const token = await refreshAccess(cfg, { refreshToken: t.refreshToken, fetchImpl });
        return { token, property: t.gscProperty || null, ga4Property: t.ga4Property || null, email: t.email || null };
      } catch (e) {
        if (!e.permanent) throw e; // Google down or rate limited: the job fails and retries
        await call("record_integration_status", { p_site: siteId, p_provider: "google", p_ok: false, p_error: e.message }).catch(() => {});
        return { error: e.code || "revoked" };
      }
    })());
    return cache.get(siteId);
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (status, msg, portal) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect with Google</title><body style="font:16px system-ui;max-width:560px;margin:60px auto;padding:0 16px"><h1 style="font-size:20px">Connect with Google</h1><p>${esc(msg)}</p>${portal ? `<p><a href="${esc(portal)}">Back to the portal</a></p>` : ""}</body>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-frame-options": "DENY" } });
const redirect = (to) => new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
const portalAt = (cfg, query) => { const u = new URL(cfg.portalUrl); u.search = query; u.hash = ""; return u.toString(); };

/**
 * The Worker's public Google routes, or null when the path is not one of them. call(fn, args) is a service-role RPC.
 *   GET  /oauth/google/start?state=        -> Google consent
 *   GET  /oauth/google/callback            -> pending token, back to the portal with ?google_state= (or ?google=<problem>)
 *   POST /oauth/google/properties {state}  -> refreshed property lists (JSON, CORS for the portal only)
 *   POST /oauth/google/disconnect {state}  -> revoke at Google, then remove
 */
export async function googleRoute(req, { env, fetchImpl, call }) {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/oauth/google/")) return null;
  const cfg = oauthConfig(env, url.origin);
  const allowOrigin = (() => { try { return cfg?.portalUrl ? new URL(cfg.portalUrl).origin : null; } catch { return null; } })();
  const cors = { "access-control-allow-origin": allowOrigin || "null", "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "600", vary: "origin" };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });
  const route = url.pathname.slice("/oauth/google/".length);
  if (!cfg || !allowOrigin) return route === "start" || route === "callback" ? page(503, "Connect with Google is not set up on this service yet. Ask your SEO team.", null) : json({ ok: false, error: "Connect with Google is not set up yet" }, 503);

  if (route === "start" && req.method === "GET") {
    const state = url.searchParams.get("state") || "";
    const p = STATE_RE.test(state) ? await call("google_oauth_peek", { p_state: state }) : null;
    if (!p?.verifier) return page(400, "This link has expired or was already used. Go back to the portal and press Connect with Google again.", cfg.portalUrl);
    return redirect(await authUrl(cfg, { state, verifier: p.verifier }));
  }

  if (route === "callback" && req.method === "GET") {
    const state = url.searchParams.get("state") || "";
    const t = STATE_RE.test(state) ? await call("google_oauth_take", { p_state: state, p_purpose: "connect" }) : null;
    if (!t?.verifier) return page(400, "This sign-in has expired or was already used. Go back to the portal and press Connect with Google again.", cfg.portalUrl);
    if (url.searchParams.get("error")) return redirect(portalAt(cfg, `google=${url.searchParams.get("error") === "access_denied" ? "denied" : "error"}`));
    const code = url.searchParams.get("code");
    if (!code) return redirect(portalAt(cfg, "google=error"));
    let tok;
    try { tok = await exchangeCode(cfg, { code, verifier: t.verifier, fetchImpl }); } catch { return redirect(portalAt(cfg, "google=error")); }
    // Google lets people untick scopes: without Search Console or Analytics the connection is useless, so it is not kept.
    if (!tok.scopes.includes(GSC_SCOPE) && !tok.scopes.includes(GA_SCOPE)) { await revoke(cfg, { token: tok.refreshToken || tok.accessToken, fetchImpl }); return redirect(portalAt(cfg, "google=scopes")); }
    if (!tok.refreshToken) return redirect(portalAt(cfg, "google=norefresh"));
    const choices = await listProperties(cfg, { token: tok.accessToken, fetchImpl });
    try { await call("google_oauth_pending", { p_state: state, p_refresh_token: tok.refreshToken, p_email: tok.email, p_scopes: tok.scopes, p_choices: choices }); }
    catch { await revoke(cfg, { token: tok.refreshToken, fetchImpl }); return redirect(portalAt(cfg, "google=error")); }
    return redirect(portalAt(cfg, `google_state=${state}`));
  }

  if (req.method === "OPTIONS" && (route === "properties" || route === "disconnect")) return new Response(null, { status: 204, headers: cors });
  if (req.method === "POST" && (route === "properties" || route === "disconnect")) {
    const body = await req.json().catch(() => ({}));
    const state = typeof body.state === "string" && STATE_RE.test(body.state) ? body.state : null;
    const t = state ? await call("google_oauth_take", { p_state: state, p_purpose: route === "properties" ? "list" : "disconnect" }) : null;
    if (!t?.site) return json({ ok: false, error: "expired: try again" }, 400);
    const target = await call("google_target", { p_site: t.site });
    if (route === "disconnect") {
      const revoked = target?.refreshToken ? await revoke(cfg, { token: target.refreshToken, fetchImpl }) : false;
      await call("google_oauth_remove", { p_site: t.site, p_user: t.user });
      return json({ ok: true, revokedAtGoogle: revoked });
    }
    if (!target?.refreshToken) return json({ ok: false, error: "Google is not connected for this website" }, 409);
    let token;
    try { token = await refreshAccess(cfg, { refreshToken: target.refreshToken, fetchImpl }); }
    catch (e) {
      if (e.permanent) await call("record_integration_status", { p_site: t.site, p_provider: "google", p_ok: false, p_error: e.message }).catch(() => {});
      return json({ ok: false, error: e.permanent ? "The Google connection stopped working: connect with Google again" : "Google did not answer: try again" }, 502);
    }
    const choices = await listProperties(cfg, { token, fetchImpl });
    const picked = await call("google_set_choices", { p_site: t.site, p_choices: choices });
    await call("record_integration_status", { p_site: t.site, p_provider: "google", p_ok: true }).catch(() => {});
    return json({ ok: true, sites: choices.sites.length, ga4: choices.ga4.length, errors: choices.errors, ...picked });
  }
  return json({ error: "not found" }, 404);
}
