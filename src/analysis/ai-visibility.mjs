// AI visibility: how often AI answer engines mention and cite the business across a fixed set of real questions, asked the
// same way every run and repeated to measure variance. Pure: pass the recorded answers in.
//
// "Mentioned" = one of the business's names or aliases appears as whole words in the answer. "Cited" = an answer's source
// list includes the site's domain. A question counts as mentioned or cited for an engine when at least half its runs were.
// Shares are of your own question set, with the sample size; they are measured and directional, never a promise.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bare = (d) => String(d || "").replace(/^www\./, "").toLowerCase();

/** Names found in a text: case-insensitive, whole words, longest first so "Acme Plumbing" wins over "Acme". */
export function mentions(text, names = []) {
  const t = String(text || "");
  const found = [];
  for (const n of [...new Set(names.map((x) => String(x).trim()).filter((x) => x.length >= 2))].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${esc(n)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(t) && !found.some((f) => f.toLowerCase().includes(n.toLowerCase()))) found.push(n);
  }
  return found;
}

const isDomain = (d, target) => { d = bare(d); target = bare(target); return d === target || d.endsWith(`.${target}`); };

/**
 * answers: [{ q, engine, run, text, citations:[{url,domain}], error?, refused? }]
 * brand: { domain, names }. competitors: [{ name, domain }] (either may be missing).
 */
export function analyse(answers, { domain, names = [], competitors = [] } = {}) {
  const ok = answers.filter((a) => !a.error && !a.refused);
  const key = (a) => `${a.engine}\u0000${a.q}`;
  const cells = new Map();
  for (const a of ok) {
    const c = cells.get(key(a)) || { q: a.q, engine: a.engine, runs: 0, mentioned: 0, cited: 0, urls: new Set(), positions: [], others: new Map() };
    c.runs++;
    if (mentions(a.text, names).length) c.mentioned++;
    const idx = (a.citations || []).findIndex((x) => isDomain(x.domain, domain));
    if (idx >= 0) { c.cited++; c.positions.push(idx + 1); for (const x of a.citations) if (isDomain(x.domain, domain)) c.urls.add(x.url); }
    for (const x of a.citations || []) if (!isDomain(x.domain, domain)) c.others.set(bare(x.domain), (c.others.get(bare(x.domain)) || 0) + 1);
    cells.set(key(a), c);
  }
  const perCell = [...cells.values()].map((c) => ({
    q: c.q, engine: c.engine, runs: c.runs, mentionedRuns: c.mentioned, citedRuns: c.cited,
    mentioned: c.mentioned * 2 >= c.runs, cited: c.cited * 2 >= c.runs, citedUrls: [...c.urls],
    citationRank: c.positions.length ? Math.min(...c.positions) : null, citedInstead: [...c.others].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d),
  }));
  const engines = [...new Set(perCell.map((c) => c.engine))];
  const byEngine = Object.fromEntries(engines.map((e) => {
    const cs = perCell.filter((c) => c.engine === e);
    return [e, { questions: cs.length, mentioned: cs.filter((c) => c.mentioned).length, cited: cs.filter((c) => c.cited).length, share: cs.length ? Number((cs.filter((c) => c.cited).length / cs.length).toFixed(3)) : 0 }];
  }));
  const questions = [...new Set(perCell.map((c) => c.q))].map((q) => {
    const cs = perCell.filter((c) => c.q === q);
    return { q, engines: cs.length, mentionedBy: cs.filter((c) => c.mentioned).map((c) => c.engine), citedBy: cs.filter((c) => c.cited).map((c) => c.engine), citedInstead: [...new Set(cs.flatMap((c) => c.citedInstead))].slice(0, 5) };
  });
  // Competitors: answers that mention their name or cite their domain.
  const comp = competitors.map((c) => {
    let mentioned = 0, cited = 0;
    for (const a of ok) { if (c.name && mentions(a.text, [c.name]).length) mentioned++; if (c.domain && (a.citations || []).some((x) => isDomain(x.domain, c.domain))) cited++; }
    return { name: c.name || c.domain, domain: c.domain || null, mentioned, cited, answers: ok.length };
  });
  const sources = new Map();
  for (const a of ok) for (const d of new Set((a.citations || []).map((x) => bare(x.domain)))) sources.set(d, (sources.get(d) || 0) + 1);
  const youMentioned = ok.filter((a) => mentions(a.text, names).length).length, youCited = ok.filter((a) => (a.citations || []).some((x) => isDomain(x.domain, domain))).length;
  return {
    asked: ok.length, failed: answers.length - ok.length, questions: questions.length, engines, byEngine, perQuestion: questions, cells: perCell,
    totals: { answers: ok.length, mentioned: youMentioned, cited: youCited, mentionShare: ok.length ? Number((youMentioned / ok.length).toFixed(3)) : 0, citationShare: ok.length ? Number((youCited / ok.length).toFixed(3)) : 0 },
    competitors: comp, topSources: [...sources].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([d, n]) => ({ domain: d, answers: n, own: isDomain(d, domain) })),
    gaps: questions.filter((x) => !x.citedBy.length),
  };
}

export const appendHistory = (history = [], row) => [...history.filter((h) => !(h.date === row.date && h.setHash === row.setHash)), row].slice(-200);

/** A short stable fingerprint of the question set, so runs are only compared when they asked the same things. */
export function setHash(questions) {
  let h = 0;
  for (const ch of [...questions].sort().join("\n")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

const pct = (x) => `${Math.round(x * 100)}%`;

export function visibilityMarkdown(r, { siteName, history = [], runs }) {
  const L = [`# ${siteName} AI visibility`, ""];
  L.push(`${r.questions} questions x ${r.engines.length} engine(s) x ${runs} run(s): ${r.asked} answers recorded${r.failed ? `, ${r.failed} failed or declined` : ""}. A question counts as cited for an engine when at least half its runs cited the site. Measured on your own question set; AI answers change between runs and model updates, so read trends, not single numbers.`, "");
  L.push(`- Mentioned by name in **${pct(r.totals.mentionShare)}** of answers (${r.totals.mentioned} of ${r.totals.answers})`, `- Cited as a source in **${pct(r.totals.citationShare)}** of answers (${r.totals.cited} of ${r.totals.answers})`);
  for (const [e, s] of Object.entries(r.byEngine)) L.push(`- ${e}: cited on ${s.cited} of ${s.questions} questions, mentioned on ${s.mentioned}`);
  const same = history.filter((h) => h.setHash === history.at(-1)?.setHash);
  if (same.length > 1) L.push(`- Citation share over time (same question set): ${same.slice(-8).map((h) => `${h.date.slice(5)} ${pct(h.citationShare)}`).join(", ")}`);
  if (r.competitors.length) L.push("", "## Competitors in the same answers", ...r.competitors.map((c) => `- ${c.name}: mentioned in ${c.mentioned}, cited in ${c.cited} of ${c.answers} answers`));
  L.push("", "## Sources AI answers lean on", ...r.topSources.map((s) => `- ${s.domain}${s.own ? " (you)" : ""}: ${s.answers} answers`));
  L.push("", "## Questions where no engine cites you", ...(r.gaps.length ? r.gaps.slice(0, 25).map((g) => `- ${g.q}${g.citedInstead.length ? ` (cited instead: ${g.citedInstead.join(", ")})` : ""}`) : ["- none"]));
  L.push("", "## Every question", "", "| Question | Cited by | Mentioned by | Cited instead |", "|---|---|---|---|", ...r.perQuestion.map((x) => `| ${x.q} | ${x.citedBy.join(", ") || "-"} | ${x.mentionedBy.join(", ") || "-"} | ${x.citedInstead.join(", ") || "-"} |`));
  return L.join("\n") + "\n";
}
