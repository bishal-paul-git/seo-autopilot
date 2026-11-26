// Watch and undo (decision D17, level "undo"): after the autopilot publishes a change, check it and recommend reverting
// when it made things worse. Pure: pass what was observed, get a verdict back. The workflow does the fetching and reverting.
//
// Signals, strongest first:
//  1. a changed page now answers an error (404, 410, 5xx): revert at once;
//  2. the change itself added a noindex: revert at once (the autopilot never has a reason to);
//  3. clicks fell clearly more than the rest of the site over the 14 days after the change (the experiments method: a
//     control group of untouched pages adjusts for seasonality). Only with enough traffic, and only once the window is complete.
// Not judged: indexing status before vs after (no per-change snapshot exists), rankings for single queries (too noisy).

import { evaluate, controlGroup } from "./experiments.mjs";

export const WATCH_DEFAULTS = { span: 14, lag: 3, minImpressions: 100, minClicksLost: 10, dropWithControl: -0.4, dropWithoutControl: -0.5 };

/** The pages a change touched: every page whose file is one of the changed files (a JSON file may hold several pages). */
export function pagesForFiles(files = [], pages = []) {
  const norm = (f) => String(f || "").split("\\").join("/");
  return [...new Set(pages.filter((p) => p.url && p.file && files.some((f) => norm(p.file).endsWith("/" + norm(f)) || norm(p.file) === norm(f))).map((p) => p.url))];
}

const day = (iso) => String(iso).slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

/**
 * The click rule shared by both watches: each page's clicks over `o.span` days after the change (from `o.lag` days on)
 * against the same number of days before, adjusted by the untouched pages over the same dates (the control group).
 * A page counts as harmed when its adjusted drop is at least the limit and it lost at least `o.minClicksLost` clicks.
 * Pushes one line per page into `reasons`; returns the clicks lost on harmed pages and the worst drop.
 */
function clickHarm(urls, date, { series = {}, today, watched = new Set() }, o, reasons) {
  let lost = 0, worst = null;
  for (const u of urls) {
    const r = evaluate({ url: u, change: "watched change", date }, series, today, { span: o.span, lag: o.lag, controls: controlGroup({ date }, series, watched, { span: o.span, lag: o.lag }) });
    if (r.status !== "done" || r.before.impressions < o.minImpressions) { reasons.push(`${u}: ${r.status === "done" ? "too little traffic to judge" : r.status}`); continue; }
    const drop = r.control?.adjustedClicksChange ?? r.clicksChange;
    const limit = r.control ? o.dropWithControl : o.dropWithoutControl;
    const clicksLost = r.before.clicks - r.after.clicks;
    reasons.push(`${u}: clicks ${r.before.clicks} -> ${r.after.clicks}${r.control ? ` (${Math.round((drop ?? 0) * 100)}% against ${r.control.pages} untouched pages)` : " (no control group)"}`);
    if (drop != null && drop <= limit && clicksLost >= o.minClicksLost) { lost += clicksLost; worst = Math.min(worst ?? 0, drop); }
  }
  return { lost, worst };
}

/**
 * change: { pr, mergedAt, urls, addedNoindex }. live: { url: { status, noindex } } fetched today. series: page-daily.json.
 * Returns { pr, verdict: "revert" | "watch" | "keep", reasons, done } where done means the watch window is over.
 */
/**
 * A page failing (error status, or a noindex the change added) must fail on two check days in a row before anything is
 * reverted: one failed fetch can be a network error, a firewall (403) or a short outage (503). prev: { days, last } kept
 * by the job; a second run on the same day does not count twice. Returns the new state.
 */
export function failStreak(prev, failing, today) {
  if (!failing) return { days: 0, last: "" };
  const p = prev && prev.days ? prev : { days: 0, last: "" };
  return p.last === today ? p : { days: p.days + 1, last: today };
}
export const FAIL_DAYS = 2;
const failLines = (urls, live, addedNoindex) => [
  ...urls.filter((u) => (live[u]?.status ?? 200) >= 400).map((u) => `${u} answers ${live[u].status}`),
  ...(addedNoindex && urls.some((u) => live[u]?.noindex) ? ["the change added a noindex and the page now carries it"] : []),
];

export function judgeChange(change, { live = {}, series = {}, today, watched = new Set() } = {}, o = WATCH_DEFAULTS) {
  const reasons = [], urls = change.urls || [];
  const fails = failLines(urls, live, change.addedNoindex);
  const failing = failStreak(change.failing, fails.length > 0, today);
  if (fails.length && failing.days >= FAIL_DAYS) return { pr: change.pr, verdict: "revert", reasons: [...fails, `on ${failing.days} check days in a row`], done: true, failing };
  if (fails.length) return { pr: change.pr, verdict: "watch", reasons: [...fails, "checked again on the next run before anything is reverted (one failed check can be a network error, a firewall or a short outage)"], done: false, failing };
  const date = day(change.mergedAt);
  const end = addDays(addDays(date, o.lag), o.span - 1);
  if (!urls.length) return { pr: change.pr, verdict: "keep", reasons: ["no page URL is known for the changed files (set content.urlPattern), so only the build checks applied"], done: true };
  if (today <= end) return { pr: change.pr, verdict: "watch", reasons: [`pages answer normally; traffic is compared after ${addDays(end, 1)}`], done: false, failing };
  const { lost, worst } = clickHarm(urls, date, { series, today, watched }, o, reasons);
  if (lost) return { pr: change.pr, verdict: "revert", reasons: [`clicks fell ${Math.round(-worst * 100)}% more than the rest of the site (${lost} clicks lost over ${o.span} days)`, ...reasons], done: true, failing };
  return { pr: change.pr, verdict: "keep", reasons: reasons.length ? reasons : ["no regression found"], done: true, failing };
}

// ------------------------------------------------------------------------------------------------------------------------
// Content watch (O7): every refresh and every new page the SEO tool merged (seo/* branches, merged by a person or by the
// autopilot) is watched for `days` days after a short lag. Unlike the "undo" watch above it does not need the autopilot:
// it only ever OPENS a pull request (labelled seo-revert); whether that merges by itself is decided elsewhere, and a
// revert of a refresh or of a new page always waits for a person.
//  - refresh: same rules as the undo watch (the page errors, the change added a noindex, clicks fell clearly more than the
//    rest of the site), judged once `minSpan` days of data exist after the lag and every day after that until the window
//    ends. The revert restores the previous content (git revert of the merge commit).
//  - new page: a new page has no "before", so the harm it can do is to the pages it competes with. The existing pages
//    whose keyword or title overlap most with it are judged with the click rule, from the day it was merged; when they
//    lost clearly more than the rest of the site and the new page did not win those clicks back, it is unpublished
//    through the content adapter (draft field), never deleted and never moved to another URL.

export const CONTENT_WATCH_DEFAULTS = { days: 28, lag: 3, minSpan: 14, related: 3, minOverlap: 0.6, maxUrls: 20 };

const STOPWORDS = new Set(["the", "and", "for", "with", "how", "what", "why", "are", "your", "you", "our", "from", "this", "that", "best", "guide", "vs", "can", "does", "into", "about", "when", "who", "which", "will", "not", "all", "its", "use", "using"]);
/** Topic words of a title or keyword, in any script (letters, digits, combining marks). */
export function topicWords(s) {
  return [...new Set((String(s || "").toLowerCase().normalize("NFC").match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) || []).filter((w) => [...w].length > 2 && !STOPWORDS.has(w)))];
}

/** The existing pages a new page competes with most: share of the new page's topic words they also carry (keyword or title). */
export function relatedPages(page, pages = [], o = CONTENT_WATCH_DEFAULTS) {
  const want = topicWords(`${page.keyword || ""} ${page.title || ""}`);
  if (!want.length) return [];
  return pages
    .filter((p) => p.url && p.url !== page.url)
    .map((p) => { const have = new Set(topicWords(`${p.keyword || ""} ${p.title || ""}`)); return { url: p.url, overlap: want.filter((w) => have.has(w)).length / want.length }; })
    .filter((p) => p.overlap >= o.minOverlap)
    .sort((a, b) => b.overlap - a.overlap || a.url.localeCompare(b.url))
    .slice(0, o.related)
    .map((p) => p.url);
}

const sumClicks = (s, from, to) => { let c = 0; for (let d = from; d <= to; d = addDays(d, 1)) c += s?.[d]?.[0] ?? 0; return c; };
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

/** Last day of an entry's watch window. */
export const watchUntil = (mergedAt, o = CONTENT_WATCH_DEFAULTS) => addDays(day(mergedAt), o.lag + o.days);

/**
 * Add newly merged changes to the watch list and keep the rest. list: earlier entries; found: entries built for merged pull
 * requests seen today. A change already listed keeps its history; one whose window is already over is not added.
 */
export function mergeWatchlist(list = [], found = [], today, o = CONTENT_WATCH_DEFAULTS) {
  const out = [...list], seen = new Set(list.map((e) => e.pr));
  for (const e of found) {
    if (seen.has(e.pr)) continue;
    const until = watchUntil(e.mergedAt, o);
    if (today > until) continue;
    out.push({ ...e, until, status: "watching", reasons: [] });
    seen.add(e.pr);
  }
  return out;
}

/**
 * Judge one watched refresh or new page. entry: { pr, kind: "refresh" | "new-page", mergedAt, urls, newPages: [{ url }],
 * related: [url], addedNoindex }. Returns { verdict: "revert" | "watch" | "keep", reasons, done }.
 */
export function judgeContent(entry, { live = {}, series = {}, today, watched = new Set() } = {}, o = CONTENT_WATCH_DEFAULTS, rules = WATCH_DEFAULTS) {
  const isNew = entry.kind === "new-page";
  // A new page is judged from the day it went live (its publish date, or the first check that found it live), not from
  // the merge: a page queued for later has done nothing yet.
  const date = isNew ? [day(entry.mergedAt), entry.publishAt ? day(entry.publishAt) : "", entry.liveSince || ""].filter(Boolean).sort().pop() : day(entry.mergedAt);
  const end = addDays(date, o.lag + o.days);
  // Days of data after the lag, up to the last day Search Console has data for (it runs 2-3 days behind), so the window
  // after the change is never padded with days that simply have no data yet.
  let last = addDays(today, -1);
  { let seen = ""; for (const s of Object.values(series || {})) for (const d of Object.keys(s || {})) if (d > seen) seen = d; if (seen && seen < last) last = seen; }
  const span = Math.min(o.days, daysBetween(date, last) + 1 - o.lag);
  const asOf = addDays(date, o.lag + Math.max(span, 0)); // the day after the after-window, for evaluate()
  const r = { ...rules, lag: o.lag, span };
  const over = today > end;
  if (isNew) {
    const urls = (entry.newPages || []).map((p) => p.url).filter(Boolean);
    if (!urls.length) return { verdict: "keep", reasons: ["no page URL is known for the new page (set content.urlPattern or a path), so it cannot be watched"], done: true, until: end };
    // A page that is not live (404, any error, a failed fetch, or noindex) is never unpublished: there is nothing to take
    // off the site, and its window has not started. Given up 180 days after the merge.
    const notLive = urls.filter((u) => (live[u]?.status ?? 200) >= 400 || live[u]?.noindex);
    if (notLive.length) {
      const gaveUp = today > addDays(day(entry.mergedAt), 180);
      return { verdict: gaveUp ? "keep" : "watch", reasons: [...notLive.map((u) => `${u} ${live[u]?.noindex ? "carries a noindex" : `answers ${live[u].status}`}: not live (not published yet, or already off the site), so it is never unpublished`), ...(gaveUp ? ["still not live 180 days after the merge; no longer watched"] : [])], done: gaveUp, until: end, live: false };
    }
    const reasons = [];
    const related = entry.related || [];
    if (!related.length) return { verdict: over ? "keep" : "watch", reasons: [...reasons, "no existing page shares its topic, so it cannot be taking their clicks"], done: over, until: end, live: true };
    if (span < o.minSpan) return { verdict: "watch", reasons: [...reasons, `pages on the same topic (${related.join(", ")}) are compared after ${addDays(date, o.lag + o.minSpan)}`], done: false, until: end, live: true };
    const lines = [];
    const { lost, worst } = clickHarm(related, date, { series, today: asOf, watched: new Set([...watched, ...urls, ...related]) }, r, lines);
    const from = addDays(date, o.lag), to = addDays(from, span - 1);
    const won = urls.reduce((n, u) => n + sumClicks(series[u], from, to), 0);
    if (lost && won < lost) return { verdict: "revert", reasons: [`pages on the same topic lost ${lost} clicks (${Math.round(-worst * 100)}% more than the rest of the site) over ${span} days while the new page got ${won}: it looks like it is taking their place in search rather than adding to it`, ...reasons, ...lines], done: true, until: end, live: true };
    if (lost) lines.unshift(`pages on the same topic lost ${lost} clicks, but the new page got ${won}: the clicks moved to it, so it stays`);
    return { verdict: over ? "keep" : "watch", reasons: [...reasons, ...(lines.length ? lines : ["no regression found"])], done: over, until: end, live: true };
  }
  const urls = (entry.urls || []).slice(0, o.maxUrls);
  if (!urls.length) return { verdict: "keep", reasons: ["no page URL is known for the changed files (set content.urlPattern), so only the build checks applied"], done: true };
  const fails = failLines(urls, live, entry.addedNoindex);
  const failing = failStreak(entry.failing, fails.length > 0, today);
  if (fails.length && failing.days >= FAIL_DAYS) return { verdict: "revert", reasons: [...fails, `on ${failing.days} check days in a row`], done: true, failing };
  if (fails.length) return { verdict: "watch", reasons: [...fails, "checked again on the next run before anything is reverted (one failed check can be a network error, a firewall or a short outage)"], done: false, failing };
  if (span < o.minSpan) return { verdict: "watch", reasons: [`pages answer normally; clicks are compared from ${addDays(date, o.lag + o.minSpan)} until ${end}`], done: false, failing };
  const lines = [];
  const { lost, worst } = clickHarm(urls, date, { series, today: asOf, watched }, r, lines);
  if (lost) return { verdict: "revert", reasons: [`clicks fell ${Math.round(-worst * 100)}% more than the rest of the site (${lost} clicks lost over ${span} days after the refresh)`, ...lines], done: true, failing };
  return { verdict: over ? "keep" : "watch", reasons: lines.length ? lines : ["no regression found"], done: over, failing };
}
