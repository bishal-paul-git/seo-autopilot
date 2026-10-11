// SEO experiments: log a change, then compare the 14 days after it with the 14 days before. This is a before/after
// comparison on one page with no control group, so results are DIRECTIONAL: seasonality, news and other changes also move
// numbers. The report says so every time. Input: per-page daily series { page: { "YYYY-MM-DD": [clicks, impressions, position] } }.

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

/** exp = { url, change, date }. Returns a status and numbers once the after-window is complete. */
export function evaluate(exp, series, today, { span = 14, lag = 3 } = {}) {
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
  res.note = "Directional only: no control group, so seasonality or other changes may explain it.";
  return res;
}
