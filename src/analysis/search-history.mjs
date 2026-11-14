// Search history for hosted sites (D57). The daily Search Console snapshot is one 28-day total, so on its own it cannot
// show a sudden change or which queries moved. This keeps a small, bounded history next to it:
//   - daily: the site's own daily totals { "YYYY-MM-DD": [clicks, impressions, position] } (one small date query a day;
//     Search Console revises recent days, so a day fetched again replaces the saved one), at most HISTORY_DAYS days;
//   - weeks: one point per ISO week for the top queries and pages, taken from that week's latest 28-day snapshot
//     ({ to, totals, queries: { q: [c, i, p] }, pages: { url: [c, i, p] } }), at most HISTORY_WEEKS weeks.
// Weekly points overlap (each is a 28-day window), so week-to-week movement is damped; reports say so.
// Pure: pass the saved history in, get the new one back.
import { windowStats, summarise } from "./rank.mjs";

export const HISTORY_DAYS = 120, HISTORY_WEEKS = 9, HISTORY_KEYS = 30;

const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const r1 = (x) => Number(Number(x || 0).toFixed(1));
const point = (x) => [x.clicks || 0, x.impressions || 0, r1(x.position)];

/** ISO week label of a date ("2026-W46"), the same periods the planner uses for weekly work. */
export function isoWeek(d) {
  const t0 = new Date(d), t = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), t0.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y) / 864e5 + 1) / 7)).padStart(2, "0")}`;
}

const top = (rows = [], key) => Object.fromEntries([...rows].sort((a, b) => (b.clicks || 0) - (a.clicks || 0) || (b.impressions || 0) - (a.impressions || 0))
  .slice(0, HISTORY_KEYS).map((r) => [String(r[key]).slice(0, 300), point(r)]));

/**
 * prev: the saved history (or null). daily: [{ date, clicks, impressions, position }] from a Search Console date query.
 * snapshot: the 28-day snapshot just stored (report "search_console"). Returns the new history, bounded in size.
 */
export function mergeHistory(prev, { daily = [], snapshot = null, now = new Date().toISOString() } = {}) {
  const d = { ...(prev?.daily || {}) }, weeks = { ...(prev?.weeks || {}) };
  for (const r of daily) if (/^\d{4}-\d{2}-\d{2}$/.test(r.date || "")) d[r.date] = point(r);
  if (snapshot?.to) weeks[isoWeek(`${snapshot.to}T00:00:00Z`)] = { to: snapshot.to, totals: point(snapshot.totals || {}), queries: top(snapshot.queries, "query"), pages: top(snapshot.pages, "url") };
  const keepDays = Object.keys(d).sort().slice(-HISTORY_DAYS), keepWeeks = Object.keys(weeks).sort().slice(-HISTORY_WEEKS);
  return { generatedAt: now, daily: Object.fromEntries(keepDays.map((k) => [k, d[k]])), weeks: Object.fromEntries(keepWeeks.map((k) => [k, weeks[k]])) };
}

/** The last 7 days with data against the 7 days before them (site totals). Null without daily data. */
export function weekOverWeek(history) {
  const days = Object.keys(history?.daily || {}).sort();
  if (!days.length) return null;
  const to = days.at(-1);
  const now = windowStats(history.daily, addDays(to, -6), to), prev = windowStats(history.daily, addDays(to, -13), addDays(to, -7));
  const pct = (a, b) => (b ? Number(((a - b) / b).toFixed(3)) : null);
  return { to, now, prev, clicksChange: pct(now.clicks, prev.clicks), impressionsChange: pct(now.impressions, prev.impressions) };
}

/** The weekly points, oldest first. */
const weekList = (history) => Object.entries(history?.weeks || {}).sort(([a], [b]) => a.localeCompare(b)).map(([week, w]) => ({ week, ...w }));

/**
 * Query movement between the two latest weekly points, in the rank tracker's shape (src/analysis/rank.mjs summarise),
 * so the router reads it like the CLI's rank.json. Null until two weeks exist.
 */
export function rankFromHistory(history) {
  const w = weekList(history);
  if (w.length < 2) return null;
  const now = w.at(-1), prev = w.at(-2);
  const rows = [...new Set([...Object.keys(now.queries || {}), ...Object.keys(prev.queries || {})])].map((query) => {
    const a = now.queries?.[query], b = prev.queries?.[query];
    const position = a ? a[2] : null, previous = b ? b[2] : null;
    const change = position != null && previous != null ? Number((previous - position).toFixed(1)) : null;
    const status = position == null ? "lost" : previous == null ? "new" : Math.abs(change) < 1 ? "steady" : change > 0 ? "up" : "down";
    return { query, position, previous, change, status };
  });
  // A query that left the top list is not proof it stopped ranking: only queries in both weeks count as movers or lost.
  const summary = summarise(rows.map((r) => (r.status === "lost" ? { ...r, status: "left the top list" } : r)), now.to);
  return { generatedAt: now.to, basis: `Search Console, 28-day windows ending ${prev.to} and ${now.to} (top ${HISTORY_KEYS} queries)`, summary };
}

/** The 28-day page totals from about four weeks before the latest point (an equal earlier window), or null. */
export function earlierPages(history, latestTo) {
  if (!latestTo) return null;
  const target = Date.parse(`${addDays(latestTo, -28)}T00:00:00Z`);
  const w = weekList(history).filter((x) => Math.abs(Date.parse(`${x.to}T00:00:00Z`) - target) <= 4 * 864e5);
  return w.length ? w.at(-1) : null;
}

/** What an agent sees: the last 28 daily totals, the week-over-week change and the biggest query movers. */
export function historyForAgents(h) {
  if (!h || !Object.keys(h.daily || {}).length) return null;
  const days = Object.keys(h.daily).sort().slice(-28);
  const rank = rankFromHistory(h);
  const mover = (r) => ({ query: r.query, position: r.position, previous: r.previous, change: r.change });
  return { daily: days.map((d) => ({ date: d, clicks: h.daily[d][0], impressions: h.daily[d][1], position: h.daily[d][2] })), weekOverWeek: weekOverWeek(h),
    movers: rank ? { gainers: rank.summary.gainers.slice(0, 5).map(mover), losers: rank.summary.losers.slice(0, 5).map(mover), basis: rank.basis } : null,
    note: "Daily site totals from Search Console (dates are when searches happened; the last 2-3 days are revised by Google). Query movers compare two overlapping 28-day windows a week apart, so changes are damped." };
}
