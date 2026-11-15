// Per-change scorecard in the hosted engine (D58). The planner adds an entry to site memory (kind "scorecard") for each
// completed agent job that named pages and each merged implementation (src/analysis/scorecard.mjs newEntries). A free
// `scorecard` job then reads, per entry, ONE small Search Console query: the affected pages' daily clicks, impressions
// and position from 28 days before the change to 28 days after it (or to the last settled day). It freezes the
// before-baseline the first time it can, and each window's verdict once complete, on the entry itself. The rest of the
// site comes from the `history` report's daily totals (kept 120 days), so the control costs no extra request.
//
// Why on the entry and not a per-page daily report: a daily per-page report would be rewritten every day for every watched
// page (a new copy each day, pruned after 14 days) and still lose its "before" days once they fall out of its window.
// Here each change costs at most three small queries over its life and a few hundred bytes that never need the pruned
// copies. Workers Free: a batch is at most MAX_PER_RUN queries plus a few database calls, and well under 1 ms of scoring.
import { searchAccess } from "./search-console.mjs";
import { dataThrough, dueEntries, newEntries, queryRange, scoreEntry, entryDue } from "../analysis/scorecard.mjs";

export const MAX_PER_RUN = 8;
const API = "https://www.googleapis.com/webmasters/v3";
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The memory rows (kind "scorecard") for jobs not yet on the scorecard; [] when none. Pure apart from the inputs. */
export function scorecardRows(site, memory, jobs, now) {
  const existing = new Map(memory.filter((m) => m.kind === "scorecard").map((m) => [m.key, m.value]));
  return newEntries(jobs, existing, site.url, now).map(({ key, value }) => ({ kind: "scorecard", key, value, basis: "verified", confidence: null, source: "scorecard" }));
}

/** Whether a measurement would add anything today (a baseline to freeze or a window to complete). */
export const scorecardDue = (memory, now) => memory.some((m) => m.kind === "scorecard" && entryDue(m.value, dataThrough(now)));

/** The filter for one entry's pages: one page exactly, several through an anchored pattern (Search Console's RE2). */
export const pageFilter = (pages) => (pages.length === 1 ? { dimension: "page", operator: "equals", expression: pages[0] }
  : { dimension: "page", operator: "includingRegex", expression: `^(${pages.map(esc).join("|")})$` });

/**
 * The "scorecard" job. deps: { store, siteOf, getToken, fetchImpl, now, allowed, boundOf, api (tests only) }.
 * Read-only; never escalates (the daily snapshot reports lost access).
 */
export function makeScorecardHandler({ store, getToken, fetchImpl = (...a) => fetch(...a), now = () => new Date().toISOString(), allowed = async () => true, boundOf = null, api = API }) {
  return async (job) => {
    const a = await searchAccess(job, { boundOf, getToken, allowed });
    if (a.stop) return a.stop;
    const memory = (await store.readMemory(job.siteId)) || [];
    const report = (k) => memory.find((m) => m.kind === "report" && m.key === k)?.value || null;
    const property = a.bound ? a.candidates[0] : report("search_console")?.property;
    if (!property) return { evidence: [a.bound ? "Scorecard: no Search Console property is connected to this website" : "Scorecard waits for the first Search Console snapshot, which finds the property"] };
    const through = dataThrough(now());
    const due = dueEntries(memory.filter((m) => m.kind === "scorecard").map((m) => m.value), through, MAX_PER_RUN);
    if (!due.length) return { evidence: ["Scorecard: nothing to measure today"] };
    const token = await a.token(), siteDaily = report("history")?.daily || {}, at = now();
    const rows = [], failed = [];
    for (const e of due) {
      const { from, to } = queryRange(e, through);
      const r = await fetchImpl(`${api}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ startDate: from, endDate: to, dimensions: ["date"], dimensionFilterGroups: [{ filters: [pageFilter(e.pages)] }], rowLimit: 100 }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { failed.push(String(j.error?.message || `HTTP ${r.status}`).slice(0, 120)); if ([401, 403, 429].includes(r.status)) break; continue; }
      const series = Object.fromEntries((j.rows || []).map((x) => [x.keys[0], [x.clicks || 0, x.impressions || 0, Number(Number(x.position || 0).toFixed(1))]]));
      rows.push({ kind: "scorecard", key: `job:${e.job}`, value: scoreEntry(e, { series, siteDaily, through, now: at, property }), basis: "verified", confidence: null, source: "search console" });
    }
    if (rows.length) await store.writeMemory(job.siteId, rows);
    const done = rows.filter((x) => Object.values(x.value.windows).some((w) => w.final && w.at === at)).length;
    return { evidence: [`Scorecard ${property} (data to ${through}): ${rows.length} change${rows.length === 1 ? "" : "s"} measured, ${done} with a finished window` +
      (failed.length ? `; ${failed.length} not read (${failed[0]})` : "")] };
  };
}
