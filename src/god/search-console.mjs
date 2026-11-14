// Search Console for hosted sites (Q11, D33): measures whether accepted advice changed clicks, using the CLI's own
// experiment method (src/analysis/experiments.mjs: 14 days after vs 14 days before, adjusted by a control group).
// Runs in the Cloudflare Worker (10 ms CPU, 50 requests), so it never downloads the site's full page x date data:
// one small query per page under test (that page's daily rows) plus one for the site's daily totals; the control
// group is the rest of the site (totals minus the page). A Google service account the site owner added as a user on
// their Search Console property signs in with Web Crypto (works in Node and Workers). Read-only scope.
import { evaluate, controlGroup } from "../analysis/experiments.mjs";

const day = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => day(Date.parse(`${d}T00:00:00Z`) + n * 864e5);
export const LAG = 3, SPAN = 14, MAX_ITEMS = 10;

const b64u = (b) => { const s = typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b)); return btoa(unescape(encodeURIComponent(s))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"); };
const b64uBytes = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** A read-only access token from a service account key (JSON text); Search Console by default, GA4 too when asked (D56). */
export async function googleToken(keyJson, { fetchImpl = (...a) => fetch(...a), now = Date.now(), scopes = ["https://www.googleapis.com/auth/webmasters.readonly"], tokenUrl = null } = {}) {
  const key = typeof keyJson === "string" ? JSON.parse(keyJson) : keyJson;
  if (!key?.client_email || !key?.private_key) throw new Error("Google key is missing client_email or private_key");
  const iat = Math.floor(now / 1000), aud = key.token_uri || "https://oauth2.googleapis.com/token";
  const unsigned = `${b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64u(JSON.stringify({ iss: key.client_email, scope: scopes.join(" "), aud, iat, exp: iat + 3600 }))}`;
  const der = Uint8Array.from(atob(String(key.private_key).replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, new TextEncoder().encode(unsigned));
  const r = await fetchImpl(tokenUrl || aud, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64uBytes(sig)}` }).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google sign-in failed: ${j.error_description || j.error || r.status}`);
  return j.access_token;
}

/** Experiments with items whose 14-day after-window has completed and that have no traffic result yet. */
export function trafficDue(experiments, now) {
  const ready = day(Date.parse(now) - (LAG + SPAN) * 864e5);
  return experiments.filter((e) => String(e.openedAt).slice(0, 10) <= ready && (e.items || []).some((it) => it.href && !it.traffic));
}

async function query(fetchImpl, token, property, body) {
  const r = await fetchImpl(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) { const e = new Error(j.error?.message || `Search Console HTTP ${r.status}`); e.status = r.status; throw e; }
  return j.rows || [];
}
const toSeries = (rows) => Object.fromEntries(rows.map((x) => [x.keys[0], [x.clicks, x.impressions, Number(Number(x.position).toFixed(1))]]));

/**
 * The "search_console" job: for accepted advice whose after-window is complete, read Search Console and store a
 * traffic verdict on each item. deps: { store, siteOf, getToken: async () => token, fetchImpl, now }.
 */
export function makeSearchConsoleHandler({ store, siteOf, getToken, fetchImpl = (...a) => fetch(...a), now = () => new Date().toISOString(), allowed = async () => true, boundOf = null }) {
  return async (job) => {
    const a = await searchAccess(job, { boundOf, getToken, allowed });
    if (a.stop) return a.stop;
    if (a.bound && !a.candidates.length) return { evidence: ["Search Console: no property is connected to this website yet"] };
    const site = await siteOf(job.siteId);
    const memory = (await store.readMemory(job.siteId, "experiment")) || [];
    const due = trafficDue(memory.map((m) => m.value), now());
    if (!due.length) return { evidence: ["no accepted advice is ready to measure yet"] };
    const token = await a.token();
    const host = new URL(site.url).hostname.replace(/^www\./, "");
    const from = addDays(day(Math.min(...due.map((e) => Date.parse(e.openedAt)))), -SPAN - 1), to = addDays(day(Date.parse(now())), -2);
    // The property the owner chose (Google connection), else every form the owner may have shared with the service account.
    const f = await findProperty(fetchImpl, token, site.url, { startDate: from, endDate: to, dimensions: ["date"], rowLimit: 500 }, a.candidates || undefined);
    if (!f.property) return { escalate: a.bound ? lostAccess(a.candidates[0]) : noAccessMessage({ host, visible: f.visible }), evidence: [], costUsd: 0 };
    const property = f.property, total = f.rows;
    const siteSeries = toSeries(total), today = day(Date.parse(now()));
    let measured = 0;
    const updates = [];
    for (const exp of due) {
      const items = [];
      for (const it of exp.items) {
        if (!it.href || it.traffic || measured >= MAX_ITEMS) { items.push(it); continue; }
        measured++;
        const rows = await query(fetchImpl, token, property, { startDate: from, endDate: to, dimensions: ["date"], dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: it.href }] }], rowLimit: 500 });
        const page = toSeries(rows);
        const rest = Object.fromEntries(Object.entries(siteSeries).map(([d, v]) => { const p = page[d] || [0, 0, 0]; return [d, [Math.max(0, v[0] - p[0]), Math.max(0, v[1] - p[1]), v[2]]]; }));
        const e = { url: it.href, change: it.title, date: String(exp.openedAt).slice(0, 10) };
        const controls = controlGroup(e, { __rest__: rest }, new Set([it.href]), { span: SPAN, lag: LAG, minPages: 1 });
        const r = evaluate(e, { [it.href]: page }, today, { span: SPAN, lag: LAG, controls });
        items.push({ ...it, traffic: { status: r.status, verdict: r.verdict || null, clicksChange: r.clicksChange ?? null, impressionsChange: r.impressionsChange ?? null, adjustedImpressionsChange: r.control?.adjustedImpressionsChange ?? null, before: r.before ? { clicks: r.before.clicks, impressions: r.before.impressions } : null, after: r.after ? { clicks: r.after.clicks, impressions: r.after.impressions } : null, note: r.note || null, property } });
      }
      updates.push({ kind: "experiment", key: `exp:${exp.job}`, value: { ...exp, items }, basis: "verified", confidence: null, source: "search console" });
    }
    if (updates.length) await store.writeMemory(job.siteId, updates);
    return { evidence: [`Search Console ${property}: ${measured} page${measured === 1 ? "" : "s"} measured, 14 days after vs 14 before, against the rest of the site`] };
  };
}

// The property the owner shared with the service account: the domain property first, then the address prefix.
/**
 * Every form an owner may have added the site as: the domain property, then address prefixes with and without www and
 * on https or http. The first live pilot failed because the site was stored as https://erudience.com/ while only one
 * form had been tried besides the domain property.
 */
export function propertyCandidates(siteUrl) {
  const u = new URL(siteUrl), host = u.hostname.replace(/^www\./, "");
  const forms = [`sc-domain:${host}`, new URL("/", siteUrl).toString()];
  for (const proto of ["https:", "http:"]) for (const h of [host, `www.${host}`]) forms.push(`${proto}//${h}/`);
  return [...new Set(forms)];
}

/** The properties the service account can see (for a useful message when none matches); [] when the list fails. */
async function visibleProperties(fetchImpl, token) {
  try {
    const r = await fetchImpl("https://www.googleapis.com/webmasters/v3/sites", { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    return r.ok ? (j.siteEntry || []).map((s) => s.siteUrl).filter(Boolean) : [];
  } catch { return []; }
}

async function findProperty(fetchImpl, token, siteUrl, body, candidates = propertyCandidates(siteUrl)) {
  const host = new URL(siteUrl).hostname.replace(/^www\./, "");
  for (const p of candidates) {
    try { return { property: p, rows: await query(fetchImpl, token, p, body) }; }
    catch (e) { if (![403, 404].includes(e.status)) throw e; }
  }
  return { property: null, rows: null, host, visible: await visibleProperties(fetchImpl, token) };
}

/** The escalation when no property matches: names what the account can see, so the owner knows what to fix. */
export const noAccessMessage = ({ host, visible = [] }) => `Search Console: the service account has no access to ${host}; the site owner must add it as a user (Restricted) on the ${host} property` +
  (visible.length ? `. It can see: ${visible.slice(0, 10).join(", ")}` : ". It can see no properties at all yet: check the email that was added");

/**
 * Which properties a job reads with the shared service account (D56):
 *   - the properties bound to this site (the customer gave the service account access and chose them in the portal; each
 *     property can be bound to one site only, so no admin confirmation is needed);
 *   - otherwise the D34/D53 lookup, only for sites a platform admin confirmed (set_gsc_allowed).
 * Returns { stop } (the job's result) or { token, candidates, ga4, bound }.
 */
export async function searchAccess(job, { boundOf = null, getToken = null, allowed = async () => true }) {
  if (!getToken) return { stop: { evidence: ["Search Console not connected: the service has no Google key"] } };
  const b = boundOf ? await boundOf(job.siteId) : null;
  if (b && (b.gscProperty || b.ga4Property)) return { bound: true, token: getToken, candidates: b.gscProperty ? [b.gscProperty] : [], ga4: b.ga4Property || null };
  if (!(await allowed(job.siteId))) return { stop: { evidence: ["Search Console not used: no property is connected to this website and a platform admin has not confirmed it (set_gsc_allowed)"] } };
  return { bound: false, token: getToken, candidates: null, ga4: null };
}
const lostAccess = (property) => `Search Console: the service account can no longer read ${property}; the owner may have removed it. Add the email shown on the Connections page again (Search Console › Settings › Users and permissions), then press Check access`;

export const SNAPSHOT_DAYS = 28, SNAPSHOT_PAGES = 250, SNAPSHOT_QUERIES = 100, SNAPSHOT_PAIRS = 250;
const r4 = (x) => Number(Number(x || 0).toFixed(4)), r1 = (x) => Number(Number(x || 0).toFixed(1));
const rowOf = (x) => ({ clicks: x.clicks || 0, impressions: x.impressions || 0, ctr: r4(x.ctr), position: r1(x.position) });

/**
 * The "search_snapshot" job (Phase 3, D47): the last 28 days of Search Console for the agents to read, stored in the
 * site's memory as report "search_console": totals, the top pages, the top queries and which page each top query
 * lands on (page + query pairs, D52). Four small queries, read-only.
 */
export function makeSearchSnapshotHandler({ store, siteOf, getToken, fetchImpl = (...a) => fetch(...a), now = () => new Date().toISOString(), allowed = async () => true, boundOf = null, analyticsBase = "" }) {
  return async (job) => {
    const a = await searchAccess(job, { boundOf, getToken, allowed });
    if (a.stop) return a.stop;

    const site = await siteOf(job.siteId);
    const token = await a.token();
    const to = addDays(day(Date.parse(now())), -LAG), from = addDays(to, -(SNAPSHOT_DAYS - 1));
    // D56: GA4 for the property bound to this site, in the same job (one more request, no extra planning).
    const ga = a.ga4 ? await analyticsSnapshot({ fetchImpl, token, property: a.ga4, from, to, now, base: analyticsBase }).then(async (v) => {
      await store.writeMemory(job.siteId, [{ kind: "report", key: "analytics", value: v, basis: "verified", confidence: null, source: "google analytics" }]);
      return `Analytics ${a.ga4}: ${v.totals.sessions} visits, ${v.pages.length} landing pages stored`;
    }, (e) => `Analytics not read: ${String(e.message).slice(0, 160)}`) : null;
    if (a.bound && !a.candidates.length) return { evidence: [ga] };
    const found = await findProperty(fetchImpl, token, site.url, { startDate: from, endDate: to, rowLimit: 1 }, a.candidates || undefined);
    if (!found.property) return { escalate: a.bound ? lostAccess(a.candidates[0]) : noAccessMessage(found), evidence: ga ? [ga] : [], costUsd: 0 };
    const { property } = found, base = { startDate: from, endDate: to };
    const pages = await query(fetchImpl, token, property, { ...base, dimensions: ["page"], rowLimit: SNAPSHOT_PAGES });
    const queries = await query(fetchImpl, token, property, { ...base, dimensions: ["query"], rowLimit: SNAPSHOT_QUERIES });
    const pairs = await query(fetchImpl, token, property, { ...base, dimensions: ["page", "query"], rowLimit: SNAPSHOT_PAIRS });
    const totals = (found.rows || [])[0] ? rowOf(found.rows[0]) : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const value = { property, from, to, days: SNAPSHOT_DAYS, generatedAt: now(), totals,
      pages: pages.map((x) => ({ url: x.keys[0], ...rowOf(x) })), queries: queries.map((x) => ({ query: x.keys[0], ...rowOf(x) })),
      pairs: pairs.filter((x) => x.keys?.length === 2).map((x) => ({ url: x.keys[0], query: x.keys[1], ...rowOf(x) })),
      complete: { pages: pages.length < SNAPSHOT_PAGES, queries: queries.length < SNAPSHOT_QUERIES } };
    await store.writeMemory(job.siteId, [{ kind: "report", key: "search_console", value, basis: "verified", confidence: null, source: "search console" }]);
    return { evidence: [`Search Console ${property}, ${from} to ${to}: ${totals.clicks} clicks, ${totals.impressions} impressions; ${value.pages.length} pages and ${value.queries.length} queries stored for the agents${a.bound ? " (property connected in the portal)" : ""}`, ...(ga ? [ga] : [])] };
  };
}

/** Whether the site's Search Console snapshot is missing or older than a day. */
export function snapshotDue(memory, now) {
  const s = memory.find((m) => m.kind === "report" && m.key === "search_console")?.value;
  return !s?.generatedAt || Date.parse(now) - Date.parse(s.generatedAt) > 20 * 3600e3;
}

/**
 * What an agent sees of the snapshot: totals, every page up to `maxPages` (by impressions), the top queries, and a plain
 * note on what absence means, so a pruner never reads "not listed" as "no traffic" when the list was cut.
 */
export function searchForAgents(s, { maxPages = 120, maxQueries = 40, maxPairs = 60 } = {}) {
  if (!s) return null;
  const pages = [...(s.pages || [])].sort((a, b) => b.impressions - a.impressions).slice(0, maxPages);
  const allPages = (s.complete?.pages ?? false) && pages.length === (s.pages || []).length;
  // Which page each query lands on; without this an agent can only guess the pairing from similar positions.
  const pageQueries = [...(s.pairs || [])].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, maxPairs);
  return { property: s.property, from: s.from, to: s.to, totals: s.totals, pages, queries: (s.queries || []).slice(0, maxQueries),
    pageQueries: s.pairs ? pageQueries : null,
    note: allPages ? "Every page with at least one impression in this period is listed; a page not listed had no impressions." : `Only the top ${pages.length} pages by impressions are listed; a page not listed may still have had impressions.` };
}

export const ANALYTICS_PAGES = 100;
/**
 * GA4 for the agents (D56): visits, engaged visits and users per landing page for the same 28 days as Search Console, one
 * runReport call with the service account (analytics.readonly) on the property bound to the site.
 */
export async function analyticsSnapshot({ fetchImpl, token, property, from, to, now = () => new Date().toISOString(), base = "" }) {
  if (!/^properties\/\d+$/.test(property || "")) throw new Error("not a GA4 property id");
  const r = await fetchImpl(`${base ? `${String(base).replace(/\/$/, "")}/v1beta` : "https://analyticsdata.googleapis.com/v1beta"}/${property}:runReport`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ dateRanges: [{ startDate: from, endDate: to }], dimensions: [{ name: "landingPage" }], metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: ANALYTICS_PAGES, metricAggregations: ["TOTAL"] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `Analytics HTTP ${r.status}`);
  const nums = (m) => (m || []).map((x) => Number(x.value) || 0);
  const [sessions = 0, engagedSessions = 0, users = 0] = nums(j.totals?.[0]?.metricValues);
  const pages = (j.rows || []).map((x) => { const [s, e, u] = nums(x.metricValues); return { path: String(x.dimensionValues?.[0]?.value ?? "").slice(0, 500), sessions: s, engagedSessions: e, users: u }; });
  return { property, from, to, generatedAt: now(), totals: { sessions, engagedSessions, users }, pages, complete: (j.rowCount ?? pages.length) <= ANALYTICS_PAGES };
}

/** What an agent sees of GA4: totals and the top landing pages, with what a missing page means. */
export function analyticsForAgents(a, { maxPages = 40 } = {}) {
  if (!a) return null;
  const pages = (a.pages || []).slice(0, maxPages);
  return { property: a.property, from: a.from, to: a.to, totals: a.totals, landingPages: pages,
    note: `Visits (GA4 sessions) by landing page. Only the top ${pages.length} landing pages are listed; a page not listed may still have had visits. GA4 counts only visitors its tag recorded (consent banners and blockers reduce it).` };
}
