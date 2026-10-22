// Small, pure helpers that decide what is in scope for a site: which URLs are intentionally short or retired, whether two
// URLs differ only by a trailing slash, and whether a search query is in a language the site publishes in.
// No network, no writes. Config keys: thinIgnore, retired (URL path patterns), language and markets.

const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** "/blog/*" style pattern (only * is special; matches within the path) -> RegExp. A pattern without * matches that exact path. */
export function pathPattern(pattern) {
  const p = String(pattern).trim();
  const body = p.split("*").map(esc).join(".*");
  return new RegExp(`^${body}/?$`, "i");
}

const pathOf = (url) => {
  try { return new URL(url, "https://x.invalid").pathname; } catch { return String(url); }
};

/** True when the URL's path matches any pattern in the list. Absolute URLs and paths both work. */
export function matchesAny(url, patterns) {
  if (!Array.isArray(patterns) || !patterns.length) return false;
  const path = pathOf(url).replace(/\/$/, "") || "/";
  return patterns.some((p) => pathPattern(String(p).replace(/\/$/, "") || "/").test(path));
}

/** Two URLs that are the same page apart from a trailing slash (and nothing else). */
export function slashOnlyDifference(a, b) {
  if (!a || !b || a === b) return false;
  const strip = (u) => u.replace(/\/+$/, "");
  return strip(a) === strip(b) && a !== b;
}

// Function words that are common in one language and rare in the others. Enough to tell "this is Spanish" from "this is
// English" for a short search query; not a general language detector, and it says nothing when unsure.
const STOP = {
  en: ["the", "and", "for", "with", "how", "what", "to", "of", "in", "is", "best", "near", "me", "your", "free"],
  es: ["el", "la", "los", "las", "de", "del", "para", "con", "una", "un", "que", "como", "mejor", "gratis", "precio", "por"],
  fr: ["le", "la", "les", "des", "du", "pour", "avec", "une", "un", "est", "comment", "meilleur", "gratuit", "prix", "sur"],
  de: ["der", "die", "das", "und", "für", "mit", "ein", "eine", "wie", "ist", "beste", "kostenlos", "preis", "von"],
  pt: ["o", "os", "as", "de", "do", "da", "para", "com", "uma", "um", "que", "como", "melhor", "grátis", "preço"],
  it: ["il", "lo", "gli", "di", "del", "per", "con", "una", "un", "che", "come", "migliore", "gratis", "prezzo"],
  nl: ["de", "het", "een", "van", "voor", "met", "en", "hoe", "beste", "gratis", "prijs", "is"],
};
const AMBIGUOUS = new Set(["a", "e", "o", "en", "la", "de", "un", "me", "in", "is", "es"]);

/** Most likely language code of a short query, or null when there is no clear signal. */
export function detectLanguage(query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return null;
  if (/[Ѐ-ӿ]/.test(q)) return "ru";
  if (/[؀-ۿ]/.test(q)) return "ar";
  if (/[぀-ヿ一-鿿가-힯]/.test(q)) return "cjk";
  const words = q.split(/[^\p{L}]+/u).filter(Boolean);
  if (!words.length) return null;
  const score = {};
  for (const [lang, list] of Object.entries(STOP)) {
    const set = new Set(list);
    score[lang] = words.filter((w) => set.has(w) && !(AMBIGUOUS.has(w) && words.length < 3)).length;
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const [top, topScore] = ranked[0];
  if (topScore === 0) return null;
  if (ranked[1] && ranked[1][1] === topScore) return null; // tie: do not guess
  return top;
}

/**
 * Is this query worth turning into a topic or proposal for a site that publishes in `language` (default no filter)?
 * A query is dropped only when a different language is detected with a clear signal.
 */
export function inSiteLanguage(query, language) {
  if (!language) return true;
  const want = String(language).toLowerCase().split("-")[0];
  const got = detectLanguage(query);
  if (got == null) return true;
  if (got === "cjk") return ["zh", "ja", "ko"].includes(want); // a non-Latin script is only in scope when the site publishes in it
  return got === want;
}
