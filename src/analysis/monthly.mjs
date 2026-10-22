// Monthly report (decision D17): what the autopilot did this month, what the watch rolled back, whether search traffic
// moved, and how the audit findings changed since last month. Pure: pass what was saved, get numbers and a report back.
// Traffic compares the last 28 days with the 28 before (ending 3 days ago, so Search Console reporting has settled).
// It describes what happened; it does not claim the autopilot caused it.

const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const KIND_LABELS = ["seo-topic", "seo-refresh", "seo-snippet", "seo-links", "seo-fix", "seo-template"];

function sum(s, from, to) {
  let clicks = 0, impressions = 0, days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) { const v = s?.[d]; if (v) { clicks += v[0]; impressions += v[1]; days++; } }
  return { clicks, impressions, days };
}

/** Site and per-page clicks for two 28-day windows from the per-page daily series (page-daily.json). */
export function trafficChange(series = {}, today, { span = 28, lag = 3 } = {}) {
  const to = addDays(today, -lag), from = addDays(to, -(span - 1));
  const pTo = addDays(from, -1), pFrom = addDays(pTo, -(span - 1));
  const now = { clicks: 0, impressions: 0 }, before = { clicks: 0, impressions: 0 }, pages = [];
  let days = 0;
  for (const [url, s] of Object.entries(series)) {
    const a = sum(s, from, to), b = sum(s, pFrom, pTo);
    now.clicks += a.clicks; now.impressions += a.impressions; before.clicks += b.clicks; before.impressions += b.impressions;
    days = Math.max(days, Math.min(a.days, b.days));
    pages.push({ url, before: b.clicks, now: a.clicks, change: a.clicks - b.clicks });
  }
  const moved = pages.filter((p) => p.change);
  return {
    window: { from, to, previousFrom: pFrom, previousTo: pTo }, now, before, comparable: days >= span / 2,
    gained: moved.filter((p) => p.change > 0).sort((x, y) => y.change - x.change).slice(0, 5),
    lost: moved.filter((p) => p.change < 0).sort((x, y) => x.change - y.change).slice(0, 5),
  };
}

/** prs: merged pull requests ({ number, title, mergedAt, labels: [{name}] }) from the last month. */
export function autopilotLedger(prs = []) {
  const names = (p) => (p.labels || []).map((l) => l.name || l);
  const merged = prs.filter((p) => names(p).includes("seo-autopilot-merged"));
  const reverted = prs.filter((p) => names(p).includes("seo-reverted"));
  const byKind = {};
  for (const p of merged) { const k = names(p).find((n) => KIND_LABELS.includes(n)) || "other"; byKind[k] = (byKind[k] || 0) + 1; }
  const byPerson = prs.filter((p) => !names(p).includes("seo-autopilot-merged") && !names(p).includes("seo-revert")).length;
  return { merged: merged.length, reverted: reverted.length, byKind, byPerson, revertedPrs: reverted.map((p) => p.number) };
}

/** Audit findings now vs the snapshot saved last month (summary from audit.json). */
export function auditChange(summary, previous) {
  if (!summary) return null;
  const now = summary.bySeverity || {}, was = previous?.bySeverity || null;
  const rules = new Set([...Object.keys(summary.byRule || {}), ...Object.keys(previous?.byRule || {})]);
  const fixed = [], appeared = [];
  if (previous) for (const r of rules) {
    const a = summary.byRule?.[r] || 0, b = previous.byRule?.[r] || 0;
    if (a < b) fixed.push({ rule: r, from: b, to: a }); else if (a > b) appeared.push({ rule: r, from: b, to: a });
  }
  return { now, was, pagesCrawled: summary.pagesCrawled, fixed: fixed.sort((x, y) => (y.from - y.to) - (x.from - x.to)), appeared: appeared.sort((x, y) => (y.to - y.from) - (x.to - x.from)) };
}

/** Experiment results (from evaluate()) grouped by verdict, finished ones only. */
export function experimentSummary(results = []) {
  const done = results.filter((r) => r.status === "done");
  const byVerdict = {};
  for (const r of done) byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
  return { logged: results.length, done: done.length, byVerdict };
}

const pct = (a, b) => (b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%` : a ? "new" : "no change");

export function monthlyMarkdown({ siteName, month, traffic, ledger, audit, experiments, priorities = [], forecast = null }) {
  const t = traffic, L = [];
  L.push(`# ${siteName} monthly SEO report, ${month}`, "");
  L.push(`## Search traffic (${t.window.from} to ${t.window.to} vs the 28 days before)`);
  if (!t.comparable) L.push("Not enough daily history yet to compare two 28-day windows. The daily job builds it up; the first full comparison needs about 60 days.");
  else {
    L.push(`- Clicks: ${t.now.clicks} (${pct(t.now.clicks, t.before.clicks)}), impressions: ${t.now.impressions} (${pct(t.now.impressions, t.before.impressions)})`);
    if (t.gained.length) L.push(`- Most clicks gained: ${t.gained.map((p) => `${p.url} (+${p.change})`).join(", ")}`);
    if (t.lost.length) L.push(`- Most clicks lost: ${t.lost.map((p) => `${p.url} (${p.change})`).join(", ")}`);
    const fc = forecast?.site?.clicks;
    if (fc) L.push(`- Against the site's own normal range (Holt-Winters baseline, ${fc.from} to ${fc.to}): ${fc.actual} clicks vs ${fc.expected} expected (range ${fc.low} to ${fc.high}), **${fc.verdict}**.`);
    L.push("- This is what happened, not proof of why: seasonality, Google updates and other changes move traffic too.");
  }
  L.push("", "## What the autopilot did");
  L.push(`- Published on its own after every check passed: ${ledger.merged}${ledger.merged ? ` (${Object.entries(ledger.byKind).map(([k, n]) => `${k} ${n}`).join(", ")})` : ""}`);
  L.push(`- Rolled back by the watch: ${ledger.reverted}${ledger.reverted ? ` (${ledger.revertedPrs.map((n) => `#${n}`).join(", ")})` : ""}`);
  L.push(`- Other merged pull requests (approved by a person): ${ledger.byPerson}`);
  L.push("", "## Audit findings");
  if (!audit) L.push("No audit this month (the audit job did not run or failed).");
  else {
    const s = (x) => `${x.high || 0} high, ${x.medium || 0} medium, ${x.low || 0} low`;
    L.push(`- Now: ${s(audit.now)} across ${audit.pagesCrawled} pages${audit.was ? `; last month: ${s(audit.was)}` : " (first month: nothing to compare with yet)"}`);
    if (audit.fixed.length) L.push(`- Fewer: ${audit.fixed.slice(0, 8).map((r) => `${r.rule} ${r.from} to ${r.to}`).join(", ")}`);
    if (audit.appeared.length) L.push(`- More: ${audit.appeared.slice(0, 8).map((r) => `${r.rule} ${r.from} to ${r.to}`).join(", ")}`);
  }
  L.push("", "## Experiments");
  L.push(experiments.logged ? `- ${experiments.done} of ${experiments.logged} logged changes have a result${experiments.done ? `: ${Object.entries(experiments.byVerdict).map(([v, n]) => `${n} ${v}`).join(", ")}` : ""}. Directional only.` : "- None logged.");
  if (priorities.length) { L.push("", "## Top priorities for next month"); for (const p of priorities.slice(0, 5)) L.push(`- ${p.title || p.action || p.what || JSON.stringify(p)}`); }
  return L.join("\n") + "\n";
}

/** What to keep for next month's comparison. */
export const snapshot = (month, summary, traffic) => ({ month, bySeverity: summary?.bySeverity || null, byRule: summary?.byRule || {}, clicks: traffic.now.clicks, impressions: traffic.now.impressions });
