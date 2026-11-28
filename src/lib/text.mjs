// Unicode-aware text helpers for matching, coverage and slugs. Pure, dependency-free.
// Latin/English behaviour is kept identical to the old ASCII-only code; Arabic (and other scripts) now produce tokens too.

const ARABIC = /\p{Script=Arabic}/u;
const TASHKEEL = /[ً-ٰٟ]/g; // fathatan..sukun, shadda, superscript alef
const TATWEEL = /ـ/g;

const DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
const digitsToAscii = (s) => s.replace(/[٠-٩۰-۹]/g, (c) => DIGITS[c]);

/** Strip diacritics and tatweel, turn Arabic-Indic and Persian digits into ASCII. Safe for any display text (used by slugs). */
export const stripArabicMarks = (s) => digitsToAscii(String(s ?? "").replace(TASHKEEL, "").replace(TATWEEL, ""));

/**
 * Normalise Arabic for MATCHING only (never for display): strip marks, unify alef forms, ta marbuta -> ha, alef maqsura -> ya,
 * hamza on waw/ya carriers -> plain waw/ya, digits -> ASCII. Non-Arabic text passes through untouched.
 */
export const normalizeArabic = (s) => stripArabicMarks(s)
  .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي");

/** Old English stop words (unchanged) and a short Arabic list, written in normalised form (على -> علي, أو -> او). */
const STOP_EN = ["ai", "for", "to", "the", "and", "of", "a", "in", "with", "how", "what", "is", "do", "does", "can", "vs", "best", "your", "my", "on", "an", "are", "why"];
const STOP_AR = ["في", "من", "علي", "الي", "عن", "مع", "و", "او", "ما", "ماذا", "هل", "كيف", "ل", "ب", "ك", "ف", "هذا", "هذه", "ذلك", "تلك", "التي", "الذي", "لماذا", "افضل", "اي", "هو", "هي", "ان", "كل", "بعد", "قبل"];
export const STOP = new Set([...STOP_EN, ...STOP_AR]);

/**
 * Light Arabic prefix handling, only when 3+ letters remain: the definite article (ال), optionally behind و/ف and ب/ك/ل
 * (والمبيعات, بالمبيعات, للمبيعات), else one attached و/ب/ل/ف. Deliberately crude (no root analysis): it can wrongly cut a word
 * that really starts with one of these letters, and it is applied the same way to both sides of a comparison.
 */
export function stripArabicPrefix(w) {
  let m = /^[وف]?[بكل]?ال(.{3,})$/u.exec(w) || /^لل(.{3,})$/u.exec(w) || /^[وبلف](.{3,})$/u.exec(w);
  return m ? m[1] : w;
}

/**
 * Word tokens of a query: letters and numbers of any script, lower-cased, Arabic normalised and prefix-stripped, stop words
 * removed. Latin tokens must be 3+ characters (as before); Arabic-script tokens 2+ (two-letter names such as a platform name matter).
 */
export const tokens = (q) => normalizeArabic(String(q).toLowerCase()).split(/[^\p{L}\p{N}\p{M}]+/u).flatMap((w) => {
  if (!w) return [];
  if (ARABIC.test(w)) {
    if (STOP.has(w)) return [];
    const s = stripArabicPrefix(w);
    return s.length > 1 && !STOP.has(s) ? [s] : [];
  }
  return w.length > 2 && !STOP.has(w) ? [w] : [];
});

const MAX_SLUG = 60;
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;

/**
 * URL slug from a title. style "ascii" is the original behaviour (a-z0-9 and hyphens, "page" if nothing is left);
 * "unicode" keeps the letters and numbers of any script (Arabic native, diacritics removed); "auto" (default) uses unicode only
 * when the title has a non-Latin letter, so every Latin input gives exactly what it always gave.
 */
export function slugify(title, { style = "auto", max = MAX_SLUG } = {}) {
  const s = String(title ?? "");
  const unicode = style === "unicode" || (style === "auto" && NON_LATIN_LETTER.test(s));
  if (!unicode) return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max) || "page";
  return stripArabicMarks(s).normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "-").replace(/^-|-$/g, "").slice(0, max).replace(/-$/, "") || "page";
}
