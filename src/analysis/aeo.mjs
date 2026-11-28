// AEO analysis: did Google's AI answers (or ChatGPT with web search) for the site's buyer questions mention or cite the site?
// Pure: pass the recorded answers in. "Mentioned" = a name or alias appears in the answer text (Arabic compared in normalised
// form, so "مَنَار" and "منار" are the same, and a one-letter prefix such as و/ب/ل/ال is allowed). "Cited" = the answer's source
// list includes the site's domain. Counts are of your own question set, with the sample size: measured and directional.
import { normalizeArabic } from "../lib/text.mjs";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bare = (d) => String(d || "").replace(/^www\./, "").toLowerCase();
const ARABIC = /\p{Script=Arabic}/u;
// Attached Arabic prefixes in normalised form: و ف ب ك ل and ال, alone or stacked (وبال, ولل, بال). "ل" + "ال" becomes "لل".
const AR_PREFIX = "(?:[وفبكل]|ال|لل|(?:[وف])(?:[بكل]|ال|لل)|(?:[بك])ال)?";

/** Names found in a text. Case-insensitive, whole words; Arabic names also match with an attached prefix. Longest name first. */
export function mentionedNames(text, names = []) {
  const t = normalizeArabic(String(text || ""));
  const found = [];
  const list = [...new Set(names.map((x) => String(x).trim()).filter((x) => x.length >= 2))].sort((a, b) => b.length - a.length);
  for (const n of list) {
    const norm = normalizeArabic(n).replace(/\s+/g, " ");
    const body = norm.split(" ").map(esc).join("\\s+");
    const re = new RegExp(`(^|[^\\p{L}\\p{N}\\p{M}])${ARABIC.test(norm) ? AR_PREFIX : ""}${body}(?=$|[^\\p{L}\\p{N}\\p{M}])`, "iu");
    if (re.test(t) && !found.some((f) => normalizeArabic(f).toLowerCase().includes(norm.toLowerCase()))) found.push(n);
  }
  return found;
}

export const isSiteDomain = (d, site) => { d = bare(d); site = bare(site); return Boolean(d) && (d === site || d.endsWith(`.${site}`)); };

/**
 * answers: [{ q, lang, mode, text, citations:[{url,domain}], costUsd, error?, skipped? }]. brand: { domain, names }.
 * Returns per-question rows and totals (overall and by language) plus the measured cost.
 */
export function analyseAeo(answers, { domain, names = [] } = {}) {
  const nameList = [...new Set([...names, domain].filter(Boolean))];
  const rows = answers.map((a) => {
    const base = { q: a.q, lang: a.lang, mode: a.mode, costUsd: Number(a.costUsd) || 0 };
    if (a.skipped) return { ...base, status: "skipped", note: a.skipped };
    if (a.error) return { ...base, status: "error", note: a.error };
    const cites = a.citations || [];
    const hasAnswer = Boolean(String(a.text || "").trim()) || cites.length > 0;
    const hit = mentionedNames(a.text, nameList);
    const idx = cites.findIndex((c) => isSiteDomain(c.domain, domain));
    const others = new Map();
    for (const c of cites) if (c.domain && !isSiteDomain(c.domain, domain)) others.set(bare(c.domain), (others.get(bare(c.domain)) || 0) + 1);
    return {
      ...base, status: hasAnswer ? "answered" : "no-answer", mentioned: hit.length > 0, mentionedAs: hit, cited: idx >= 0, citationRank: idx >= 0 ? idx + 1 : null,
      citedUrls: cites.filter((c) => isSiteDomain(c.domain, domain)).map((c) => c.url), sources: cites.length, unresolved: a.unresolved || 0,
      citedInstead: [...others].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([d]) => d),
    };
  });
  const tally = (rs) => {
    const asked = rs.filter((r) => r.status !== "skipped" && r.status !== "error"), ans = asked.filter((r) => r.status === "answered");
    return {
      prompts: rs.length, asked: asked.length, answered: ans.length, withSources: ans.filter((r) => r.sources > 0).length,
      mentioned: ans.filter((r) => r.mentioned).length, cited: ans.filter((r) => r.cited).length,
      errors: rs.filter((r) => r.status === "error").length, skipped: rs.filter((r) => r.status === "skipped").length,
      costUsd: Number(rs.reduce((s, r) => s + r.costUsd, 0).toFixed(6)),
      costPerPromptUsd: asked.length ? Number((rs.reduce((s, r) => s + r.costUsd, 0) / asked.length).toFixed(6)) : null,
    };
  };
  const byLang = {};
  for (const l of [...new Set(rows.map((r) => r.lang))]) byLang[l] = tally(rows.filter((r) => r.lang === l));
  const rivals = new Map();
  for (const r of rows) for (const d of r.citedInstead || []) rivals.set(d, (rivals.get(d) || 0) + 1);
  return { rows, totals: tally(rows), byLang, topCited: [...rivals].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d, n]) => ({ domain: d, answers: n })) };
}

const usd = (n) => (n == null ? "n/a" : `$${Number(n).toFixed(n !== 0 && Math.abs(n) < 0.1 ? 4 : 2)}`);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");

/** Plain-English report of one run. `info`: { mode, siteName, date, capUsd, stoppedBy, market }. */
export function aeoMarkdown(r, info = {}) {
  const t = r.totals;
  const L = [`# AI answer tracking${info.siteName ? `: ${info.siteName}` : ""}`, "",
    `${info.date || ""} | mode **${info.mode}** | ${info.market || ""}`.replace(/^ \| /, ""), "",
    `Asked ${t.asked} of ${t.prompts} prompts. **Measured cost of this run: ${usd(t.costUsd)}** (${usd(t.costPerPromptUsd)} per prompt${info.capUsd ? `, cap ${usd(info.capUsd)}` : ""}).`];
  if (info.stoppedBy) L.push("", `Stopped early: ${info.stoppedBy}`);
  L.push("", "| | prompts asked | answer with AI content | with sources | mention the site | cite the site | cost |", "|---|---|---|---|---|---|---|");
  for (const [k, v] of [["all", t], ...Object.entries(r.byLang)]) L.push(`| ${k} | ${v.asked} | ${v.answered} (${pct(v.answered, v.asked)}) | ${v.withSources} | ${v.mentioned} | ${v.cited} | ${usd(v.costUsd)} |`);
  if (r.topCited.length) L.push("", "Most-cited other sites: " + r.topCited.map((c) => `${c.domain} (${c.answers})`).join(", ") + ".");
  const bad = r.rows.filter((x) => x.status === "error" || x.status === "skipped");
  if (bad.length) { L.push("", "Not asked or failed:"); for (const x of bad) L.push(`- ${x.status}: "${x.q}" ${x.note}`); }
  L.push("", "Small samples and answers that change between runs: read these as direction, not as exact rates.");
  return L.join("\n");
}
