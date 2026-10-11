// Daily report: Search Console totals, URL Inspection for the next batch of sitemap URLs, near-miss queries.
// Read-only against Google; writes <stateDir>/<site>/daily-summary.md, proposals.json and inspect-state.json.
// It changes nothing on any website.
import { existsSync } from "node:fs";
import { getToken, SCOPES, searchAnalytics } from "../lib/google-auth.mjs";
import { ingest } from "../lib/ingest.mjs";
import { readJson, writeJson, writeText, dayOf } from "../core/util.mjs";

export const description = "Search Console report, URL inspection of the next sitemap URLs, and proposal candidates";

export async function run({ site, flags }) {
  const dir = site.paths.state;
  const stateFile = `${dir}/inspect-state.json`;
  const state = readJson(stateFile, { results: {} });
  const { token } = await getToken([SCOPES.searchConsole]);
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const sm = await (await fetch(site.sitemap)).text();
  const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const order = [...urls].sort((a, b) => (state.results[a]?.checkedAt || "").localeCompare(state.results[b]?.checkedAt || ""));

  let done = 0;
  for (const url of order.slice(0, flags.limit ?? site.inspectPerDay)) {
    const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      method: "POST", headers: auth, body: JSON.stringify({ inspectionUrl: url, siteUrl: site.searchConsoleProperty }),
    });
    const j = await r.json();
    if (j.error) { console.log(site.id, "error", url, j.error.message); if ([429, 403].includes(j.error.code)) break; continue; }
    const x = j.inspectionResult?.indexStatusResult || {};
    state.results[url] = { checkedAt: new Date().toISOString(), coverage: x.coverageState, fetch: x.pageFetchState, googleCanonical: x.googleCanonical, lastCrawl: x.lastCrawlTime };
    done++;
  }
  writeJson(stateFile, state);

  const end = Date.now() - 2 * 864e5, start = end - 27 * 864e5;
  const q = searchAnalytics(site, token);
  const [tot, queries, pages] = await Promise.all([q(dayOf(start), dayOf(end), [], 1), q(dayOf(start), dayOf(end), ["query"], 100), q(dayOf(start), dayOf(end), ["page"], 100)]);
  const T = tot[0] || {};

  // Rows for the analysis jobs: query x page for this window and the one before it, and a per-page daily history that
  // grows over time (Search Console itself only keeps about 16 months).
  const slim = (rows) => rows.map((r) => ({ query: r.keys[0], page: r.keys[1], clicks: r.clicks, impressions: r.impressions, position: Number(r.position.toFixed(1)) }));
  const prevEnd = start - 864e5, prevStart = prevEnd - 27 * 864e5;
  const [rowsNow, rowsPrev] = await Promise.all([q(dayOf(start), dayOf(end), ["query", "page"], 5000), q(dayOf(prevStart), dayOf(prevEnd), ["query", "page"], 5000)]);
  writeJson(`${dir}/gsc-rows.json`, { generatedAt: new Date().toISOString(), window: { start: dayOf(start), end: dayOf(end) }, prevWindow: { start: dayOf(prevStart), end: dayOf(prevEnd) }, rows: slim(rowsNow), prevRows: slim(rowsPrev) });
  const dailyFile = `${dir}/page-daily.json`;
  const pageDaily = readJson(dailyFile, {});
  const dailyFrom = Object.keys(pageDaily).length ? end - 5 * 864e5 : start;
  for (const r of await q(dayOf(dailyFrom), dayOf(end), ["date", "page"], 25000)) { (pageDaily[r.keys[1]] ||= {})[r.keys[0]] = [r.clicks, r.impressions, Number(r.position.toFixed(1))]; }
  writeJson(dailyFile, pageDaily);
  const p = (u) => u.replace(site.url, "/");
  const notIndexed = Object.entries(state.results).filter(([, v]) => v.coverage !== "Submitted and indexed");
  const nearRows = queries.filter((r) => r.position > 5 && r.position < 20 && r.impressions >= 3).slice(0, 10);
  const lowCtr = pages.filter((r) => r.impressions >= 10 && r.clicks === 0).slice(0, 8);

  const md = `# ${site.name} SEO daily summary ${dayOf(Date.now())}

Search Console ${dayOf(start)} to ${dayOf(end)}: ${T.clicks ?? 0} clicks, ${T.impressions ?? 0} impressions, avg position ${(T.position ?? 0).toFixed(1)}.
Inspected ${done} pages today. ${notIndexed.length} of ${Object.keys(state.results).length} known pages are not indexed.

## Not indexed
${notIndexed.slice(0, 30).map(([u, v]) => `- ${p(u)} (${v.coverage})`).join("\n") || "- none"}

## Near-miss queries (positions 5-20): candidates for a new page or a better title
${nearRows.map((r) => `- "${r.keys[0]}": pos ${r.position.toFixed(1)}, ${r.impressions} impr`).join("\n") || "- none yet"}

## Pages with impressions but no clicks: rewrite title and description
${lowCtr.map((r) => `- ${p(r.keys[0])}: ${r.impressions} impr, 0 clicks`).join("\n") || "- none yet"}
`;
  writeText(`${dir}/daily-summary.md`, md);

  // History for the dashboard charts: one row per day, newest wins, last 400 days kept.
  const histFile = `${dir}/history.json`;
  const history = readJson(histFile, []).filter((h) => h.day !== dayOf(Date.now()));
  history.push({
    day: dayOf(Date.now()), clicks: T.clicks ?? 0, impressions: T.impressions ?? 0, position: Number((T.position ?? 0).toFixed(2)),
    inspected: Object.keys(state.results).length, indexed: Object.keys(state.results).length - notIndexed.length, notIndexed: notIndexed.length,
  });
  writeJson(histFile, history.slice(-400));

  const candidates = [
    ...nearRows.map((r) => ({ kind: "near-miss", key: r.keys[0], data: `position ${r.position.toFixed(1)}, ${r.impressions} impressions` })),
    ...lowCtr.filter((r) => r.position <= 20).map((r) => ({ kind: "no-clicks", key: p(r.keys[0]), data: `${r.impressions} impressions, 0 clicks` })),
    ...notIndexed.filter(([, v]) => /unknown/i.test(v.coverage || "")).slice(0, 5).map(([u, v]) => ({ kind: "undiscovered", key: p(u), data: v.coverage })),
  ];
  writeJson(`${dir}/proposals.json`, { site: site.id, day: dayOf(Date.now()), candidates });

  await ingest(site, {
    summary: { day: dayOf(Date.now()), clicks: T.clicks ?? 0, impressions: T.impressions ?? 0, ctr: T.ctr ?? 0, position: T.position ?? 0, inspected: Object.keys(state.results).length, not_indexed: notIndexed.length },
    inspections: Object.entries(state.results).map(([url, v]) => ({ url, checked_at: v.checkedAt, coverage: v.coverage ?? null, fetch_state: v.fetch ?? null, last_crawl: v.lastCrawl ?? null, google_canonical: v.googleCanonical ?? null })),
  });
  console.log(md);
}
