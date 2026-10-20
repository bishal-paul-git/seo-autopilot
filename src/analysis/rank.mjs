// Rank tracker: positions over time for the queries that matter, from Search Console's own daily data, plus an optional live
// check (search features, who else ranks, share of voice by domain). Pure: pass the saved series and snapshots in.
//
// Search Console positions are averages over every place and device the query was shown; they are the site's real data,
// not one scraped rank. The live check is one location at one moment. Reports say which is which.

const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// A fixed, relative click curve so visibility is comparable between runs (the site's own curve moves as data grows).
// It is an index (100 = every tracked query at position 1), not a click forecast.
const WEIGHT = [0, 1, 0.55, 0.38, 0.27, 0.2, 0.15, 0.12, 0.1, 0.08, 0.07];
export const weight = (pos) => (pos == null ? 0 : pos < 1.5 ? 1 : pos <= 10 ? WEIGHT[Math.round(pos)] : pos <= 20 ? 0.02 : 0);

export function windowStats(s = {}, from, to) {
  let clicks = 0, impressions = 0, pw = 0, days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) { const v = s[d]; if (!v) continue; clicks += v[0]; impressions += v[1]; pw += v[2] * v[1]; days++; }
  return { clicks, impressions, position: impressions ? Number((pw / impressions).toFixed(1)) : null, days };
}

/** Which queries to track: the user's list, else the top `n` non-brand queries by impressions in Search Console rows. */
export function trackedSet(list, rows = [], { n = 50, brandTerms = [] } = {}) {
  const own = (list || []).map((x) => String(x?.q ?? x).toLowerCase().trim()).filter((q) => q && !/^replace these/i.test(q));
  if (own.length) return { queries: [...new Set(own)], basis: "your tracked-queries.json" };
  const brand = brandTerms.map((b) => b.toLowerCase()).filter(Boolean), by = new Map();
  for (const r of rows) { const q = String(r.query).toLowerCase(); if (!brand.some((b) => q.includes(b))) by.set(q, (by.get(q) || 0) + r.impressions); }
  return { queries: [...by].sort((a, b) => b[1] - a[1]).slice(0, n).map(([q]) => q), basis: `top ${n} non-brand queries by Search Console impressions` };
}

/** Merge new Search Console date x query rows into the saved series, keeping only `keep` queries. */
export function mergeSeries(series = {}, rows = [], keep = null) {
  const seen = new Set();
  for (const r of rows) {
    const [date, query] = r.keys || [r.date, r.query];
    const q = String(query).toLowerCase();
    if (keep && !keep.has(q)) continue;
    // A day fetched again replaces what was saved (recent days are re-fetched because Search Console revises them).
    if (!seen.has(`${q}|${date}`)) { seen.add(`${q}|${date}`); if (series[q]) delete series[q][date]; }
    const cur = (series[q] ||= {})[date];
    // Several rows in one fetch can map to one lower-cased query: add them up and weight the position by impressions.
    if (cur) { const imp = cur[1] + r.impressions; series[q][date] = [cur[0] + r.clicks, imp, imp ? Number(((cur[2] * cur[1] + r.position * r.impressions) / imp).toFixed(1)) : cur[2]]; }
    else series[q][date] = [r.clicks, r.impressions, Number(Number(r.position).toFixed(1))];
  }
  return series;
}

/**
 * Per tracked query: this week (7 days ending `lag` days ago), the week before, and the same week four weeks earlier.
 * change > 0 means the position improved (a smaller number).
 */
export function trackQueries(series, queries, today, { lag = 3, span = 7 } = {}) {
  const to = addDays(today, -lag), from = addDays(to, -(span - 1));
  const pTo = addDays(from, -1), pFrom = addDays(pTo, -(span - 1));
  const mTo = addDays(to, -28), mFrom = addDays(mTo, -(span - 1));
  return queries.map((q) => {
    const s = series[q] || {};
    const now = windowStats(s, from, to), prev = windowStats(s, pFrom, pTo), month = windowStats(s, mFrom, mTo);
    const change = now.position != null && prev.position != null ? Number((prev.position - now.position).toFixed(1)) : null;
    const status = now.position == null ? (prev.position != null ? "lost" : "not ranking") : prev.position == null ? "new" : Math.abs(change) < 1 ? "steady" : change > 0 ? "up" : "down";
    return { query: q, position: now.position, previous: prev.position, monthAgo: month.position, change, monthChange: now.position != null && month.position != null ? Number((month.position - now.position).toFixed(1)) : null, clicks: now.clicks, impressions: now.impressions, status };
  });
}

export function buckets(rows) {
  const b = { "1-3": 0, "4-10": 0, "11-20": 0, "21-50": 0, "51+": 0, "not ranking": 0 };
  for (const r of rows) { const p = r.position; b[p == null ? "not ranking" : p <= 3 ? "1-3" : p <= 10 ? "4-10" : p <= 20 ? "11-20" : p <= 50 ? "21-50" : "51+"]++; }
  return b;
}

/** Visibility index 0 to 100 over the tracked set (see WEIGHT). */
export const visibility = (rows, key = "position") => (rows.length ? Number(((rows.reduce((n, r) => n + weight(r[key]), 0) / rows.length) * 100).toFixed(1)) : 0);

/**
 * Live check. `serps` = { query: { results:[{domain,position,url}], features:[{type,domains}], aiSources } }.
 * Returns per query the site's live position and features held, and share of voice per domain across the tracked set.
 */
export function liveCheck(serps = {}, ownDomain) {
  const own = String(ownDomain).replace(/^www\./, "").toLowerCase();
  const isOwn = (d) => d === own || d.endsWith(`.${own}`);
  const perQuery = [], sov = new Map();
  const queries = Object.keys(serps);
  for (const q of queries) {
    const s = serps[q] || {};
    if (s.error) { perQuery.push({ query: q, error: s.error }); continue; }
    const best = new Map();
    for (const r of s.results || []) if (!best.has(r.domain) || r.position < best.get(r.domain)) best.set(r.domain, r.position);
    for (const [d, p] of best) sov.set(d, (sov.get(d) || 0) + weight(p));
    const mine = [...best].find(([d]) => isOwn(d));
    const features = (s.features || []).map((f) => ({ type: f.type, held: (f.domains || []).some(isOwn), by: (f.domains || []).filter((d) => !isOwn(d)).slice(0, 3) }));
    perQuery.push({ query: q, livePosition: mine ? mine[1] : null, url: mine ? (s.results.find((r) => isOwn(r.domain))?.url || "") : "", features, top3: (s.results || []).slice(0, 3).map((r) => r.domain), results: (s.results || []).slice(0, 10).map((r) => ({ domain: r.domain, position: r.position, url: r.url || "" })), aiCited: (s.aiSources || []).some((a) => isOwn(a.domain)) });
  }
  const n = queries.length || 1;
  const share = [...sov].map(([domain, w]) => ({ domain, share: Number(((w / n) * 100).toFixed(1)), own: isOwn(domain) })).sort((a, b) => b.share - a.share);
  const featureCounts = {};
  for (const r of perQuery) for (const f of r.features || []) { const c = (featureCounts[f.type] ||= { shown: 0, held: 0 }); c.shown++; if (f.held) c.held++; }
  return { perQuery, shareOfVoice: share.slice(0, 20), ownShare: share.find((x) => x.own)?.share ?? 0, competitors: share.filter((x) => !x.own).slice(0, 10), features: featureCounts };
}

/** Biggest movers and the summary row kept in history. */
export function summarise(rows, today) {
  const ranked = rows.filter((r) => r.position != null);
  const avg = ranked.length ? Number((ranked.reduce((n, r) => n + r.position, 0) / ranked.length).toFixed(1)) : null;
  const moved = rows.filter((r) => r.change != null);
  return {
    date: today, tracked: rows.length, ranking: ranked.length, averagePosition: avg, visibility: visibility(rows), visibilityLastWeek: visibility(rows, "previous"), buckets: buckets(rows),
    gainers: [...moved].sort((a, b) => b.change - a.change).filter((r) => r.change >= 1).slice(0, 10),
    losers: [...moved].sort((a, b) => a.change - b.change).filter((r) => r.change <= -1).slice(0, 10),
    lost: rows.filter((r) => r.status === "lost").map((r) => r.query), new: rows.filter((r) => r.status === "new").map((r) => r.query),
  };
}

export function rankMarkdown({ siteName, summary: s, rows, live = null, basis, history = [] }) {
  const L = [`# ${siteName} rank tracker, ${s.date}`, ""];
  L.push(`Tracking ${s.tracked} queries (${basis}). Positions are Search Console averages for the 7 days ending 3 days ago, across all places and devices.`, "");
  L.push(`- Visibility index: **${s.visibility}** (last week ${s.visibilityLastWeek}; 100 = every tracked query at position 1)`);
  L.push(`- Ranking: ${s.ranking} of ${s.tracked}; average position ${s.averagePosition ?? "-"}`);
  L.push(`- Positions: ${Object.entries(s.buckets).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  if (history.length > 1) L.push(`- Visibility trend: ${history.slice(-8).map((h) => `${h.date.slice(5)} ${h.visibility}`).join(", ")}`);
  const mv = (r) => `- ${r.query}: ${r.previous} to ${r.position} (${r.change > 0 ? "+" : ""}${r.change})`;
  L.push("", "## Gained", ...(s.gainers.length ? s.gainers.map(mv) : ["- none"]), "", "## Lost ground", ...(s.losers.length ? s.losers.map(mv) : ["- none"]));
  if (s.lost.length) L.push("", `## Dropped out (no impressions this week): ${s.lost.join(", ")}`);
  if (live) {
    L.push("", `## Live check (${live.provider}, ${live.market}, one moment)`, `- Your share of voice: **${live.ownShare}%** of the tracked set`);
    L.push(`- Competitors by share of voice: ${live.competitors.map((c) => `${c.domain} ${c.share}%`).join(", ") || "-"}`);
    L.push(`- Search features: ${Object.entries(live.features).map(([t, c]) => `${t} shown on ${c.shown}, held on ${c.held}`).join("; ") || "none recorded"}`);
    const opp = live.perQuery.filter((r) => (r.features || []).some((f) => !f.held && ["featured-snippet", "people-also-ask", "video", "local-pack"].includes(f.type)) && r.livePosition != null && r.livePosition <= 10);
    if (opp.length) L.push("", "### Features you could win (you are on page one, someone else holds the feature)", ...opp.slice(0, 15).map((r) => `- ${r.query} (live ${r.livePosition}): ${r.features.filter((f) => !f.held).map((f) => `${f.type}${f.by.length ? ` held by ${f.by.join(", ")}` : ""}`).join("; ")}`));
  }
  L.push("", "## All tracked queries", "", "| Query | Position | Last week | 4 weeks ago | Clicks | Impressions | Status |", "|---|---|---|---|---|---|---|");
  for (const r of rows) L.push(`| ${r.query} | ${r.position ?? "-"} | ${r.previous ?? "-"} | ${r.monthAgo ?? "-"} | ${r.clicks} | ${r.impressions} | ${r.status} |`);
  return L.join("\n") + "\n";
}
