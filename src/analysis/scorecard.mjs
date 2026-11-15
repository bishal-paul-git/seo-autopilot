// Per-change scorecard (D58): did a change or a piece of accepted advice move the page in Google search? For every
// completed agent job that named pages, and every merged implementation, compare the affected pages' Search Console
// clicks, impressions, CTR and position over the 14 and 28 days before the change with the same number of days after it
// (starting LAG days later, so Google has time to recrawl). Each window gets one label:
//   win | loss | flat        enough data, and the change beat, trailed or matched the rest of the site;
//   too_early                the after-window is not complete in Search Console yet;
//   not_enough_data          too few impressions in both windows to say anything (small pages stay honest).
// The rest of the site over the same days (site totals minus the page, from the `history` report) is the control: a page
// that held steady while the whole site fell 30% did better than it looks. Still directional, not a randomised test.
//
// The before-baseline is frozen on the entry the first time its window is in Search Console, and each window's result is
// frozen once its after-window is complete, so nothing depends on reports the daily prune deletes (D57). Pure: no I/O.

const DAY = 864e5;
export const LAG = 3, DATA_LAG = 3, SPANS = [14, 28], MAX_PAGES = 3, MAX_AGE_DAYS = 180;
export const RULES = {
  minImpressions: { 14: 50, 28: 100 }, // in at least one window, or the page is too small to judge
  clicksFloor: 20,                     // clicks before + after; below it the verdict is about impressions (visibility)
  threshold: 0.15,                     // relative change, after allowing for the rest of the site
  minAbs: { clicks: 5, impressions: 50 }, // and at least this much in absolute terms, so 2 -> 3 clicks is never a "win"
};

export const day = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d, n) => day(Date.parse(`${d}T00:00:00Z`) + n * DAY);
/** The last date Search Console has settled data for (it revises the most recent 2 to 3 days). */
export const dataThrough = (now) => addDays(day(Date.parse(now)), -DATA_LAG);

/** Before and after windows of `span` days for a change made on date d (YYYY-MM-DD). */
export function windowsOf(d, span, lag = LAG) {
  return { before: [addDays(d, -span), addDays(d, -1)], after: [addDays(d, lag), addDays(d, lag + span - 1)] };
}

/** Totals over [from, to] from a daily series { "YYYY-MM-DD": [clicks, impressions, position] }. */
export function aggregate(series, from, to) {
  let clicks = 0, impressions = 0, pos = 0, days = 0;
  // Compares date strings (ISO dates sort as text): no date arithmetic per day, which matters in a 10 ms Worker.
  for (const d in series || {}) {
    const v = series[d];
    if (d < from || d > to || !Array.isArray(v)) continue;
    const i = Number(v[1]) || 0;
    clicks += Number(v[0]) || 0; impressions += i; pos += (Number(v[2]) || 0) * i; days++;
  }
  return { clicks, impressions, ctr: impressions ? r4(clicks / impressions) : null, position: impressions ? r1(pos / impressions) : null, days };
}
const r4 = (x) => Math.round(x * 1e4) / 1e4, r1 = (x) => Math.round(x * 10) / 10, r3 = (x) => (x == null ? null : Math.round(x * 1e3) / 1e3);

/** Same host as the site (www ignored), http(s) only. Agent output is data: anything else is dropped. A pattern, not
 *  new URL(), because the planner checks every recent job on every run inside a Worker's 10 ms. */
const ADDR = /^https?:\/\/([a-z0-9.-]+)(:\d+)?([/?#][^\s]*)?$/i;
function sameHost(u, host) {
  const s = String(u ?? "").trim(), m = ADDR.exec(s);
  if (!m || m[1].toLowerCase().replace(/^www\./, "") !== host || s.length > 500) return null;
  return m[3] ? s : `${s}/`;
}

/** The pages a job changed or advised on, at most MAX_PAGES, on the site's own host. */
export function pagesOf(job, siteUrl) {
  const host = ADDR.exec(String(siteUrl ?? "").trim())?.[1]?.toLowerCase().replace(/^www\./, "");
  if (!host) return [];
  const urls = job.kind === "implement" ? [job.outputs?.deploy?.url, job.outputs?.proposal?.workOrder?.url]
    : (job.outputs?.proposal?.recommendations || []).map((r) => r?.url);
  return [...new Set(urls.map((u) => sameHost(u, host)).filter(Boolean))].slice(0, MAX_PAGES);
}

/**
 * Scorecard entries for completed jobs not yet on the scorecard: advice an agency accepted (dated when it was accepted)
 * and merged implementations (dated when the pull request was merged). An implementation of earlier advice replaces that
 * advice in the counts (supersededBy), so one change is never scored twice.
 * existing: Map key -> entry. Returns the rows to write: [{ key, value }].
 */
export function newEntries(jobs, existing, siteUrl, now) {
  const out = new Map();
  const oldest = Date.parse(now) - MAX_AGE_DAYS * DAY;
  for (const j of jobs || []) {
    if (j.status !== "completed" || existing.has(`job:${j.id}`)) continue;
    const implement = j.kind === "implement";
    if (!implement && !(j.kind.startsWith("agent:") || j.kind === "client_request")) continue;
    const at = implement ? j.outputs?.deploy?.mergedAt : j.updatedAt;
    if (!at || !Number.isFinite(Date.parse(at)) || Date.parse(at) < oldest) continue;
    const pages = pagesOf(j, siteUrl);
    if (!pages.length) continue;
    const rec = implement ? j.inputs?.recommendation : null;
    const entry = { job: j.id, kind: j.kind, agent: j.agent || (j.kind.startsWith("agent:") ? j.kind.slice(6) : null), basis: implement ? "change merged" : "advice accepted",
      title: String(rec?.title || j.title || "").slice(0, 200), pages, changedAt: day(Date.parse(at)), createdAt: now, status: "open", windows: {} };
    if (implement && j.outputs?.deploy?.prUrl) entry.pr = String(j.outputs.deploy.prUrl).slice(0, 300);
    out.set(`job:${j.id}`, entry);
    const src = implement ? j.inputs?.sourceJob : null;
    const advice = src && (out.get(`job:${src}`) || existing.get(`job:${src}`));
    if (advice && !advice.supersededBy) out.set(`job:${src}`, { ...advice, supersededBy: j.id, status: "closed" });
  }
  return [...out].map(([key, value]) => ({ key, value }));
}

/** The date range one Search Console query must cover to score this entry today. */
export function queryRange(entry, through) {
  const max = Math.max(...SPANS);
  const from = addDays(entry.changedAt, -max), end = addDays(entry.changedAt, LAG + max - 1);
  return { from, to: end < through ? end : through };
}

/** Whether a measurement now would add anything: a baseline that can be frozen, or a window that can be completed. */
export function entryDue(entry, through) {
  if (!entry || entry.status === "closed" || entry.supersededBy) return false;
  if (!entry.baseline && addDays(entry.changedAt, -1) <= through) return true;
  return SPANS.some((s) => !entry.windows?.[s]?.final && windowsOf(entry.changedAt, s).after[1] <= through);
}

/**
 * The verdict for one window. before/after: aggregates of the affected pages; rest: { before, after } aggregates of the
 * rest of the site over the same days (or null). Returns { label, metric, change, siteChange, adjusted, reason }.
 */
export function judge(before, after, span, rest = null) {
  const minImp = RULES.minImpressions[span] ?? RULES.minImpressions[28];
  if (Math.max(before.impressions, after.impressions) < minImp)
    return { label: "not_enough_data", metric: null, change: null, siteChange: null, adjusted: null, reason: `Fewer than ${minImp} impressions in both ${span}-day windows: too little data to judge.` };
  const metric = before.clicks + after.clicks >= RULES.clicksFloor ? "clicks" : "impressions";
  const v0 = before[metric], v1 = after[metric];
  const change = v0 ? (v1 - v0) / v0 : null;
  let siteChange = null;
  if (rest && rest.before?.[metric] > 0 && rest.before.days >= span / 2 && rest.after?.days >= span / 2) siteChange = (rest.after[metric] - rest.before[metric]) / rest.before[metric];
  // What the page would have had if it had moved like the rest of the site; the verdict is the gap to that.
  const expected = v0 * (1 + (siteChange ?? 0)), gap = v1 - expected;
  const adjusted = expected > 0 ? gap / expected : null;
  const big = Math.abs(gap) >= RULES.minAbs[metric];
  const label = !big ? "flat" : adjusted == null ? (gap > 0 ? "win" : "loss") : adjusted >= RULES.threshold ? "win" : adjusted <= -RULES.threshold ? "loss" : "flat";
  const pctTxt = (x) => (x == null ? "" : ` (${x > 0 ? "+" : ""}${Math.round(x * 100)}%)`);
  const name = metric === "clicks" ? "Clicks" : "Impressions";
  const parts = [`${name} ${v0} → ${v1}${v0 ? pctTxt(change) : " (from none)"}`];
  parts.push(siteChange == null ? "no comparison with the rest of the site (not enough site history)" : `rest of the site ${pctTxt(siteChange).trim().replace(/[()]/g, "")} over the same days`);
  if (before.ctr != null && after.ctr != null) parts.push(`CTR ${(before.ctr * 100).toFixed(1)}% → ${(after.ctr * 100).toFixed(1)}%`);
  if (before.position != null && after.position != null) parts.push(`average position ${before.position} → ${after.position}`);
  if (metric === "impressions") parts.push(`judged on impressions: fewer than ${RULES.clicksFloor} clicks in both windows`);
  if (!big) parts.push(`difference under ${RULES.minAbs[metric]} ${metric} after allowing for the site`);
  return { label, metric, change: r3(change), siteChange: r3(siteChange), adjusted: r3(adjusted), reason: `${parts.join("; ")}.` };
}

/**
 * Score one entry with the affected pages' daily series and the site's daily totals (history.daily), as known today.
 * Freezes the baseline the first time the before-windows are in Search Console, and each window once complete.
 */
export function scoreEntry(entry, { series = {}, siteDaily = {}, through, now = new Date().toISOString(), property = null } = {}) {
  const e = { ...entry, windows: { ...(entry.windows || {}) } };
  const rest = (from, to) => {
    const site = aggregate(siteDaily, from, to), page = aggregate(series, from, to);
    return { clicks: Math.max(0, site.clicks - page.clicks), impressions: Math.max(0, site.impressions - page.impressions), days: site.days };
  };
  if (!e.baseline && addDays(e.changedAt, -1) <= through) {
    e.baseline = { at: now, property };
    for (const s of SPANS) { const [f, t] = windowsOf(e.changedAt, s).before; e.baseline[s] = { ...aggregate(series, f, t), rest: rest(f, t) }; }
  }
  for (const s of SPANS) {
    if (e.windows[s]?.final) continue;
    const w = windowsOf(e.changedAt, s);
    const before = e.baseline?.[s];
    if (!before || w.after[1] > through) { e.windows[s] = { label: "too_early", readyOn: addDays(w.after[1], DATA_LAG + 1), before: before ? strip(before) : null }; continue; }
    const after = aggregate(series, w.after[0], w.after[1]);
    const v = judge(before, after, s, { before: before.rest, after: rest(w.after[0], w.after[1]) });
    e.windows[s] = { ...v, before: strip(before), after, from: w.before[0], to: w.after[1], final: true, at: now };
  }
  e.label = overall(e);
  if (SPANS.every((s) => e.windows[s]?.final)) e.status = "closed";
  e.updatedAt = now;
  return e;
}
const strip = ({ rest, ...x }) => x;

/** The entry's headline: the 28-day verdict when complete, else the 14-day one (provisional), else too early. */
export function overall(e) {
  const w28 = e.windows?.[28], w14 = e.windows?.[14];
  if (w28?.final) return w28.label;
  if (w14?.final) return w14.label;
  return "too_early";
}

/** Counts per label for a site's scorecard; superseded advice is not counted (its implementation is). */
export function summarise(entries) {
  const out = { win: 0, loss: 0, flat: 0, too_early: 0, not_enough_data: 0, total: 0 };
  for (const e of entries || []) { if (!e || e.supersededBy) continue; const l = e.label || overall(e); if (l in out) out[l]++; out.total++; }
  return out;
}

/** Entries to measure now, oldest change first, at most `max`. */
export function dueEntries(entries, through, max = 8) {
  return (entries || []).filter((e) => entryDue(e, through)).sort((a, b) => a.changedAt.localeCompare(b.changedAt)).slice(0, max);
}
