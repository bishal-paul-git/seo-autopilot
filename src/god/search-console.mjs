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

/** A read-only Search Console access token from a service account key (JSON text). */
export async function googleToken(keyJson, { fetchImpl = (...a) => fetch(...a), now = Date.now() } = {}) {
  const key = typeof keyJson === "string" ? JSON.parse(keyJson) : keyJson;
  if (!key?.client_email || !key?.private_key) throw new Error("Google key is missing client_email or private_key");
  const iat = Math.floor(now / 1000), aud = key.token_uri || "https://oauth2.googleapis.com/token";
  const unsigned = `${b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64u(JSON.stringify({ iss: key.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud, iat, exp: iat + 3600 }))}`;
  const der = Uint8Array.from(atob(String(key.private_key).replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, new TextEncoder().encode(unsigned));
  const r = await fetchImpl(aud, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64uBytes(sig)}` }).toString() });
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
export function makeSearchConsoleHandler({ store, siteOf, getToken, fetchImpl = (...a) => fetch(...a), now = () => new Date().toISOString(), allowed = async () => true }) {
  return async (job) => {
    // The shared Google account may read only sites a platform admin confirmed (D34): a domain added by an agency that
    // does not own it must never be read with access its real owner granted.
    if (!(await allowed(job.siteId))) return { evidence: ["Search Console not used: a platform admin has not confirmed this site (set_gsc_allowed)"] };
    const site = await siteOf(job.siteId);
    const memory = (await store.readMemory(job.siteId, "experiment")) || [];
    const due = trafficDue(memory.map((m) => m.value), now());
    if (!due.length) return { evidence: ["no accepted advice is ready to measure yet"] };
    const token = await getToken();
    const host = new URL(site.url).hostname.replace(/^www\./, "");
    const from = addDays(day(Math.min(...due.map((e) => Date.parse(e.openedAt)))), -SPAN - 1), to = addDays(day(Date.parse(now())), -2);
    // The property the owner shared with us: the domain property first, then the address prefix.
    const f = await findProperty(fetchImpl, token, site.url, { startDate: from, endDate: to, dimensions: ["date"], rowLimit: 500 });
    if (!f.property) return { escalate: noAccessMessage({ host, visible: f.visible }), evidence: [], costUsd: 0 };
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

async function findProperty(fetchImpl, token, siteUrl, body) {
  const host = new URL(siteUrl).hostname.replace(/^www\./, "");
  for (const p of propertyCandidates(siteUrl)) {
    try { return { property: p, rows: await query(fetchImpl, token, p, body) }; }
    catch (e) { if (![403, 404].includes(e.status)) throw e; }
  }
  return { property: null, rows: null, host, visible: await visibleProperties(fetchImpl, token) };
}

/** The escalation when no property matches: names what the account can see, so the owner knows what to fix. */
export const noAccessMessage = ({ host, visible = [] }) => `Search Console: the service account has no access to ${host}; the site owner must add it as a user (Restricted) on the ${host} property` +
  (visible.length ? `. It can see: ${visible.slice(0, 10).join(", ")}` : ". It can see no properties at all yet: check the email that was added");

export const SNAPSHOT_DAYS = 28, SNAPSHOT_PAGES = 250, SNAPSHOT_QUERIES = 100, SNAPSHOT_PAIRS = 250;
const r4 = (x) => Number(Number(x || 0).toFixed(4)), r1 = (x) => Number(Number(x || 0).toFixed(1));
const rowOf = (x) => ({ clicks: x.clicks || 0, impressions: x.impressions || 0, ctr: r4(x.ctr), position: r1(x.position) });

/**
 * The "search_snapshot" job (Phase 3, D47): the last 28 days of Search Console for the agents to read, stored in the
 * site's memory as report "search_console": totals, the top pages, the top queries and which page each top query
 * lands on (page + query pairs, D52). Four small queries, read-only.
 */
export function makeSearchSnapshotHandler({ store, siteOf, getToken, fetchImpl = (...a) => fetch(...a), now = () => new Date().toISOString(), allowed = async () => true }) {
  return async (job) => {
    if (!(await allowed(job.siteId))) return { evidence: ["Search Console not used: a platform admin has not confirmed this site (set_gsc_allowed)"] };
    const site = await siteOf(job.siteId);
    const token = await getToken();
    const to = addDays(day(Date.parse(now())), -LAG), from = addDays(to, -(SNAPSHOT_DAYS - 1));
    const found = await findProperty(fetchImpl, token, site.url, { startDate: from, endDate: to, rowLimit: 1 });
    if (!found.property) return { escalate: noAccessMessage(found), evidence: [], costUsd: 0 };
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
    return { evidence: [`Search Console ${property}, ${from} to ${to}: ${totals.clicks} clicks, ${totals.impressions} impressions; ${value.pages.length} pages and ${value.queries.length} queries stored for the agents`] };
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
