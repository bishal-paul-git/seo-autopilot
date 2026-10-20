// Page change monitor: fetches watched pages once each (robots.txt respected) and reports what changed since the last run.
//   npx seo-autopilot run changes
// Watched pages: <data>/watch-pages.json (URLs, or {"url": "...", "kind": "competitor"}), else your top 10 pages by clicks
// plus the competitor pages behind most of your gap queries (gap.json). At most 60.
// Writes page-snapshots.json (latest snapshot and a change log per page), changes.json and changes.md.
import { readJson, writeJson, writeText, today, sleep } from "../core/util.mjs";
import { politeFetch } from "./optimize.mjs";
import { snapshot, diff, changesMarkdown } from "../analysis/changes.mjs";

export const description = "Page change monitor: what changed on your key pages and competitor pages since the last check";

/** Watched pages: the user's list, else own top pages by clicks and competitors' winning pages. */
export function watchList(site, { list = [], rows = [], gap = null, max = 60 } = {}) {
  const host = new URL(site.url).hostname.replace(/^www\./, "");
  const kindOf = (u) => { try { const h = new URL(u).hostname.replace(/^www\./, ""); return h === host || h.endsWith(`.${host}`) ? "yours" : "competitor"; } catch { return null; } };
  const own = list.map((x) => (typeof x === "string" ? { url: x } : x)).filter((x) => x?.url && !/^replace/i.test(x.url) && kindOf(x.url));
  if (own.length) return own.slice(0, max).map((x) => ({ url: x.url, kind: x.kind || kindOf(x.url) }));
  const clicks = new Map();
  for (const r of rows) clicks.set(r.page, (clicks.get(r.page) || 0) + (r.clicks || 0));
  const mine = [...clicks].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([url]) => ({ url, kind: "yours" }));
  const theirs = (gap?.pages || []).slice(0, 15).map((p) => ({ url: p.url, kind: "competitor" }));
  return [...mine, ...theirs].filter((x) => kindOf(x.url)).slice(0, max);
}

export async function run({ site }, deps = {}) {
  const f = deps.fetch || globalThis.fetch, s = site.paths.state, day = deps.today || today();
  const list = watchList(site, { list: readJson(`${site.paths.data}/watch-pages.json`, []), rows: readJson(`${s}/gsc-rows.json`, { rows: [] }).rows || [], gap: readJson(`${s}/gap.json`, null) });
  if (!list.length) { console.log("changes: nothing to watch yet. List URLs in seo-autopilot/watch-pages.json, or run the daily and gap jobs first."); return; }
  const store = readJson(`${s}/page-snapshots.json`, {});
  const results = [];
  for (const [i, w] of list.entries()) {
    if (i) await sleep(deps.delayMs ?? 800);
    const got = await politeFetch(w.url, f);
    if (got.error) { results.push({ ...w, error: got.error, changes: [] }); continue; }
    const snap = snapshot(got.html, w.url, { date: day });
    const prev = store[w.url]?.latest || null;
    const changes = diff(prev, snap);
    const log = store[w.url]?.log || [];
    if (prev && changes.length) log.push({ date: day, changes });
    store[w.url] = { kind: w.kind, latest: snap, log: log.slice(-30) };
    results.push({ ...w, changes: prev ? changes : [{ field: "new", note: "first snapshot" }] });
  }
  writeJson(`${s}/page-snapshots.json`, store);
  writeJson(`${s}/changes.json`, { generatedAt: new Date().toISOString(), date: day, results });
  const md = changesMarkdown({ siteName: site.name, results, date: day });
  writeText(`${s}/changes.md`, md);
  console.log(md);
}
