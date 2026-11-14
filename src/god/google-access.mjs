// "Give us read access" for hosted sites (D56): the customer adds the platform's Google service-account email as a user
// of their Search Console property and their GA4 property, then presses Check access. No Google sign-in, no key, no file.
//
//   GET  /google/account          -> { email }: the service account's address, nothing else (public by design)
//   POST /google/check { site }   -> the Search Console properties for THIS site's host and the GA4 properties whose web
//                                    stream is on this host, that the service account can read (Authorization: the
//                                    signed-in portal user's Supabase token, checked by a user-level RPC)
// The service account can see every customer who granted it access, so nothing outside the site's own host is ever
// returned. Choosing a property (bind_google) is done in the database, which allows each property on only ONE site.
// Works in Node and Workers (fetch and Web Crypto only).
import { googleToken } from "./search-console.mjs";

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly", GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const MAX_GA4_CHECKS = 30; // web-stream lookups per check (a Worker has 50 outbound requests per invocation)

/** The service account's email from its key, or null. */
export function serviceEmail(keyJson) {
  try { const k = typeof keyJson === "string" ? JSON.parse(keyJson) : keyJson; return typeof k?.client_email === "string" ? k.client_email : null; } catch { return null; }
}

export const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
/** Same rule as private.gsc_covers: a domain property covers the host and its subdomains; a prefix must be the same host. */
export function gscCovers(siteUrl, p) {
  const h = hostOf(siteUrl), x = String(p || "");
  if (/^sc-domain:/i.test(x)) { const d = x.slice(10).toLowerCase(); return !!h && (h === d || h.endsWith(`.${d}`)); }
  return /^https?:\/\//i.test(x) && !!h && hostOf(x) === h;
}

/**
 * What the service account can read for one site: Search Console properties covering its host, and GA4 properties with a
 * web stream on its host. GA4 properties whose names mention the site are checked first; at most MAX_GA4_CHECKS.
 */
export async function accessFor(siteUrl, { token, fetchImpl, base = {} }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } }, errors = [], host = hostOf(siteUrl), label = host.split(".")[0];
  const get = async (url) => { const r = await fetchImpl(url, auth); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`); return j; };
  let sites = [];
  try { sites = ((await get(`${base.gsc || "https://www.googleapis.com/webmasters/v3"}/sites`)).siteEntry || []).filter((s) => s.siteUrl && s.permissionLevel !== "siteUnverifiedUser" && gscCovers(siteUrl, s.siteUrl)).map((s) => ({ url: s.siteUrl, level: s.permissionLevel || null })); }
  catch (e) { errors.push(`Search Console: ${String(e.message).slice(0, 160)}`); }
  const ga4 = [];
  try {
    const admin = base.ga4 || "https://analyticsadmin.googleapis.com/v1beta", props = [];
    let next = "";
    for (let page = 0; page < 3; page++) {
      const j = await get(`${admin}/accountSummaries?pageSize=200${next ? `&pageToken=${encodeURIComponent(next)}` : ""}`);
      for (const a of j.accountSummaries || []) for (const p of a.propertySummaries || []) if (/^properties\/\d+$/.test(p.property || "")) props.push({ id: p.property, name: String(p.displayName || p.property).slice(0, 120), account: String(a.displayName || "").slice(0, 120) });
      if (!(next = j.nextPageToken)) break;
    }
    const named = (p) => (`${p.name} ${p.account}`.toLowerCase().includes(label) ? 0 : 1);
    for (const p of props.sort((a, b) => named(a) - named(b)).slice(0, MAX_GA4_CHECKS)) {
      const streams = (await get(`${admin}/${p.id}/dataStreams?pageSize=50`).catch(() => ({}))).dataStreams || [];
      if (streams.some((s) => hostOf(s.webStreamData?.defaultUri || "") === host)) ga4.push(p);
    }
    if (props.length > MAX_GA4_CHECKS) errors.push(`Analytics: only ${MAX_GA4_CHECKS} of ${props.length} properties were checked; name the property after the website so it is checked first`);
  } catch (e) { errors.push(`Analytics: ${String(e.message).slice(0, 160)}`); }
  return { sites, ga4, errors };
}

/** Calls an RPC as the signed-in portal user (their Supabase token), so the database decides who may check a site. */
async function asUser(env, fetchImpl, jwt, fn, args) {
  const r = await fetchImpl(`${String(env.SUPABASE_URL).replace(/\/$/, "")}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  const j = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(j?.message || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}

/** The Worker's public Google routes, or null when the path is not one of them. call(fn, args) is a service-role RPC. */
export async function googleAccessRoute(req, { env, fetchImpl, call, base = {} }) {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/google/")) return null;
  const origin = (() => { try { return env.PORTAL_URL ? new URL(env.PORTAL_URL).origin : null; } catch { return null; } })();
  const cors = { "access-control-allow-origin": origin || "null", "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "600", vary: "origin" };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });
  const route = url.pathname.slice("/google/".length), email = serviceEmail(env.GOOGLE_KEY_JSON);
  if (req.method === "OPTIONS" && (route === "account" || route === "check")) return new Response(null, { status: 204, headers: cors });
  if (!email || !origin) return json({ ok: false, error: "Google access is not set up on this service yet" }, 503);
  if (route === "account" && req.method === "GET") return json({ ok: true, email });
  if (route === "check" && req.method === "POST") {
    if (!env.SUPABASE_PUBLISHABLE_KEY) return json({ ok: false, error: "Google access is not set up on this service yet" }, 503);
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const body = await req.json().catch(() => ({}));
    if (!jwt || typeof body.site !== "string" || !/^[0-9a-f-]{36}$/i.test(body.site)) return json({ ok: false, error: "sign in again" }, 401);
    let site;
    try { site = await asUser(env, fetchImpl, jwt, "google_access_site", { p_site: body.site }); }
    catch (e) { return json({ ok: false, error: e.status === 401 ? "sign in again" : "not allowed" }, e.status === 401 ? 401 : 403); }
    if (!site?.url) return json({ ok: false, error: "not allowed" }, 403);
    let token;
    try { token = await googleToken(env.GOOGLE_KEY_JSON, { fetchImpl, scopes: [GSC_SCOPE, GA_SCOPE], tokenUrl: base.token }); }
    catch { return json({ ok: false, error: "Google did not answer: try again" }, 502); }
    const found = await accessFor(site.url, { token, fetchImpl, base });
    const seen = await call("google_access_seen", { p_site: body.site, p_choices: found });
    return json({ ok: true, email, ...seen, errors: found.errors });
  }
  return json({ ok: false, error: "not found" }, 404);
}
