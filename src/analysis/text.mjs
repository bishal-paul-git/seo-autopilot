// Text tools shared by keyword research, the content optimiser and gap analysis. Pure and dependency-free, English-first.
// The stemmer is deliberately light (plurals, -ing, -ed, -ly): it merges "invoice"/"invoices" and "price"/"pricing" well
// enough for term counting, and never claims to be linguistics. Other languages still tokenise; they are just not stemmed.

export const STOP = new Set(("a about above after again against all am an and any are as at be because been before being below between both but by can " +
  "could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its " +
  "itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that " +
  "the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom " +
  "why will with would you your yours yourself yourselves also get got one two may might must shall us via per etc").split(" "));

/** Lower-case word tokens (letters and digits, any script), stop words kept unless `stop` is true. */
export const tokens = (s, { stop = false } = {}) => String(s || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && (!stop || !STOP.has(w)));

export function stem(w) {
  if (w.length <= 4 || /\d/.test(w)) return w;
  if (w.endsWith("ies") && w.length > 5) return w.slice(0, -3) + "y";
  if (w.endsWith("ing") && w.length > 6) { const b = w.slice(0, -3); return /(.)\1$/.test(b) && !/(ll|ss)$/.test(b) ? b.slice(0, -1) : b.length > 3 ? b : w; }
  if (w.endsWith("ed") && w.length > 5) { const b = w.slice(0, -2); return /(.)\1$/.test(b) && !/(ll|ss)$/.test(b) ? b.slice(0, -1) : b; }
  if (w.endsWith("ly") && w.length > 5) return w.slice(0, -2);
  if (/(ss|us|is)$/.test(w)) return w;
  if (/(ches|shes|xes|zes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}
// "pricing" -> "pric" and "price" -> "price" would differ: drop a final silent e so both meet at "pric".
const root = (w) => { const s = stem(w); return s.length > 4 && s.endsWith("e") ? s.slice(0, -1) : s; };

/** Meaningful stems of a text: stop words dropped, then stemmed. */
export const terms = (s) => tokens(s, { stop: true }).filter((w) => w.length > 1).map(root);

/** Unigram and bigram stems, the units counted by the optimiser. Bigrams skip across stop words only once. */
export function grams(s) {
  const t = terms(s);
  return [...t, ...t.slice(1).map((w, i) => `${t[i]} ${w}`)];
}

/** Count of each gram. */
export function counts(s) {
  const m = new Map();
  for (const g of grams(s)) m.set(g, (m.get(g) || 0) + 1);
  return m;
}

/** Sentences of plain text (keeps abbreviations like "e.g." from splitting, roughly). */
export const sentences = (s) => String(s || "").replace(/\b(e\.g|i\.e|etc|vs|mr|mrs|dr|no)\./gi, "$1").split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => /\p{L}/u.test(x));

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

/** Flesch reading ease (English): higher is easier, 60 to 70 is plain English. Null for under 30 words. */
export function readability(text) {
  const sents = sentences(text), words = tokens(text).filter((w) => /\p{L}/u.test(w));
  if (words.length < 30 || !sents.length) return null;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const wps = words.length / sents.length, spw = syl / words.length;
  return { words: words.length, sentences: sents.length, wordsPerSentence: Number(wps.toFixed(1)), flesch: Math.round(206.835 - 1.015 * wps - 84.6 * spw), longSentences: sents.filter((s) => tokens(s).length > 30).length };
}

/** Jaccard similarity of two sets. */
export const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size && !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); };

export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
