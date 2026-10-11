// Search-data intelligence. Pure functions over Search Console rows { query, page, clicks, impressions, position }.
// Nothing here uses outside benchmarks: expected click-through rates come from THIS site's own data, and every
// estimate says how confident it is. Small sites produce small samples, so each analysis has a minimum-volume guard.
import { tokens } from "../adapters/index.mjs";

const stem = (w) => w.replace(/(ing|ers|er|es|s)$/, "");
const sum = (a, f) => a.reduce((n, x) => n + f(x), 0);

/** Site-specific CTR by position (rounded 1..maxPos). `enough` is false when the data is too thin to trust. */
export function buildCtrCurve(rows, { maxPos = 20, minBucket = 100, minBuckets = 3 } = {}) {
  const agg = {};
  for (const r of rows) {
    const b = Math.round(r.position);
    if (b < 1 || b > maxPos) continue;
    (agg[b] ||= { clicks: 0, impressions: 0 });
    agg[b].clicks += r.clicks; agg[b].impressions += r.impressions;
  }
  const byPos = {}, samples = {};
  for (const [b, v] of Object.entries(agg)) if (v.impressions >= minBucket) { byPos[b] = v.clicks / v.impressions; samples[b] = v.impressions; }
  return { byPos, samples, enough: Object.keys(byPos).length >= minBuckets };
}

/** Expected CTR at a (fractional) position by interpolating between the nearest measured buckets. Null if the curve is thin. */
export function expectedCtr(curve, position) {
  if (!curve?.enough) return null;
  const pts = Object.keys(curve.byPos).map(Number).sort((a, b) => a - b);
  if (!pts.length) return null;
  const lo = [...pts].reverse().find((p) => p <= position), hi = pts.find((p) => p >= position);
  if (lo == null) return curve.byPos[hi];
  if (hi == null || lo === hi) return curve.byPos[lo];
  const t = (position - lo) / (hi - lo);
  return curve.byPos[lo] + (curve.byPos[hi] - curve.byPos[lo]) * t;
}

const wpos = (rows) => { const i = sum(rows, (r) => r.impressions); return i ? sum(rows, (r) => r.position * r.impressions) / i : 0; };

/** Queries where two or more of your pages compete: each gets a meaningful share of the impressions. */
export function cannibalization(rows, { minImpressions = 20, minShare = 0.2 } = {}) {
  const byQuery = new Map();
  for (const r of rows) (byQuery.get(r.query) || byQuery.set(r.query, []).get(r.query)).push(r);
  const out = [];
  for (const [query, rs] of byQuery) {
    const total = sum(rs, (r) => r.impressions);
    if (total < minImpressions) continue;
    const pages = rs.filter((r) => r.impressions / total >= minShare).sort((a, b) => b.impressions - a.impressions);
    if (pages.length < 2) continue;
    out.push({ query, impressions: total, pages: pages.map((p) => ({ page: p.page, impressions: p.impressions, clicks: p.clicks, position: Number(p.position.toFixed(1)) })) });
  }
  return out.sort((a, b) => b.impressions - a.impressions);
}

/** Queries ranking just off the first page or low on it, ranked by the clicks a better position could add (an estimate). */
export function strikingDistance(rows, curve, { minImpressions = 10, from = 4, to = 20, targetPos = 3 } = {}) {
  const byQuery = new Map();
  for (const r of rows) (byQuery.get(r.query) || byQuery.set(r.query, []).get(r.query)).push(r);
  const target = expectedCtr(curve, targetPos);
  const out = [];
  for (const [query, rs] of byQuery) {
    const impressions = sum(rs, (r) => r.impressions), clicks = sum(rs, (r) => r.clicks), position = wpos(rs);
    if (impressions < minImpressions || position < from || position > to) continue;
    const gain = target != null ? Math.max(0, impressions * (target - clicks / impressions)) : null;
    const best = rs.sort((a, b) => b.impressions - a.impressions)[0];
    out.push({ query, impressions, clicks, position: Number(position.toFixed(1)), page: best.page, estimatedExtraClicks: gain == null ? null : Number(gain.toFixed(1)) });
  }
  return out.sort((a, b) => (b.estimatedExtraClicks ?? b.impressions / 100) - (a.estimatedExtraClicks ?? a.impressions / 100));
}

/** Pages whose CTR is well below what their own position normally earns on this site: a title/snippet problem to test. */
export function ctrUnderperformers(rows, curve, { minImpressions = 40, factor = 0.6 } = {}) {
  const byPage = new Map();
  for (const r of rows) (byPage.get(r.page) || byPage.set(r.page, []).get(r.page)).push(r);
  const out = [];
  for (const [page, rs] of byPage) {
    const impressions = sum(rs, (r) => r.impressions), clicks = sum(rs, (r) => r.clicks), position = wpos(rs);
    if (impressions < minImpressions || position > 12) continue;
    const exp = expectedCtr(curve, position);
    if (exp == null) continue;
    const ctr = clicks / impressions;
    if (ctr < exp * factor) out.push({ page, impressions, clicks, position: Number(position.toFixed(1)), ctr: Number(ctr.toFixed(4)), expectedCtr: Number(exp.toFixed(4)), estimatedLostClicks: Number(Math.max(0, impressions * exp - clicks).toFixed(1)) });
  }
  return out.sort((a, b) => b.estimatedLostClicks - a.estimatedLostClicks);
}

/** Pages losing visibility between two equal windows. */
export function decay(nowRows, prevRows, { minPrevImpressions = 30, drop = 0.3 } = {}) {
  const agg = (rows) => { const m = new Map(); for (const r of rows) { const a = m.get(r.page) || { clicks: 0, impressions: 0 }; a.clicks += r.clicks; a.impressions += r.impressions; m.set(r.page, a); } return m; };
  const now = agg(nowRows), prev = agg(prevRows), out = [];
  for (const [page, p] of prev) {
    if (p.impressions < minPrevImpressions) continue;
    const n = now.get(page) || { clicks: 0, impressions: 0 };
    const change = (n.impressions - p.impressions) / p.impressions;
    if (change <= -drop) out.push({ page, impressionsBefore: p.impressions, impressionsNow: n.impressions, clicksBefore: p.clicks, clicksNow: n.clicks, change: Number(change.toFixed(2)) });
  }
  return out.sort((a, b) => a.change - b.change);
}

/** Heuristic search-intent label from the words of a query. */
export function classifyIntent(query, brandTerms = []) {
  const q = ` ${query.toLowerCase()} `;
  if (brandTerms.some((b) => b && q.includes(b.toLowerCase()))) return "navigational";
  if (/\s(buy|hire|quote|quotes|pricing|price|prices|cost|costs|cheap|near me|agency|agencies|consultant|consultancy|book|demo|free trial|for hire|service|services|provider|providers)\s/.test(q)) return "transactional";
  if (/\s(best|top|vs|versus|compare|comparison|review|reviews|alternative|alternatives)\s/.test(q)) return "commercial";
  if (/^\s*(how|what|why|when|can|does|do|is|are|should|which|who)\s/.test(q) || /\s(guide|tutorial|example|examples|meaning|definition|checklist|template|ideas)\s/.test(q)) return "informational";
  return "unclear";
}

export function intentMix(rows, brandTerms = []) {
  const out = { informational: 0, commercial: 0, transactional: 0, navigational: 0, unclear: 0 };
  for (const r of rows) out[classifyIntent(r.query, brandTerms)] += r.impressions;
  const total = sum(Object.values(out), (x) => x) || 1;
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { impressions: v, share: Number((v / total).toFixed(3)) }]));
}

export function brandSplit(rows, brandTerms = []) {
  const brand = { clicks: 0, impressions: 0 }, non = { clicks: 0, impressions: 0 };
  for (const r of rows) { const t = brandTerms.some((b) => b && r.query.toLowerCase().includes(b.toLowerCase())) ? brand : non; t.clicks += r.clicks; t.impressions += r.impressions; }
  return { brand, nonBrand: non };
}

/**
 * Group queries into topics (by their most shared meaningful word) and show where you have authority and where you have
 * demand but no dedicated page. `pageTitles` = lowercase titles/keywords of existing pages.
 */
export function topicClusters(rows, pageTitles = [], { minImpressions = 15, brandTerms = [] } = {}) {
  const byQuery = new Map();
  for (const r of rows) {
    if (brandTerms.some((b) => b && r.query.toLowerCase().includes(b.toLowerCase()))) continue;
    (byQuery.get(r.query) || byQuery.set(r.query, []).get(r.query)).push(r);
  }
  const df = new Map();
  for (const q of byQuery.keys()) for (const t of new Set(tokens(q).map(stem))) df.set(t, (df.get(t) || 0) + 1);
  const clusters = new Map();
  for (const [q, rs] of byQuery) {
    const ts = [...new Set(tokens(q).map(stem))];
    if (!ts.length) continue;
    const head = ts.sort((a, b) => (df.get(b) || 0) - (df.get(a) || 0) || b.length - a.length)[0];
    const c = clusters.get(head) || { topic: head, queries: [], rows: [] };
    c.queries.push(q); c.rows.push(...rs); clusters.set(head, c);
  }
  const titles = pageTitles.map((t) => t.toLowerCase());
  return [...clusters.values()].map((c) => {
    const impressions = sum(c.rows, (r) => r.impressions), clicks = sum(c.rows, (r) => r.clicks);
    const pages = [...new Set(c.rows.map((r) => r.page))];
    return {
      topic: c.topic, queries: c.queries.length, impressions, clicks, position: Number(wpos(c.rows).toFixed(1)), pages: pages.length,
      topQueries: c.queries.slice(0, 5), hasDedicatedPage: titles.some((t) => t.includes(c.topic)),
    };
  }).filter((c) => c.impressions >= minImpressions).sort((a, b) => b.impressions - a.impressions);
}

/** Everything at once. `input` = { rows, prevRows, brandTerms, pageTitles }. */
export function analyze({ rows = [], prevRows = [], brandTerms = [], pageTitles = [] } = {}) {
  const curve = buildCtrCurve(rows);
  const topics = topicClusters(rows, pageTitles, { brandTerms });
  return {
    sample: { rows: rows.length, impressions: sum(rows, (r) => r.impressions), clicks: sum(rows, (r) => r.clicks) },
    curve: { enough: curve.enough, byPos: curve.byPos },
    brand: brandSplit(rows, brandTerms),
    intent: intentMix(rows, brandTerms),
    cannibalization: cannibalization(rows).slice(0, 25),
    strikingDistance: strikingDistance(rows, curve).slice(0, 40),
    ctrUnderperformers: ctrUnderperformers(rows, curve).slice(0, 25),
    decay: decay(rows, prevRows).slice(0, 25),
    topics: topics.slice(0, 40),
    contentGaps: topics.filter((t) => !t.hasDedicatedPage && t.impressions >= 20).slice(0, 15),
  };
}
