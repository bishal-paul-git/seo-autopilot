// Real-user Core Web Vitals from the Chrome UX Report (CrUX): what Chrome users actually experienced over the last 28 days,
// and the weekly history of the last 25 periods. This is the field data Google uses, unlike lab tests on one machine.
// Pure: parse the API responses, grade them against Google's thresholds, find regressions.

export const THRESHOLDS = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], fcp: [1800, 3000], ttfb: [800, 1800] };
export const METRICS = { lcp: "largest_contentful_paint", inp: "interaction_to_next_paint", cls: "cumulative_layout_shift", fcp: "first_contentful_paint", ttfb: "experimental_time_to_first_byte" };
export const CORE = ["lcp", "inp", "cls"];

export const grade = (k, v) => (v == null ? null : v <= THRESHOLDS[k][0] ? "good" : v <= THRESHOLDS[k][1] ? "needs improvement" : "poor");
const num = (x) => (x == null ? null : Number(x));
const day = (d) => (d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null);

/** queryRecord response -> { p75: {lcp,...}, good: {lcp: share of good visits}, grades, passes, period }. */
export function parseRecord(j) {
  const m = j?.record?.metrics || {};
  const p75 = {}, good = {};
  for (const [k, name] of Object.entries(METRICS)) {
    const x = m[name];
    if (!x) continue;
    p75[k] = num(x.percentiles?.p75);
    if (x.histogram?.[0]) good[k] = Number(Number(x.histogram[0].density || 0).toFixed(3));
  }
  const grades = Object.fromEntries(Object.entries(p75).map(([k, v]) => [k, grade(k, v)]));
  const core = CORE.filter((k) => p75[k] != null);
  return { p75, good, grades, passes: core.length === 3 ? core.every((k) => grades[k] === "good") : null, period: { from: day(j?.record?.collectionPeriod?.firstDate), to: day(j?.record?.collectionPeriod?.lastDate) } };
}

/** queryHistoryRecord response -> { weeks: [to-dates], series: { lcp: [p75 or null] } }. */
export function parseHistory(j) {
  const m = j?.record?.metrics || {};
  const weeks = (j?.record?.collectionPeriods || []).map((p) => day(p.lastDate));
  const series = {};
  for (const [k, name] of Object.entries(METRICS)) { const s = m[name]?.percentilesTimeseries?.p75s; if (s) series[k] = s.map(num); }
  return { weeks, series };
}

/**
 * Regressions: the latest 4 periods against the 4 before them, per metric. Flags a worse grade, or a p75 at least 15%
 * worse that also crosses into "needs improvement" or "poor". Periods overlap (each is 28 days), so small moves are noise.
 */
export function regressions(history) {
  const out = [];
  for (const [k, s] of Object.entries(history.series || {})) {
    const vals = s.filter((v) => v != null);
    if (vals.length < 8) continue;
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const now = avg(vals.slice(-4)), before = avg(vals.slice(-8, -4));
    const order = { good: 0, "needs improvement": 1, poor: 2 };
    const worse = order[grade(k, now)] > order[grade(k, before)] || (before > 0 && (now - before) / before >= 0.15 && grade(k, now) !== "good");
    if (worse) out.push({ metric: k, before: Number(before.toFixed(k === "cls" ? 3 : 0)), now: Number(now.toFixed(k === "cls" ? 3 : 0)), from: grade(k, before), to: grade(k, now) });
  }
  return out;
}

const fmt = (k, v) => (v == null ? "-" : k === "cls" ? v.toFixed(2) : `${Math.round(v)} ms`);

export function vitalsMarkdown({ siteName, origin, pages, formFactor }) {
  const L = [`# ${siteName} real-user Core Web Vitals (${formFactor.toLowerCase()})`, "", "From the Chrome UX Report: the 75th percentile of what real Chrome users experienced over 28 days, graded with Google's thresholds (LCP 2.5 s, INP 200 ms, CLS 0.1). Pages without enough traffic have no field data; the whole-site (origin) figure still applies to them.", ""];
  const row = (label, r) => r.error ? `| ${label} | ${r.error} | | | |` : `| ${label} | ${CORE.map((k) => `${fmt(k, r.p75[k])} (${r.grades[k] || "-"})`).join(" | ")} | ${r.passes == null ? "-" : r.passes ? "pass" : "**fail**"} |`;
  L.push("| | LCP | INP | CLS | Core Web Vitals |", "|---|---|---|---|---|", row("whole site", origin.current), ...pages.map((p) => row(p.url, p.current)));
  const regs = [{ label: "whole site", r: origin.regressions || [] }, ...pages.map((p) => ({ label: p.url, r: p.regressions || [] }))].filter((x) => x.r.length);
  L.push("", "## Got worse over the last 4 weeks", ...(regs.length ? regs.flatMap((x) => x.r.map((g) => `- ${x.label}: ${g.metric.toUpperCase()} ${fmt(g.metric, g.before)} to ${fmt(g.metric, g.now)} (${g.from} to ${g.to})`)) : ["- nothing significant"]));
  if (origin.history?.weeks?.length) L.push("", `## Whole-site trend (p75, ${origin.history.weeks.length} periods to ${origin.history.weeks.at(-1)})`, ...CORE.filter((k) => origin.history.series[k]).map((k) => `- ${k.toUpperCase()}: ${origin.history.series[k].slice(-8).map((v) => fmt(k, v)).join(", ")}`));
  return L.join("\n") + "\n";
}
