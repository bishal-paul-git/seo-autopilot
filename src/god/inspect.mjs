// Index status for hosted sites (D57): a daily `index_inspect` job asks Google's URL Inspection API about a small
// rotating batch of the site's pages, with the platform's shared service account (D47/D56), for the property bound to
// the site (D56) or found by the Search Console snapshot for an admin-confirmed site (D34). Stored as site memory report
// "inspect" ({ results: { url: { coverage, verdict, ... } } }, the shape the CLI keeps in inspect-state.json), which the
// router, the priority engine, the alert detector and the agents read.
//
// Limits: Google allows 2,000 inspections a day and 600 a minute per property; this asks at most INSPECT_PER_DAY a day,
// four at a time. A Worker invocation has 50 outbound requests, so the batch stays far below that too.
// Permission: inspection needs a Full user (or owner) on the property; a Restricted user gets 403. That is recorded once
// ("needs Full permission"), shown to the agency, and the job is not planned again for BLOCKED_RETRY_DAYS days.
import { searchAccess } from "./search-console.mjs";
import { urlKey, isIndexed } from "../analysis/alerts.mjs";

export const INSPECT_PER_DAY = 20, INSPECT_KEEP = 150, IMPORTANT = 10, RECHECK_IMPORTANT_DAYS = 7, BLOCKED_RETRY_DAYS = 7;
const API = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const DAY = 864e5;

const inspectReport = (memory) => memory.find((m) => m.kind === "report" && m.key === "inspect")?.value ?? null;

/** Due once a day; after a permission refusal, only again after BLOCKED_RETRY_DAYS (the owner may have upgraded access). */
export function inspectDue(memory, now) {
  const r = inspectReport(memory), t = Date.parse(now);
  if (r?.blocked?.at && t - Date.parse(r.blocked.at) < BLOCKED_RETRY_DAYS * DAY) return false;
  return !r?.generatedAt || t - Date.parse(r.generatedAt) > 20 * 3600e3;
}

/**
 * Which pages to inspect today, at most `max`, same host as the site only:
 *   1. the most important pages (home, then top pages by impressions) not inspected in RECHECK_IMPORTANT_DAYS days;
 *   2. pages never inspected: the rest of the Search Console pages by impressions, then pages the scan found;
 *   3. the pages inspected longest ago.
 */
export function inspectBatch({ siteUrl, memory = [], max = INSPECT_PER_DAY, now = new Date().toISOString() }) {
  const host = new URL(siteUrl).hostname.replace(/^www\./, "");
  const same = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname.replace(/^www\./, "") === host; } catch { return false; } };
  const results = inspectReport(memory)?.results || {};
  const seen = new Map(Object.entries(results).map(([u, v]) => [urlKey(u), v.checkedAt || ""]));
  const sc = memory.find((m) => m.kind === "report" && m.key === "search_console")?.value;
  const audit = memory.find((m) => m.kind === "report" && m.key === "audit")?.value;
  const byImp = [...(sc?.pages || [])].sort((a, b) => (b.impressions || 0) - (a.impressions || 0) || (b.clicks || 0) - (a.clicks || 0)).map((p) => p.url);
  const home = new URL("/", siteUrl).toString(), t = Date.parse(now);
  const out = [], taken = new Set();
  const take = (u) => { const k = urlKey(u); if (out.length >= max || taken.has(k) || !same(u)) return; taken.add(k); out.push(u); };
  for (const u of [home, ...byImp].slice(0, IMPORTANT + 1)) { const c = seen.get(urlKey(u)); if (!c || t - Date.parse(c) > RECHECK_IMPORTANT_DAYS * DAY) take(u); }
  for (const u of [...byImp, ...(audit?.crawled || [])]) if (!seen.has(urlKey(u))) take(u);
  for (const [u] of Object.entries(results).sort(([, a], [, b]) => String(a.checkedAt || "").localeCompare(String(b.checkedAt || "")))) take(u);
  return out;
}

// Compact: empty fields are left out, canonicals only when they differ from the page, the previous state only when it
// differs (the planner parses every report on every tick, inside a Worker's few milliseconds of CPU).
const STATE = ["verdict", "coverage", "indexing", "robots"];
function resultOf(url, x, at, old) {
  const r = { checkedAt: at, verdict: x.verdict, coverage: x.coverageState, indexing: x.indexingState, robots: x.robotsTxtState, fetch: x.pageFetchState, lastCrawl: x.lastCrawlTime,
    googleCanonical: x.googleCanonical !== url ? x.googleCanonical : undefined, userCanonical: x.userCanonical !== url ? x.userCanonical : undefined };
  for (const k of Object.keys(r)) if (r[k] == null) delete r[k];
  // The previous state: the last one that differs from today's, so a change stays visible until the page changes again.
  const changed = old && STATE.some((k) => (old[k] ?? null) !== (r[k] ?? null));
  const prev = changed ? Object.fromEntries([...STATE, "checkedAt"].filter((k) => old[k] != null).map((k) => [k, old[k]])) : old?.prev;
  if (prev) r.prev = prev;
  const changedAt = changed ? at : old?.changedAt; // when the state last changed (the alert detector reacts to that day only)
  if (changedAt) r.changedAt = changedAt;
  return r;
}

/** Keeps at most `keep` results: the most important pages always, otherwise the most recently inspected. */
export function boundResults(results, important, keep = INSPECT_KEEP) {
  const e = Object.entries(results);
  if (e.length <= keep) return results;
  const rank = e.map(([u, v]) => [u, v, important.has(urlKey(u)) ? 1 : 0, String(v.checkedAt || "")]);
  rank.sort((a, b) => b[2] - a[2] || (b[3] > a[3] ? 1 : b[3] < a[3] ? -1 : 0));
  return Object.fromEntries(rank.slice(0, keep).map(([u, v]) => [u, v]));
}

/**
 * The "index_inspect" job. deps: { store, siteOf, getToken, fetchImpl, now, allowed, boundOf, perDay, api (tests only) }.
 * Read-only. Never escalates: a refusal is recorded in the report (and the agency's daily digest), not retried daily.
 */
export function makeInspectHandler({ store, siteOf, getToken, fetchImpl = (...a) => fetch(...a), now = () => new Date().toISOString(), allowed = async () => true, boundOf = null, perDay = INSPECT_PER_DAY, api = API }) {
  return async (job) => {
    const a = await searchAccess(job, { boundOf, getToken, allowed });
    if (a.stop) return a.stop;
    const site = await siteOf(job.siteId);
    const memory = (await store.readMemory(job.siteId, "report")) || [];
    const prev = inspectReport(memory) || { results: {} };
    const sc = memory.find((m) => m.kind === "report" && m.key === "search_console")?.value;
    // The bound property, else the one the Search Console snapshot found for an admin-confirmed site.
    const property = a.bound ? a.candidates[0] : sc?.property;
    if (!property) return { evidence: [a.bound ? "URL inspection: no Search Console property is connected to this website" : "URL inspection waits for the first Search Console snapshot, which finds the property"] };
    const urls = inspectBatch({ siteUrl: site.url, memory, max: perDay, now: now() });
    if (!urls.length) return { evidence: ["URL inspection: no pages to inspect yet"] };
    const token = await a.token();
    const results = { ...(prev.results || {}) }, at = now();
    let done = 0, errors = 0, stopped = null, lastError = null;
    const queue = [...urls];
    const lane = async () => {
      while (!stopped && queue.length) {
        const url = queue.shift();
        const r = await fetchImpl(api, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ inspectionUrl: url, siteUrl: property }) });
        const j = await r.json().catch(() => ({}));
        const code = j.error?.code || (r.ok ? 0 : r.status);
        if (code === 403) { stopped ||= "permission"; lastError = String(j.error?.message || "HTTP 403").slice(0, 200); continue; }
        if (code === 429) { stopped ||= "quota"; lastError = String(j.error?.message || "HTTP 429").slice(0, 200); continue; }
        if (code || !j.inspectionResult) { errors++; lastError = String(j.error?.message || `HTTP ${r.status}`).slice(0, 200); continue; }
        results[url] = resultOf(url, j.inspectionResult.indexStatusResult || {}, at, results[url]);
        done++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, urls.length) }, lane));
    const important = new Set([urlKey(new URL("/", site.url).toString()), ...[...(sc?.pages || [])].sort((x, y) => (y.impressions || 0) - (x.impressions || 0)).slice(0, 20).map((p) => urlKey(p.url))]);
    const kept = boundResults(results, important);
    const known = Object.values(kept), indexed = known.filter(isIndexed).length;
    const blocked = stopped === "permission" && !done ? { reason: "needs Full permission", at, property, message: lastError } : null;
    const value = { generatedAt: at, property, results: kept, counts: { known: known.length, indexed, notIndexed: known.length - indexed },
      lastBatch: { at, asked: urls.length, inspected: done, errors, stopped }, blocked };
    await store.writeMemory(job.siteId, [{ kind: "report", key: "inspect", value, basis: "verified", confidence: null, source: "search console url inspection" }]);
    if (blocked) return { evidence: [`URL inspection refused for ${property} (HTTP 403): the service account needs Full permission on the Search Console property (Settings › Users and permissions); Restricted is enough for the other reports. Not asked again for ${BLOCKED_RETRY_DAYS} days.`] };
    return { evidence: [`URL inspection ${property}: ${done} of ${urls.length} pages inspected today; ${indexed} of ${known.length} known pages indexed` +
      (stopped === "quota" ? "; stopped at Google's quota, the rest wait for tomorrow" : stopped === "permission" ? "; stopped: Google refused part of the batch (permission)" : "") + (errors ? `; ${errors} could not be inspected (${lastError})` : "")] };
  };
}

/** What an agent sees: counts, the pages not indexed with Google's reason, and canonical disagreements. */
export function inspectForAgents(r, { max = 30 } = {}) {
  if (!r) return null;
  if (r.blocked && !Object.keys(r.results || {}).length) return { property: r.property, note: "Google refused URL inspection for this property: the service account has Restricted access. Index status is unknown; do not guess it." };
  const e = Object.entries(r.results || {});
  const notIndexed = e.filter(([, v]) => !isIndexed(v)).sort(([, a], [, b]) => String(b.checkedAt).localeCompare(String(a.checkedAt))).slice(0, max)
    .map(([url, v]) => ({ url, coverage: v.coverage, indexing: v.indexing, robots: v.robots, fetch: v.fetch, lastCrawl: v.lastCrawl, checkedAt: String(v.checkedAt || "").slice(0, 10), was: v.prev?.coverage || null }));
  const canonical = e.filter(([, v]) => v.googleCanonical && v.userCanonical && v.googleCanonical !== v.userCanonical).slice(0, 10).map(([url, v]) => ({ url, declared: v.userCanonical, googleChose: v.googleCanonical }));
  return { property: r.property, generatedAt: r.generatedAt, counts: r.counts || null, notIndexed, canonicalDisagreements: canonical,
    note: `Google URL inspection of ${e.length} pages, a rotating batch of at most ${INSPECT_PER_DAY} a day; a page not listed has not been inspected yet. "was" is the state at its previous inspection.` };
}
