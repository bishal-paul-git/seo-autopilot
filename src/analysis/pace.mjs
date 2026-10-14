// Content-pace governor. Pure: pass the dated pages and the limits, get back how fast pages are going live and a calmer schedule.
// It only recommends. Nothing here edits a file; a person (or the schedule job) applies the new dates.
import { addDays } from "../core/util.mjs";

export const PACE_DEFAULTS = { pagesPerDay: 2, pagesPerWeek: 8, perTemplatePerDay: null };
const NOT_INDEXED = /crawled\s*-\s*currently not indexed|discovered\s*-\s*currently not indexed|^discovered/i;
const d10 = (x) => String(x).slice(0, 10);

/**
 * If many recently published pages are Crawled/Discovered but not indexed, Google is not keeping up with what is already
 * live, so recommend slowing down. `inspect` is inspect-state.json's results ({url: {coverage}}).
 */
export function indexingSignal({ pages = [], inspect = {}, today, windowDays = 30 }) {
  const since = addDays(today, -windowDays);
  const recent = pages.filter((p) => p.publishAt && !p.hold && d10(p.publishAt) <= today && d10(p.publishAt) > since && p.url && inspect[p.url]?.coverage);
  const stuck = recent.filter((p) => NOT_INDEXED.test(inspect[p.url].coverage));
  const slow = recent.length >= 3 && stuck.length >= 3 && stuck.length / recent.length >= 0.4;
  return { checked: recent.length, notIndexed: stuck.length, slow, urls: stuck.map((p) => p.url).slice(0, 5) };
}

export function analysePace({ pages = [], limits = {}, today, inspect = {} } = {}) {
  const base = { ...PACE_DEFAULTS, ...Object.fromEntries(Object.entries(limits || {}).filter(([, v]) => v != null)) };
  const signal = indexingSignal({ pages, inspect, today });
  const eff = { ...base };
  if (signal.slow) { eff.pagesPerDay = Math.max(1, Math.floor(base.pagesPerDay / 2)); eff.pagesPerWeek = Math.max(1, Math.floor(base.pagesPerWeek / 2)); }

  const dated = pages.filter((p) => p.publishAt && !p.hold).map((p, i) => ({ p, i, date: d10(p.publishAt) })).sort((a, b) => a.date.localeCompare(b.date) || a.i - b.i);
  const perDay = {};
  for (const x of dated) perDay[x.date] = (perDay[x.date] || 0) + 1;
  const weekCount = (counts, d) => { let n = 0; for (let k = 0; k < 7; k++) n += counts[addDays(d, -k)] || 0; return n; };

  // Over the limit as scheduled today (using the limits you configured, not the indexing-reduced ones).
  const overDays = Object.entries(perDay).filter(([d, n]) => n > base.pagesPerDay).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
  const overWeeks = Object.keys(perDay).sort().map((d) => ({ endingOn: d, count: weekCount(perDay, d) })).filter((w) => w.count > base.pagesPerWeek);
  const tmplOver = base.perTemplatePerDay ? Object.entries(dated.reduce((m, x) => { if (x.p.template) { const k = `${x.date}|${x.p.template}`; m[k] = (m[k] || 0) + 1; } return m; }, {})).filter(([, n]) => n > base.perTemplatePerDay).map(([k, count]) => ({ date: k.split("|")[0], template: k.split("|")[1], count })) : [];

  // Recommended schedule: past releases are fixed; upcoming ones keep their order, never move earlier, and fill the earliest free slots.
  const counts = {}, tcounts = {};
  for (const x of dated) if (x.date < today) { counts[x.date] = (counts[x.date] || 0) + 1; if (x.p.template) tcounts[`${x.date}|${x.p.template}`] = (tcounts[`${x.date}|${x.p.template}`] || 0) + 1; }
  const upcoming = dated.filter((x) => x.date >= today);
  const schedule = [];
  let floor = today;
  for (const x of upcoming) {
    let d = x.date > floor ? x.date : floor;
    for (let guard = 0; guard < 3650; guard++, d = addDays(d, 1)) {
      const tk = x.p.template ? `${d}|${x.p.template}` : null;
      if ((counts[d] || 0) >= eff.pagesPerDay) continue;
      if (weekCount(counts, d) >= eff.pagesPerWeek) continue;
      if (tk && base.perTemplatePerDay && (tcounts[tk] || 0) >= base.perTemplatePerDay) continue;
      break;
    }
    counts[d] = (counts[d] || 0) + 1;
    if (x.p.template) tcounts[`${d}|${x.p.template}`] = (tcounts[`${d}|${x.p.template}`] || 0) + 1;
    floor = d;
    schedule.push({ title: x.p.title, url: x.p.url, file: x.p.file, id: x.p.id, from: x.date, to: d });
  }
  const moves = schedule.filter((s) => s.from !== s.to);
  const last7 = Object.entries(perDay).filter(([d]) => d <= today && d > addDays(today, -7)).reduce((n, [, c]) => n + c, 0);
  return {
    today, limits: base, effectiveLimits: eff, reducedForIndexing: signal.slow, indexing: signal,
    releasedLast7Days: last7, upcoming: upcoming.length,
    perDay, overDays, overWeeks, overTemplate: tmplOver,
    overLimit: overDays.length > 0 || overWeeks.length > 0 || tmplOver.length > 0,
    schedule, moves,
  };
}

export function paceMarkdown(r, siteName = "") {
  const list = (a, f) => (a.length ? a.map(f).join("\n") : "- none");
  return `# ${siteName ? siteName + ": " : ""}content pace

Limits: ${r.limits.pagesPerDay} a day, ${r.limits.pagesPerWeek} a week${r.limits.perTemplatePerDay ? `, ${r.limits.perTemplatePerDay} per template a day` : ""}. Released in the last 7 days: ${r.releasedLast7Days}. Scheduled to come: ${r.upcoming}.
${r.reducedForIndexing ? `\n**Slowed down:** ${r.indexing.notIndexed} of ${r.indexing.checked} recent pages are Crawled or Discovered but not indexed, so the recommended pace is ${r.effectiveLimits.pagesPerDay} a day and ${r.effectiveLimits.pagesPerWeek} a week until indexing catches up.\n` : ""}
## Days over the limit
${list(r.overDays, (d) => `- ${d.date}: ${d.count} pages`)}

## Weeks over the limit
${list(r.overWeeks, (w) => `- 7 days ending ${w.endingOn}: ${w.count} pages`)}
${r.overTemplate.length ? `\n## Template bursts\n${r.overTemplate.map((t) => `- ${t.date}: ${t.count} ${t.template} pages`).join("\n")}\n` : ""}
## Recommended schedule changes
This report changes nothing. To apply it, edit the \`publishAt\` of each page below (or the front matter date) and commit. Pages are never moved earlier.

${r.moves.length ? "| Page | From | To |\n|---|---|---|\n" + r.moves.map((m) => `| ${String(m.title || m.url || m.id).replace(/\|/g, "/")} | ${m.from} | ${m.to} |`).join("\n") : "No changes needed: the schedule is within the limits."}
`;
}
