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
 * change: { pr, mergedAt, urls, addedNoindex }. live: { url: { status, noindex } } fetched today. series: page-daily.json.
 * Returns { pr, verdict: "revert" | "watch" | "keep", reasons, done } where done means the watch window is over.
 */
export function judgeChange(change, { live = {}, series = {}, today, watched = new Set() } = {}, o = WATCH_DEFAULTS) {
  const reasons = [], urls = change.urls || [];
  const broken = urls.filter((u) => (live[u]?.status ?? 200) >= 400);
  if (broken.length) return { pr: change.pr, verdict: "revert", reasons: broken.map((u) => `${u} now answers ${live[u].status}`), done: true };
  if (change.addedNoindex && urls.some((u) => live[u]?.noindex)) return { pr: change.pr, verdict: "revert", reasons: ["the change added a noindex and the page now carries it"], done: true };
  const date = day(change.mergedAt);
  const end = addDays(addDays(date, o.lag), o.span - 1);
  if (!urls.length) return { pr: change.pr, verdict: "keep", reasons: ["no page URL is known for the changed files (set content.urlPattern), so only the build checks applied"], done: true };
  if (today <= end) return { pr: change.pr, verdict: "watch", reasons: [`pages answer normally; traffic is compared after ${addDays(end, 1)}`], done: false };
  let lost = 0, worst = null;
  for (const u of urls) {
    const r = evaluate({ url: u, change: `PR #${change.pr}`, date }, series, today, { span: o.span, lag: o.lag, controls: controlGroup({ date }, series, watched, { span: o.span, lag: o.lag }) });
    if (r.status !== "done" || r.before.impressions < o.minImpressions) { reasons.push(`${u}: ${r.status === "done" ? "too little traffic to judge" : r.status}`); continue; }
    const drop = r.control?.adjustedClicksChange ?? r.clicksChange;
    const limit = r.control ? o.dropWithControl : o.dropWithoutControl;
    const clicksLost = r.before.clicks - r.after.clicks;
    reasons.push(`${u}: clicks ${r.before.clicks} -> ${r.after.clicks}${r.control ? ` (${Math.round((drop ?? 0) * 100)}% against ${r.control.pages} untouched pages)` : " (no control group)"}`);
    if (drop != null && drop <= limit && clicksLost >= o.minClicksLost) { lost += clicksLost; worst = Math.min(worst ?? 0, drop); }
  }
  if (lost) return { pr: change.pr, verdict: "revert", reasons: [`clicks fell ${Math.round(-worst * 100)}% more than the rest of the site (${lost} clicks lost over ${o.span} days)`, ...reasons], done: true };
  return { pr: change.pr, verdict: "keep", reasons: reasons.length ? reasons : ["no regression found"], done: true };
}
