// Keyword explorer: the research a paid keyword tool does, built from data the user owns or pays for directly.
// Pure: the job collects the sources, this merges, labels, groups and ranks them.
//
// Sources (any subset): Search Console rows (proven demand on this site), Bing related queries (impressions), provider
// keyword ideas (estimated volume, CPC, difficulty), autocomplete phrasings (wording only), and live results per query.
// Grouping: queries whose live top-10 results share at least 3 URLs are one topic (the way search engines group them);
// without live results, queries with the same meaningful words are grouped, and the report says which method was used.
// Every number keeps its source; nothing is estimated that no source gave.
import { classifyIntent } from "./search.mjs";
import { terms, jaccard } from "./text.mjs";

const LOCAL = /\b(near me|nearby|open now|in [a-z]+(?: [a-z]+)?$|directions)\b/;
const QUESTION = /^(how|what|why|when|where|which|who|can|could|does|do|is|are|should|will|would)\b/;
const MODIFIERS = ["best", "cheap", "free", "top", "near me", "vs", "review", "price", "cost", "for beginners", "for small business", "online", "template", "example", "alternative"];
const PROVIDER_INTENT = { informational: "informational", commercial: "commercial", transactional: "transactional", navigational: "navigational" };

const norm = (q) => String(q || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Merge every source into one record per query. `brandTerms` (the site's own brand) are left out of research. */
export function mergeCandidates({ gsc = [], bing = [], ideas = [], planner = [], suggest = [] } = {}, { seeds = [], brandTerms = [], ignore = [] } = {}) {
  const map = new Map();
  const get = (q) => map.get(q) || map.set(q, { query: q, sources: [], impressions: 0, clicks: 0, position: null, pages: [], bingImpressions: null, volume: null, cpc: null, difficulty: null, providerIntent: null, trend: null, googleVolume: null }).get(q);
  const add = (k, src) => { if (!k.sources.includes(src)) k.sources.push(src); };
  const posW = new Map();
  for (const r of gsc) {
    const q = norm(r.query); if (!q) continue;
    const k = get(q); add(k, "search-console");
    k.impressions += r.impressions || 0; k.clicks += r.clicks || 0;
    if (r.page && !k.pages.includes(r.page)) k.pages.push(r.page);
    const w = posW.get(q) || [0, 0]; w[0] += (r.position || 0) * (r.impressions || 0); w[1] += r.impressions || 0; posW.set(q, w);
  }
  for (const [q, [s, n]] of posW) if (n) map.get(q).position = Number((s / n).toFixed(1));
  for (const r of bing) { const k = get(norm(r.query)); add(k, "bing"); k.bingImpressions = (k.bingImpressions || 0) + (r.bingImpressions || 0); }
  for (const r of ideas) {
    const k = get(norm(r.query)); add(k, "provider");
    for (const f of ["volume", "cpc", "difficulty", "trend"]) if (r[f] != null) k[f] = r[f];
    if (r.competition != null) k.competition = r.competition;
    if (r.intent) k.providerIntent = PROVIDER_INTENT[r.intent] || null;
  }
  // Keyword Planner: Google's own estimate. Its trend and competition win over a third party's.
  for (const r of planner) {
    const k = get(norm(r.query)); add(k, "google-ads");
    if (r.volume != null) k.googleVolume = r.volume;
    if (r.competition) k.competition = r.competition;
    if (r.bidLow != null || r.bidHigh != null) k.bid = { low: r.bidLow, high: r.bidHigh };
    if (r.trend?.length) k.trend = r.trend;
  }
  for (const r of suggest) add(get(norm(r.query)), "suggest");

  const brand = [...brandTerms, ...ignore].map(norm).filter(Boolean);
  const seedTerms = seeds.map((s) => terms(s)).filter((t) => t.length);
  const relevant = (q) => !seedTerms.length || seedTerms.some((st) => { const qt = new Set(terms(q)); const hit = st.filter((t) => qt.has(t)).length; return hit >= Math.ceil(st.length / 2); });
  return [...map.values()].filter((k) => k.query && !brand.some((b) => k.query.includes(b)) && relevant(k.query));
}

/** Intent, question and modifier labels for one keyword. Provider intent wins when given; words decide otherwise. */
export function label(k, brandTerms = []) {
  const words = classifyIntent(k.query, brandTerms);
  const intent = k.providerIntent || (words === "unclear" && QUESTION.test(k.query) ? "informational" : words);
  return { ...k, intent, local: LOCAL.test(k.query), question: QUESTION.test(k.query), modifiers: MODIFIERS.filter((m) => new RegExp(`\\b${m}\\b`).test(k.query)) };
}

/** Demand of a keyword in one comparable number, and where it came from. Google Keyword Planner > provider volume > Bing > Search Console impressions. */
export function demand(k) {
  if (k.googleVolume != null) return { value: k.googleVolume, basis: "Google Keyword Planner monthly searches (Google's estimate)" };
  if (k.volume != null) return { value: k.volume, basis: "provider monthly volume (estimate)" };
  if (k.bingImpressions != null) return { value: k.bingImpressions, basis: "Bing impressions, 90 days" };
  if (k.impressions) return { value: k.impressions, basis: "your Search Console impressions, 28 days" };
  return { value: 0, basis: "no volume data" };
}

/**
 * Group keywords into topics. `serps` maps query -> top-10 result URLs (from a SERP provider). With them, two queries join
 * when they share at least `minShared` URLs; without, when their meaningful words are the same set (or very close).
 */
export function groupKeywords(list, { serps = {}, minShared = 3, similarity = 0.75 } = {}) {
  const ordered = [...list].sort((a, b) => demand(b).value - demand(a).value || a.query.localeCompare(b.query));
  const groups = [];
  for (const k of ordered) {
    const urls = serps[k.query], ts = terms(k.query);
    let best = null, bestScore = 0;
    for (const g of groups) {
      let score = 0;
      if (urls && g.urls) { const shared = urls.filter((u) => g.urls.includes(u)).length; score = shared >= minShared ? shared / 10 + 1 : 0; }
      else { const j = jaccard(ts, g.terms); score = j >= similarity ? j : 0; }
      if (score > bestScore) { best = g; bestScore = score; }
    }
    if (best) best.members.push(k);
    else groups.push({ parent: k, members: [k], urls: urls || null, terms: ts, method: urls ? "shared results" : "same words" });
  }
  return groups;
}

/** Difficulty 0 to 100: provider's figure when given; else 10 x the average authority (0 to 10) of the top-10 domains. */
export function difficulty(k, { serp = null, authority = {} } = {}) {
  if (k.difficulty != null) return { value: Math.round(k.difficulty), basis: "provider keyword difficulty" };
  if (!serp?.length) return null;
  const scores = serp.slice(0, 10).map((r) => authority[r.domain]).filter((x) => x != null);
  if (scores.length < 5) return null;
  return { value: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10), basis: `average Open PageRank of ${scores.length} top-10 domains` };
}

const INTENT_WEIGHT = { transactional: 1.3, commercial: 1.2, informational: 1, local: 1.2, navigational: 0.3, unclear: 0.8 };

/**
 * Opportunity: demand, weighted by intent, raised when the site already sits on page one or two (positions 4 to 20 need the
 * least work), lowered by difficulty. A relative ranking inside this report, not a forecast of traffic.
 */
export function opportunity(g, diff) {
  const d = g.members.reduce((n, k) => n + demand(k).value, 0);
  const pos = g.parent.position;
  const posFactor = pos == null ? 1 : pos <= 3 ? 0.4 : pos <= 20 ? 1.6 : 1.1;
  const diffFactor = diff ? 1 - Math.min(diff.value, 90) / 120 : 0.85;
  return Math.round(Math.log10(1 + d) * 100 * (INTENT_WEIGHT[g.parent.local ? "local" : g.parent.intent] || 1) * posFactor * diffFactor) / 10;
}

/** The page that owns a group: the best-ranking page in Search Console, else an existing page whose title covers the topic. */
export function ownerPage(g, pages = []) {
  const ranked = g.members.filter((k) => k.pages?.length && k.position != null).sort((a, b) => a.position - b.position)[0];
  if (ranked) return { url: ranked.pages[0], basis: `ranks at ${ranked.position} for "${ranked.query}"` };
  const pt = terms(g.parent.query);
  const hit = pages.find((p) => { const tt = new Set(terms(`${p.title || ""} ${p.h1 || ""}`)); return pt.length && pt.every((t) => tt.has(t)); });
  return hit ? { url: hit.url, basis: "title covers the topic" } : null;
}

/** Everything: labelled keywords, groups with parent topic, demand, difficulty, opportunity and owner page; questions. */
export function explore(sources, { seeds = [], brandTerms = [], ignore = [], serps = {}, serpResults = {}, authority = {}, pages = [] } = {}) {
  const list = mergeCandidates(sources, { seeds, brandTerms, ignore }).map((k) => label(k, brandTerms));
  const groups = groupKeywords(list, { serps }).map((g) => {
    const diff = difficulty(g.parent, { serp: serpResults[g.parent.query], authority });
    const totals = g.members.reduce((t, k) => ({ volume: t.volume + (k.googleVolume ?? k.volume ?? 0), impressions: t.impressions + k.impressions, clicks: t.clicks + k.clicks, bing: t.bing + (k.bingImpressions || 0) }), { volume: 0, impressions: 0, clicks: 0, bing: 0 });
    return {
      parent: g.parent.query, intent: g.parent.intent, local: g.parent.local, method: g.method, keywords: g.members.length,
      members: g.members.map((k) => k.query), totals, demand: demand(g.parent), position: g.parent.position,
      difficulty: diff, opportunity: opportunity(g, diff), owner: ownerPage(g, pages),
    };
  }).sort((a, b) => b.opportunity - a.opportunity);
  const sourcesUsed = [...new Set(list.flatMap((k) => k.sources))];
  return {
    seeds, sourcesUsed, keywords: list.length, groups,
    questions: list.filter((k) => k.question).sort((a, b) => demand(b).value - demand(a).value).map((k) => ({ query: k.query, demand: demand(k), position: k.position })),
    list: list.sort((a, b) => demand(b).value - demand(a).value),
    gaps: groups.filter((g) => !g.owner && g.intent !== "navigational").slice(0, 25),
  };
}

const n = (x) => (x == null ? "-" : String(x));

export function keywordsMarkdown(r, siteName) {
  const L = [`# ${siteName} keyword explorer`, ""];
  L.push(`Seeds: ${r.seeds.length ? r.seeds.map((s) => `"${s}"`).join(", ") : "none (all your Search Console queries)"}. Sources: ${r.sourcesUsed.join(", ") || "none"}. ${r.keywords} keywords in ${r.groups.length} topics.`);
  L.push("Grouping by shared results means the live top 10 overlap by at least 3 pages; grouping by same words is an approximation. Volumes from Google Keyword Planner and from a provider are estimates (Google rounds them, more coarsely for accounts with little ad spend); Search Console and Bing numbers are measured impressions. Opportunity is a ranking inside this report, not a traffic forecast.", "");
  L.push("## Topics by opportunity", "", "| Topic (parent) | Intent | Keywords | Demand | Your position | Difficulty | Owner page | Opportunity |", "|---|---|---|---|---|---|---|---|");
  for (const g of r.groups.slice(0, 40)) L.push(`| ${g.parent} | ${g.intent}${g.local ? ", local" : ""} | ${g.keywords} | ${g.demand.value} (${g.demand.basis}) | ${n(g.position)} | ${g.difficulty ? `${g.difficulty.value} (${g.difficulty.basis})` : "-"} | ${g.owner ? g.owner.url : "**none: gap**"} | ${g.opportunity} |`);
  L.push("", "## Gaps (no page owns the topic)", "", ...(r.gaps.length ? r.gaps.slice(0, 15).map((g) => `- **${g.parent}** (${g.intent}): ${g.keywords} keywords, demand ${g.demand.value} (${g.demand.basis}). Also: ${g.members.slice(1, 6).join(", ") || "-"}`) : ["- none found"]));
  L.push("", "## Questions people ask", "", ...(r.questions.length ? r.questions.slice(0, 30).map((q) => `- ${q.query} (${q.demand.value}, ${q.demand.basis}${q.position != null ? `; you rank ${q.position}` : ""})`) : ["- none in these sources"]));
  return L.join("\n") + "\n";
}

/**
 * Interest in a topic from monthly Wikipedia pageviews: the average, the last 3 months against the 3 before, and the peak.
 * A sign of how attention moves, not search volume. Null under 6 months of data or with no views.
 */
export function interest(months = []) {
  const v = months.map((x) => x.views);
  if (v.length < 6 || !v.some(Boolean)) return null;
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const recent = avg(v.slice(-3)), before = avg(v.slice(-6, -3));
  const peak = months.reduce((p, x) => (x.views > p.views ? x : p), months[0]);
  return { average: Math.round(avg(v)), recent: Math.round(recent), change: before ? Math.round(((recent - before) / before) * 100) : null, peak: peak.month, months };
}

/** Community questions, most viewed first, each with the site page that already covers it (most of its words in a title), if any. */
export function communityQuestions(items = [], pages = []) {
  const seen = new Set(), titles = pages.map((p) => ({ url: p.url, t: new Set(terms(`${p.title || ""} ${p.h1 || ""}`)) }));
  return items.filter((q) => !seen.has(q.url) && seen.add(q.url)).sort((a, b) => (b.views || 0) - (a.views || 0)).map((q) => {
    const qt = [...new Set(terms(q.title))];
    const hit = qt.length >= 2 && titles.find((p) => qt.filter((t) => p.t.has(t)).length / qt.length >= 0.6);
    return { ...q, covered: hit ? hit.url : null };
  });
}

/** Report sections for the open-data sources; empty when neither ran. */
export function openDataMarkdown({ topics = [], community = [] } = {}) {
  const L = [];
  if (topics.length) {
    L.push("", "## Topic interest (Wikipedia pageviews)", "", "Monthly human views of the closest Wikipedia article: how attention to the topic moves. Not search volume.", "", "| Seed | Article | Monthly average | Last 3 months vs 3 before | Peak month |", "|---|---|---|---|---|");
    for (const t of topics) L.push(`| ${t.seed} | [${t.article.title}](${t.article.url}) | ${t.interest ? t.interest.average : "-"} | ${t.interest?.change != null ? `${t.interest.change > 0 ? "+" : ""}${t.interest.change}%` : "-"} | ${t.interest?.peak || "-"} |`);
  }
  if (community.length) {
    L.push("", "## Questions people ask in communities (Stack Exchange)", "", "Real questions in the asker's words, most viewed first. Views are lifetime views on that site.", "");
    for (const q of community.slice(0, 25)) L.push(`- [${q.title}](${q.url}) (${q.site}; ${q.views ?? "-"} views, ${q.answers} answer(s)${q.covered ? `; covered by ${q.covered}` : "; **no page covers it**"})`);
  }
  return L.length ? L.join("\n") + "\n" : "";
}
