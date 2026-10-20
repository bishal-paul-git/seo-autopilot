// Content optimiser: how a page (or a draft) compares with the pages that rank for its query, the way a writing assistant
// does it, but every recommendation shows the evidence behind it. Pure: pass the page and the competitor pages in.
//
// Terms: words and two-word phrases that most top pages use (at least 2 pages and 40% of them, from different sites), with a
// usage range scaled to the page's length. Subtopics: section headings several top pages share. Questions: question
// headings they answer. Plus length, readability and the basics (query in title, H1, description, opening).
// It describes what ranking pages have in common; matching them is not a ranking guarantee, and copying them is not the aim:
// the page still needs what only this business can say.
import { counts, terms, grams, readability, jaccard, median, quantile, tokens, surfaces, showTerm } from "./text.mjs";

const QUESTION = /^(how|what|why|when|where|which|who|can|could|does|do|is|are|should|will)\b|\?\s*$/i;
const GENERIC = /^(introduction|overview|conclusion|summary|faq|faqs|frequently asked questions|related|table of contents|contents|final thoughts|key takeaways|share|comments|about the author)$/i;

const wordsOf = (text) => tokens(text).filter((w) => /\p{L}/u.test(w)).length;

/** The terms most top pages use, with how often, scaled to `targetWords`. */
export function termModel(competitors, { targetWords, minShare = 0.4, max = 60 } = {}) {
  const docs = competitors.map((c) => ({ domain: c.domain || c.url, words: Math.max(1, wordsOf(c.text)), counts: counts(`${c.title || ""} ${c.headings?.map((h) => h.text).join(" ") || ""} ${c.text}`) }));
  const n = docs.length;
  if (n < 2) return [];
  const forms = surfaces(competitors.map((c) => `${c.title || ""} ${c.headings?.map((h) => h.text).join(" ") || ""} ${c.text}`));
  const df = new Map();
  for (const d of docs) for (const g of d.counts.keys()) { const e = df.get(g) || new Set(); e.add(d.domain); df.set(g, e); }
  const need = Math.max(2, Math.ceil(n * minShare));
  const out = [];
  for (const [g, sites] of df) {
    if (sites.size < need || g.length < 3) continue;
    const dens = docs.map((d) => (d.counts.get(g) || 0) / d.words).filter((x) => x > 0);
    const tw = targetWords || median(docs.map((d) => d.words));
    const lo = Math.max(1, Math.round(quantile(dens, 0.25) * tw)), hi = Math.max(lo, Math.round(quantile(dens, 0.75) * tw));
    out.push({ term: g, label: showTerm(g, forms), pages: sites.size, share: Number((sites.size / n).toFixed(2)), range: [lo, hi], importance: (sites.size / n) * Math.log(1 + median(dens) * 1000) * (g.includes(" ") ? 1.3 : 1) });
  }
  // A unigram inside a stronger phrase adds little: keep it only if it is clearly more common on its own.
  const phrases = out.filter((t) => t.term.includes(" "));
  return out.filter((t) => t.term.includes(" ") || !phrases.some((p) => p.term.split(" ").includes(t.term) && p.importance >= t.importance * 0.8))
    .sort((a, b) => b.importance - a.importance).slice(0, max).map((t) => ({ ...t, importance: Number(t.importance.toFixed(3)) }));
}

/** Use of each model term in the page: missing, under, ok or over its range. */
export function termUsage(model, page) {
  const c = counts(`${page.title || ""} ${page.headings?.map((h) => h.text).join(" ") || ""} ${page.text}`);
  return model.map((t) => {
    const used = c.get(t.term) || 0;
    const status = used === 0 ? "missing" : used < t.range[0] ? "under" : used > Math.max(t.range[1] * 1.5, t.range[1] + 3) ? "over" : "ok";
    return { ...t, used, status };
  });
}

/** Section topics shared by several top pages, and whether the page covers each (in a heading or in its text). */
export function subtopics(competitors, page, { minPages = 2, similarity = 0.5 } = {}) {
  const groups = [];
  for (const c of competitors) {
    for (const h of (c.headings || []).filter((x) => x.level >= 2 && x.level <= 3 && !GENERIC.test(x.text.trim()))) {
      const t = terms(h.text);
      if (!t.length) continue;
      const g = groups.find((x) => jaccard(x.terms, t) >= similarity);
      if (g) { g.sites.add(c.domain || c.url); g.examples.push(h.text); } else groups.push({ terms: t, sites: new Set([c.domain || c.url]), examples: [h.text], question: QUESTION.test(h.text) });
    }
  }
  const pageHeads = (page.headings || []).map((h) => terms(h.text));
  const pageText = new Set(grams(page.text));
  return groups.filter((g) => g.sites.size >= minPages).map((g) => {
    const inHeading = pageHeads.some((h) => jaccard(h, g.terms) >= similarity);
    const inText = g.terms.filter((t) => pageText.has(t)).length / g.terms.length >= 0.75;
    return { topic: g.examples.sort((a, b) => a.length - b.length)[0], pages: g.sites.size, question: g.question, covered: inHeading ? "heading" : inText ? "text only" : "no", examples: [...new Set(g.examples)].slice(0, 3) };
  }).sort((a, b) => b.pages - a.pages);
}

/** Query in the title, H1, description and opening 100 words. */
export function basics(page, query) {
  const q = terms(query);
  const has = (s) => { const t = new Set(terms(s)); return q.length ? q.filter((x) => t.has(x)).length / q.length : 1; };
  const opening = tokens(page.text).slice(0, 100).join(" ");
  return { title: has(page.title), h1: has(page.h1 || ""), description: has(page.description || ""), opening: has(opening), titleLength: (page.title || "").length, descriptionLength: (page.description || "").length };
}

/** Score 0 to 100 with its parts, and the recommendations, each with the evidence. */
export function optimise(page, competitors, query) {
  const comps = competitors.filter((c) => wordsOf(c.text) >= 150);
  const words = wordsOf(page.text);
  const compWords = comps.map((c) => wordsOf(c.text));
  const len = { yours: words, median: median(compWords), range: compWords.length ? [Math.round(quantile(compWords, 0.25)), Math.round(quantile(compWords, 0.75))] : null };
  const model = termModel(comps, { targetWords: Math.max(words, len.range?.[0] || 0) || undefined });
  const usage = termUsage(model, page);
  const subs = subtopics(comps, page);
  const b = basics(page, query);
  const read = readability(page.text), compRead = median(comps.map((c) => readability(c.text)?.flesch).filter((x) => x != null));

  const totalImp = usage.reduce((n, t) => n + t.importance, 0) || 1;
  const termScore = usage.reduce((n, t) => n + t.importance * (t.status === "ok" ? 1 : t.status === "under" || t.status === "over" ? 0.5 : 0), 0) / totalImp;
  const subScore = subs.length ? subs.reduce((n, s) => n + (s.covered === "heading" ? 1 : s.covered === "text only" ? 0.6 : 0), 0) / subs.length : 1;
  const lenScore = !len.range ? 1 : words >= len.range[0] && words <= len.range[1] * 1.3 ? 1 : words < len.range[0] ? Math.max(0, words / len.range[0]) : 0.7;
  const basicsScore = (Math.min(1, b.title) * 5 + Math.min(1, b.h1) * 4 + Math.min(1, b.opening) * 3 + Math.min(1, b.description) * 3) / 15;
  const target = Math.min(60, compRead != null ? compRead - 5 : 60);
  const readScore = read == null ? 0.5 : read.flesch >= target ? 1 : Math.max(0, 1 - (target - read.flesch) / 40);
  const parts = { terms: Math.round(termScore * 40), subtopics: Math.round(subScore * 20), length: Math.round(lenScore * 15), basics: Math.round(basicsScore * 15), readability: Math.round(readScore * 10) };
  const score = Object.values(parts).reduce((a, x) => a + x, 0);

  const recs = [];
  if (comps.length < 3) recs.push(`Only ${comps.length} comparable top page(s) could be read: treat this as a rough guide.`);
  if (b.title < 1) recs.push(`Put the query's words in the title (it covers ${Math.round(b.title * 100)}% of them).`);
  if (b.h1 < 1) recs.push(`Make the H1 state the topic in the searcher's words (it covers ${Math.round(b.h1 * 100)}% of the query).`);
  if (b.opening < 1) recs.push("Answer the query in the first paragraph, in plain words.");
  if (!page.description) recs.push("Add a meta description that states the answer or benefit."); else if (b.descriptionLength > 160) recs.push(`Shorten the meta description (${b.descriptionLength} characters; about 150 is safe).`);
  if (b.titleLength > 65) recs.push(`Shorten the title (${b.titleLength} characters; about 60 shows in full).`);
  if (len.range && words < len.range[0]) recs.push(`Most top pages run ${len.range[0]} to ${len.range[1]} words; this has ${words}. Add what is missing below, not filler.`);
  const missingSubs = subs.filter((s) => s.covered === "no");
  if (missingSubs.length) recs.push(`Cover these sections that ${missingSubs[0].pages}+ top pages have: ${missingSubs.slice(0, 6).map((s) => `"${s.topic}"`).join(", ")}.`);
  const missing = usage.filter((t) => t.status === "missing").slice(0, 12);
  if (missing.length) recs.push(`Terms most top pages use that this page never does: ${missing.map((t) => t.label).join(", ")}. Use them only where they fit the reader.`);
  const over = usage.filter((t) => t.status === "over").slice(0, 5);
  if (over.length) recs.push(`Used far more than on top pages (may read as stuffing): ${over.map((t) => `${t.label} (${t.used}, range ${t.range.join("-")})`).join(", ")}.`);
  if (read && read.flesch < target) recs.push(`Easier reading: Flesch ${read.flesch} vs about ${compRead ?? 60} on top pages; ${read.longSentences} sentence(s) over 30 words.`);
  return { query, score, parts, length: len, basics: b, readability: { yours: read, competitorsMedian: compRead }, terms: usage, subtopics: subs, competitors: comps.map((c) => ({ url: c.url, words: wordsOf(c.text) })), recommendations: recs };
}

export function optimiseMarkdown(r, { url, siteName }) {
  const L = [`# Content optimiser: "${r.query}"`, "", `${siteName}, ${url}. Compared with ${r.competitors.length} top-ranking page(s): ${r.competitors.map((c) => c.url).join(", ") || "none"}.`, ""];
  L.push(`## Score: ${r.score} / 100`, `Terms ${r.parts.terms}/40, subtopics ${r.parts.subtopics}/20, length ${r.parts.length}/15, basics ${r.parts.basics}/15, readability ${r.parts.readability}/10. The score says how close the page is to what ranking pages share, not how it will rank.`, "");
  L.push("## Do next", ...r.recommendations.map((x, i) => `${i + 1}. ${x}`), "");
  L.push("## Terms", "", "| Term | Top pages using it | Suggested uses | Yours | Status |", "|---|---|---|---|---|", ...r.terms.slice(0, 40).map((t) => `| ${t.label} | ${t.pages} (${Math.round(t.share * 100)}%) | ${t.range[0]}-${t.range[1]} | ${t.used} | ${t.status} |`));
  L.push("", "## Subtopics top pages share", ...(r.subtopics.length ? r.subtopics.slice(0, 25).map((s) => `- ${s.topic} (${s.pages} pages${s.question ? ", question" : ""}): ${s.covered === "heading" ? "covered" : s.covered === "text only" ? "in your text, no heading" : "**missing**"}`) : ["- none shared by two or more pages"]));
  return L.join("\n") + "\n";
}
