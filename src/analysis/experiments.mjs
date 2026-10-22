// SEO experiments: log a change, then compare the 14 days after it with the 14 days before.
// When enough untouched pages exist, the same windows are measured on them as a CONTROL GROUP and the result is adjusted for
// what happened to the site as a whole (seasonality, news, algorithm updates). That is a difference-in-differences read,
// still not a randomised test: the pages are not matched on topic or intent, so results stay directional and say so. Input: per-page daily series { page: { "YYYY-MM-DD": [clicks, impressions, position] } }.

const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

function window(series, from, to) {
  let clicks = 0, impressions = 0, posWeighted = 0, days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = series?.[d];
    if (!v) continue;
    clicks += v[0]; impressions += v[1]; posWeighted += v[2] * v[1]; days++;
  }
  return { clicks, impressions, position: impressions ? posWeighted / impressions : null, ctr: impressions ? clicks / impressions : null, days };
}

/**
 * Control group: every page that is not in the experiment log, with enough impressions in the before window.
 * Returns the combined change of those pages over the same two windows, or null when there are too few to trust.
 */
export function controlGroup(exp, series, excluded, { span = 14, lag = 3, minPages = 3, minImpressions = 100 } = {}) {
  const afterFrom = addDays(exp.date, lag), afterTo = addDays(afterFrom, span - 1);
  const beforeTo = addDays(exp.date, -1), beforeFrom = addDays(beforeTo, -(span - 1));
  let bc = 0, bi = 0, ac = 0, ai = 0, pages = 0;
  for (const [url, s] of Object.entries(series || {})) {
    if (excluded.has(url)) continue;
    const b = window(s, beforeFrom, beforeTo), a = window(s, afterFrom, afterTo);
    if (b.impressions < 10 || b.days < Math.ceil(span / 2)) continue;
    bc += b.clicks; bi += b.impressions; ac += a.clicks; ai += a.impressions; pages++;
  }
  if (pages < minPages || bi < minImpressions) return null;
  return { pages, beforeImpressions: bi, clicksChange: bc ? (ac - bc) / bc : null, impressionsChange: (ai - bi) / bi };
}

/** exp = { url, change, date }. Returns a status and numbers once the after-window is complete. `controls` comes from controlGroup(). */
export function evaluate(exp, series, today, { span = 14, lag = 3, controls = null } = {}) {
  const afterFrom = addDays(exp.date, lag), afterTo = addDays(afterFrom, span - 1);
  const beforeTo = addDays(exp.date, -1), beforeFrom = addDays(beforeTo, -(span - 1));
  const s = series?.[exp.url];
  if (!s) return { ...exp, status: "no data", note: "No daily data for this page yet. The daily job builds it up over time." };
  if (today <= afterTo) return { ...exp, status: "pending", note: `Ready on ${addDays(afterTo, 1)} (after-window of ${span} days must complete).` };
  const before = window(s, beforeFrom, beforeTo), after = window(s, afterFrom, afterTo);
  if (before.days < Math.ceil(span / 2) || after.days < Math.ceil(span / 2)) return { ...exp, status: "not enough data", before, after, note: "Too few days with data in a window to compare." };
  const change = (a, b) => (b ? (a - b) / b : null);
  const res = { ...exp, status: "done", before, after, clicksChange: change(after.clicks, before.clicks), impressionsChange: change(after.impressions, before.impressions), ctrChange: change(after.ctr, before.ctr) };
  const c = res.ctrChange;
  res.verdict = before.impressions < 50 ? "too little traffic to say anything" : c == null ? "unclear" : c > 0.15 ? "click-through improved" : c < -0.15 ? "click-through worsened" : "no clear change";
  if (controls) {
    const adj = (page, ctrl) => (page == null || ctrl == null ? null : (1 + page) / (1 + ctrl) - 1);
    res.control = { ...controls, adjustedClicksChange: adj(res.clicksChange, controls.clicksChange), adjustedImpressionsChange: adj(res.impressionsChange, controls.impressionsChange) };
    const ai = res.control.adjustedImpressionsChange;
    res.note = `Compared with ${controls.pages} other pages over the same dates, which changed ${Math.round(controls.impressionsChange * 100)}% in impressions. Directional only: those pages are not matched on topic or intent.`;
    if (before.impressions >= 50 && ai != null) res.verdict = ai > 0.15 ? "better than the rest of the site" : ai < -0.15 ? "worse than the rest of the site" : "in line with the rest of the site";
  } else res.note = "Directional only: too few untouched pages for a control group, so seasonality or other changes may explain it.";
  return res;
}

const META_FIELDS = { metaTitle: "title", metaDescription: "description", h1: "H1", title: "title" };

/**
 * Which pages had their title, description or H1 changed between two versions of a content list (arrays of page objects).
 * Returns [{ id, fields: ["title", "description"], change }] so each can be logged as an experiment. Pure: pass the parsed
 * lists, no git or file access here. New pages are not experiments (nothing to compare against).
 */
export function metaChanges(before = [], after = []) {
  const prev = new Map((Array.isArray(before) ? before : []).filter((x) => x && typeof x === "object").map((x) => [String(x.slug ?? x.id ?? ""), x]));
  const out = [];
  for (const it of Array.isArray(after) ? after : []) {
    if (!it || typeof it !== "object") continue;
    const id = String(it.slug ?? it.id ?? "");
    const old = prev.get(id);
    if (!id || !old) continue;
    const fields = [...new Set(Object.entries(META_FIELDS).filter(([k]) => old[k] != null && it[k] != null && old[k] !== it[k]).map(([, label]) => label))];
    if (fields.length) out.push({ id, fields, change: `${fields.join(", ")} rewritten` });
  }
  return out;
}
