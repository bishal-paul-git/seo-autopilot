// On-page quality views over the crawl (audit.json) and Search Console rows (gsc-rows.json). Pure: no network, no writes.
// keywordAlignment asks whether a page's own top search query is reflected in its title, H1 and description; the query is
// what people actually typed, so this works on any site without a hand-kept keyword list. sectionOutline gives heading
// averages per site section, to spot a template that leaves its pages unstructured.

const STOP = new Set(["a", "an", "the", "for", "of", "to", "in", "on", "at", "by", "and", "or", "vs", "with", "how", "what", "why", "when", "where", "which", "who", "is", "are", "do", "does", "can", "my", "your", "near", "me", "best"]);
export const words = (s) => String(s || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w));

/**
 * Same word, allowing English endings: the shared prefix must reach the shorter word's length minus two letters, and at
 * least four. "invoice"/"invoices", "price"/"pricing" and "automation"/"automating" match; "car"/"care" and "firm"/"form"
 * do not. Suffix-stripping stemmers got "invoice"/"invoices" wrong, which is why this replaced the earlier approach.
 */
export function sameWord(a, b) {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i >= Math.max(4, n - 2);
}

/**
 * Share of the query's meaningful words found in the text, 0 to 1. A query with no meaningful words counts as covered.
 * `ignore` holds words to leave out of the query, such as words the whole site uses (see siteWords).
 */
export function coverage(text, query, ignore = new Set()) {
  const t = [...new Set(words(text))], q = [...new Set(words(query))].filter((w) => !ignore.has(w));
  return q.length ? q.filter((w) => t.some((x) => sameWord(w, x))).length / q.length : 1;
}

/**
 * Words in at least half of the site's titles (sites of 10 pages or more). A word on every page, such as "ai" on an AI
 * agency's site, says nothing about which page a query belongs to, and counting it lets a title pass while the query's
 * distinctive word is missing. A hand-written stop list used to hold such words; this finds them from the site.
 */
export function siteWords(titles = [], { share = 0.5, minPages = 10 } = {}) {
  const list = titles.filter(Boolean);
  if (list.length < minPages) return new Set();
  const n = new Map();
  for (const t of list) for (const w of new Set(words(t))) n.set(w, (n.get(w) || 0) + 1);
  return new Set([...n].filter(([, c]) => c / list.length >= share).map(([w]) => w));
}

const key = (u) => String(u || "").replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();

/** The query with the most impressions for each page, skipping brand queries (they rank on the name, not the copy). */
export function topQueries(rows = [], { brandTerms = [], minImpressions = 20 } = {}) {
  const brand = brandTerms.map((b) => String(b).toLowerCase()).filter(Boolean);
  const best = new Map();
  for (const r of rows) {
    if (!r?.page || !r.query || (r.impressions || 0) < minImpressions) continue;
    if (brand.some((b) => r.query.toLowerCase().includes(b))) continue;
    const k = key(r.page), cur = best.get(k);
    if (!cur || r.impressions > cur.impressions) best.set(k, { query: r.query, impressions: r.impressions, clicks: r.clicks || 0, position: r.position ?? null });
  }
  return best;
}

/**
 * Pages whose top query is weakly reflected in the title (under 75 percent of its words), the H1 (under 60 percent) or the
 * description (under 75 percent). Thresholds follow the audit this was derived from; they are guidelines.
 * `pages` are audit.json pages: { url, finalUrl, status, title, h1, description }.
 */
export function keywordAlignment(pages = [], rows = [], opts = {}) {
  const top = topQueries(rows, opts);
  const live = pages.filter((p) => p.status === 200);
  const common = siteWords(live.map((p) => p.title));
  const out = [];
  for (const p of live) {
    const q = top.get(key(p.finalUrl || p.url));
    if (!q) continue;
    const score = { title: coverage(p.title, q.query, common), h1: coverage(p.h1, q.query, common), description: p.description == null ? null : coverage(p.description, q.query, common) };
    const weak = [score.title < 0.75 && "title", score.h1 < 0.6 && "h1", score.description != null && score.description < 0.75 && "description"].filter(Boolean);
    if (weak.length) out.push({ url: p.url, query: q.query, impressions: q.impressions, clicks: q.clicks, position: q.position, weak, score });
  }
  return out.sort((a, b) => b.impressions - a.impressions);
}

/** Pages, average H2 and average H3 per first path segment ("/guides/x" belongs to "guides", "/" to "home"). */
export function sectionOutline(pages = []) {
  const sec = {};
  for (const p of pages) {
    if (p.status !== 200 || p.h2Count == null) continue;
    let path = "/";
    try { path = new URL(p.finalUrl || p.url).pathname; } catch { /* keep "/" */ }
    const s = path.split("/").filter(Boolean)[0] || "home";
    const e = (sec[s] ||= { section: s, pages: 0, h2: 0, h3: 0 });
    e.pages++; e.h2 += p.h2Count; e.h3 += p.h3Count || 0;
  }
  return Object.values(sec).map((e) => ({ section: e.section, pages: e.pages, avgH2: Number((e.h2 / e.pages).toFixed(1)), avgH3: Number((e.h3 / e.pages).toFixed(1)) })).sort((a, b) => b.pages - a.pages);
}
