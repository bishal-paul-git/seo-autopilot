// Rank tracker: daily positions for your tracked queries from Search Console (free, your own data), kept as history beyond
// Search Console's 16 months, with movers, a visibility index and position buckets. With --serp it also checks the live
// results through your SERP provider: search features and who holds them, competitors and share of voice.
//   npx seo-autopilot run rank [--serp] [--offline]
// Tracked queries: <data>/tracked-queries.json (strings), else the top 50 non-brand queries by impressions.
// Writes query-daily.json (history), rank.json, rank.md and rank-history.json in the state folder.
import { readJson, writeJson, writeText, today as todayFn, addDays, sleep } from "../core/util.mjs";
import { getToken, SCOPES, searchAnalytics } from "../lib/google-auth.mjs";
import { pickProvider } from "../lib/serp.mjs";
import { trackedSet, mergeSeries, trackQueries, summarise, liveCheck, rankMarkdown } from "../analysis/rank.mjs";
import { marketOf } from "./keywords.mjs";

export const description = "Rank tracker: tracked query positions over time from Search Console, movers and visibility; --serp adds live features and share of voice";

const KEEP_DAYS = 480, PAGE = 25000;

/** All date x query rows for a window, paging through Search Console's 25,000-row limit (at most 8 pages). */
async function fetchRows(query, from, to) {
  const out = [];
  for (let page = 0; page < 8; page++) {
    const rows = await query(from, to, ["date", "query"], PAGE, { startRow: page * PAGE });
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** `deps`: query (a Search Console query function), env, fetch, delayMs, today. For tests and offline use. */
export async function run({ site, flags = {} }, deps = {}) {
  const env = deps.env || process.env, s = site.paths.state, day = deps.today || todayFn();
  const seriesFile = `${s}/query-daily.json`;
  let series = readJson(seriesFile, {});
  const gscRows = readJson(`${s}/gsc-rows.json`, { rows: [] }).rows || [];
  const tracked = trackedSet(readJson(`${site.paths.data}/tracked-queries.json`, []), gscRows, { brandTerms: site.brandTerms || [] });
  if (!tracked.queries.length) { console.log("rank: nothing to track yet. Add queries to tracked-queries.json, or run the daily job so Search Console rows exist."); return; }

  if (!flags.offline) {
    const query = deps.query || searchAnalytics(site, (await getToken([SCOPES.searchConsole])).token);
    const first = !Object.keys(series).length;
    const rows = await fetchRows(query, addDays(day, first ? -92 : -12), addDays(day, -2));
    const byImp = new Map();
    for (const r of rows) { const q = String(r.keys[1]).toLowerCase(); byImp.set(q, (byImp.get(q) || 0) + r.impressions); }
    const keep = new Set([...tracked.queries, ...Object.keys(series), ...[...byImp].sort((a, b) => b[1] - a[1]).slice(0, 300).map(([q]) => q)]);
    series = mergeSeries(series, rows, keep);
    const cutoff = addDays(day, -KEEP_DAYS);
    for (const q of Object.keys(series)) { for (const d of Object.keys(series[q])) if (d < cutoff) delete series[q][d]; if (!Object.keys(series[q]).length) delete series[q]; }
    writeJson(seriesFile, series);
  }

  const rows = trackQueries(series, tracked.queries, day);
  const summary = summarise(rows, day);
  let live = null;
  if (flags.serp) {
    const provider = pickProvider(env);
    if (!provider) console.log("rank: --serp needs a SERP provider key (BRAVE_API_KEY, SERPAPI_KEY or DataForSEO). Positions above are from Search Console only.");
    else {
      const m = marketOf(site), serps = {}, limit = site.research?.serpLimit || 50;
      for (const [i, q] of tracked.queries.slice(0, limit).entries()) {
        if (i) await sleep(deps.delayMs ?? 1200);
        try { serps[q] = await provider.search(q, m, { fetch: deps.fetch || globalThis.fetch, env }); } catch (e) { serps[q] = { error: e.message }; }
      }
      live = { provider: provider.name, market: m, date: day, ...liveCheck(serps, new URL(site.url).hostname) };
    }
  }
  const histFile = `${s}/rank-history.json`;
  const history = readJson(histFile, []).filter((h) => h.date !== day);
  history.push({ date: day, tracked: summary.tracked, visibility: summary.visibility, averagePosition: summary.averagePosition, buckets: summary.buckets, ...(live ? { ownShare: live.ownShare } : {}) });
  writeJson(histFile, history.slice(-400));
  const previousLive = readJson(`${s}/rank.json`, {}).live || null;
  writeJson(`${s}/rank.json`, { generatedAt: new Date().toISOString(), basis: tracked.basis, summary, rows, live: live || previousLive, liveIsFromThisRun: Boolean(live) });
  const md = rankMarkdown({ siteName: site.name, summary, rows, live, basis: tracked.basis, history });
  writeText(`${s}/rank.md`, md);
  console.log(md);
}
