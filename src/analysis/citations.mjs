// AI answer and SERP citation tracker. Pure: pass the normalised provider answers in, get appearances, competitors and a trend out.
// "Appears" means the site's domain is an organic result or a source cited in an AI answer for that question.

export const MAX_QUESTIONS = 40;
export const KEEP_RUNS = 26;

export function normaliseQuestions(list, defaultMarket = "GB") {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const q = typeof x === "string" ? x : x?.q;
    if (!q || !String(q).trim() || /^replace/i.test(String(q))) continue;
    out.push({ q: String(q).trim(), market: (typeof x === "object" && x.market) || defaultMarket });
  }
  return out.slice(0, MAX_QUESTIONS);
}

const same = (d, site) => d === site || d.endsWith("." + site);

export function analyseCitations({ domain, answers = [] }) {
  const site = String(domain).replace(/^www\./, "").toLowerCase();
  const rows = answers.map((a) => {
    if (a.error) return { q: a.q, market: a.market, error: a.error, appears: false, organicPosition: null, inAiAnswer: false, aiAnswerPresent: false, cited: [] };
    const org = (a.results || []).find((r) => same(r.domain, site));
    const inAi = (a.aiSources || []).some((r) => same(r.domain, site));
    const cited = [...new Set([...(a.results || []).map((r) => r.domain), ...(a.aiSources || []).map((r) => r.domain)])];
    return { q: a.q, market: a.market, appears: Boolean(org || inAi), organicPosition: org ? org.position : null, inAiAnswer: inAi, aiAnswerPresent: (a.aiSources || []).length > 0, cited, url: org?.url || (a.aiSources || []).find((r) => same(r.domain, site))?.url };
  });
  const ok = rows.filter((r) => !r.error);
  const counts = new Map();
  for (const r of ok) for (const d of r.cited) if (!same(d, site)) counts.set(d, (counts.get(d) || 0) + 1);
  const topCited = [...counts].map(([d, count]) => ({ domain: d, count })).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)).slice(0, 10);
  const appears = ok.filter((r) => r.appears).length;
  return {
    domain: site, asked: ok.length, errors: rows.length - ok.length, appears, share: ok.length ? Math.round((appears / ok.length) * 1000) / 1000 : 0,
    withAiAnswer: ok.filter((r) => r.aiAnswerPresent).length,
    absent: ok.filter((r) => !r.appears).map((r) => r.q),
    mostlyAbsent: ok.length >= 3 && appears / ok.length < 0.5,
    topCited, rows: rows.map(({ cited, ...r }) => r),
  };
}

/** Keep the last `keep` runs. Entries are { date, provider, asked, appears, share }. A second run on the same day replaces the first. */
export function appendHistory(history, entry, keep = KEEP_RUNS) {
  const h = (Array.isArray(history) ? history : []).filter((e) => e.date !== entry.date);
  h.push(entry);
  return h.sort((a, b) => a.date.localeCompare(b.date)).slice(-keep);
}

/** Share of questions where the site appears, per calendar month: total appearances over total questions asked in that month. */
export function trend(history) {
  const m = new Map();
  for (const e of history || []) {
    const k = String(e.date).slice(0, 7);
    const v = m.get(k) || { asked: 0, appears: 0, runs: 0 };
    v.asked += e.asked; v.appears += e.appears; v.runs++;
    m.set(k, v);
  }
  return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({ month, runs: v.runs, asked: v.asked, appears: v.appears, share: v.asked ? Math.round((v.appears / v.asked) * 1000) / 1000 : 0 }));
}

const pct = (x) => `${Math.round(x * 100)}%`;
export function citationsMarkdown(r, history, siteName = "", provider = "") {
  const t = trend(history);
  const cell = (x) => String(x).replace(/\|/g, "/");
  return `# ${siteName ? siteName + ": " : ""}citations in search and AI answers

Provider: ${provider}. ${r.domain} appears for ${r.appears} of ${r.asked} questions (${pct(r.share)}).${r.errors ? ` ${r.errors} question(s) failed and are left out.` : ""} ${r.withAiAnswer} question(s) showed an AI answer with sources${provider === "brave" ? " (this provider does not return AI answers)" : ""}.
A result is a snapshot from one provider at one moment; rankings and AI answers vary by location, time and person.

## This run
| Question | Market | Organic position | Cited in AI answer |
|---|---|---|---|
${r.rows.map((x) => `| ${cell(x.q)} | ${x.market} | ${x.error ? "error: " + cell(x.error) : x.organicPosition ?? "not in results"} | ${x.error ? "-" : x.inAiAnswer ? "yes" : x.aiAnswerPresent ? "no" : "no AI answer"} |`).join("\n")}

## Trend (share of questions where the site appears)
${t.length ? "| Month | Runs | Share |\n|---|---|---|\n" + t.map((x) => `| ${x.month} | ${x.runs} | ${pct(x.share)} (${x.appears}/${x.asked}) |`).join("\n") : "First run: no trend yet."}

## Most cited domains
${r.topCited.length ? r.topCited.map((x) => `- ${x.domain}: ${x.count} question(s)`).join("\n") : "- none"}

## Questions where the site is absent
${r.absent.length ? r.absent.map((q) => `- ${q}`).join("\n") : "- none"}
`;
}
