// Competitor and keyword gap: who the site really competes with in search, which queries they win that the site does not,
// and which of their pages earn that. Pure.
//
// Competitors come from the owner's list, else from share of voice in the rank tracker's live check (big platforms such as
// Wikipedia or YouTube are listed apart: they compete for clicks, not for customers). Competitor rankings come from a
// provider's ranked-keywords data when a key is set; without one, only the tracked queries' live results are compared, and
// the report says so.
import { label, groupKeywords } from "./keywords.mjs";

export const PLATFORMS = new Set(["wikipedia.org", "youtube.com", "reddit.com", "amazon.com", "amazon.co.uk", "facebook.com", "linkedin.com", "quora.com", "instagram.com", "x.com", "twitter.com", "pinterest.com", "tiktok.com", "medium.com", "yelp.com", "trustpilot.com", "indeed.com", "gov.uk", "nhs.uk", "google.com", "apple.com", "microsoft.com", "github.com", "ebay.com", "ebay.co.uk", "tripadvisor.com", "tripadvisor.co.uk"]);
const bare = (d) => String(d || "").replace(/^www\./, "").toLowerCase();
const isPlatform = (d) => PLATFORMS.has(bare(d)) || [...PLATFORMS].some((p) => bare(d).endsWith(`.${p}`));

/** Configured competitors first; then the top domains by share of voice, platforms set apart. */
export function competitors({ configured = [], shareOfVoice = [], own, max = 5 } = {}) {
  const ownD = bare(own);
  const list = configured.map(bare).filter((d) => d && d !== ownD);
  if (list.length) return { domains: list.slice(0, 10), platforms: [], basis: "your configured competitors" };
  const found = shareOfVoice.filter((x) => !x.own && bare(x.domain) !== ownD);
  return { domains: found.filter((x) => !isPlatform(x.domain)).slice(0, max).map((x) => bare(x.domain)), platforms: found.filter((x) => isPlatform(x.domain)).slice(0, 5).map((x) => bare(x.domain)), basis: "share of voice in the rank tracker's live check" };
}

/**
 * own: Map query -> your position (Search Console average or provider). theirs: { domain: [{ query, position, url, volume, traffic, intent }] }.
 * A gap is a query at least one competitor ranks top `top` for while you are absent or below `weakFrom`.
 */
export function keywordGap(own, theirs, { top = 10, weakFrom = 11 } = {}) {
  const by = new Map();
  for (const [domain, list] of Object.entries(theirs)) for (const k of list) {
    if (k.position == null || k.position > top) continue;
    const q = String(k.query).toLowerCase();
    const e = by.get(q) || { query: q, competitors: [], volume: null, intent: k.intent || null };
    e.competitors.push({ domain, position: k.position, url: k.url || "" });
    if (k.volume != null) e.volume = Math.max(e.volume ?? 0, k.volume);
    by.set(q, e);
  }
  const rows = [...by.values()].map((e) => {
    const yours = own.get(e.query) ?? null;
    const kind = yours == null || yours > 50 ? "missing" : yours >= weakFrom ? "weak" : "shared";
    return { ...e, yours, kind, competitors: e.competitors.sort((a, b) => a.position - b.position) };
  });
  const order = (a, b) => b.competitors.length - a.competitors.length || (b.volume ?? 0) - (a.volume ?? 0) || a.query.localeCompare(b.query);
  return { missing: rows.filter((r) => r.kind === "missing").sort(order), weak: rows.filter((r) => r.kind === "weak").sort(order), shared: rows.filter((r) => r.kind === "shared").sort(order) };
}

/** Queries you rank top `top` for that no listed competitor does: what to protect. */
export function strengths(own, theirs, { top = 10 } = {}) {
  const theirsTop = new Set(Object.values(theirs).flatMap((l) => l.filter((k) => k.position != null && k.position <= top).map((k) => String(k.query).toLowerCase())));
  return [...own].filter(([q, p]) => p != null && p <= top && !theirsTop.has(q)).sort((a, b) => a[1] - b[1]).map(([query, position]) => ({ query, position }));
}

/** The competitor pages behind the most gap queries: the pages worth studying first. */
export function winningPages(gaps) {
  const by = new Map();
  for (const g of gaps) for (const c of g.competitors) {
    if (!c.url) continue;
    const e = by.get(c.url) || { url: c.url, domain: c.domain, queries: [], volume: 0 };
    e.queries.push(g.query); e.volume += g.volume || 0; by.set(c.url, e);
  }
  return [...by.values()].sort((a, b) => b.queries.length - a.queries.length || b.volume - a.volume);
}

/** Gap queries grouped into topics (same-words grouping), each with its total demand and the competitors in it. */
export function gapTopics(gaps) {
  const list = gaps.map((g) => label({ query: g.query, volume: g.volume, impressions: 0, clicks: 0, providerIntent: g.intent }));
  const meta = new Map(gaps.map((g) => [g.query, g]));
  return groupKeywords(list).map((grp) => ({
    topic: grp.parent.query, intent: grp.parent.intent, queries: grp.members.map((m) => m.query),
    volume: grp.members.reduce((n, m) => n + (m.volume || 0), 0),
    competitors: [...new Set(grp.members.flatMap((m) => meta.get(m.query).competitors.map((c) => c.domain)))],
  })).sort((a, b) => b.competitors.length - a.competitors.length || b.volume - a.volume);
}

export function gapMarkdown({ siteName, comp, gap, topics, pages, strong, method, notes = [] }) {
  const L = [`# ${siteName} competitor and keyword gap`, ""];
  L.push(`Competitors (${comp.basis}): ${comp.domains.join(", ") || "none found"}.${comp.platforms.length ? ` Platforms that also take clicks: ${comp.platforms.join(", ")}.` : ""}`);
  L.push(`Method: ${method}. Volumes are the provider's estimates where shown; your positions are Search Console averages.`, "");
  L.push(`- Missing (they rank top 10, you do not rank): **${gap.missing.length}**`, `- Weak (they rank top 10, you are on page 2 or lower): **${gap.weak.length}**`, `- Shared (you are both top 10): ${gap.shared.length}`, `- Yours alone (you top 10, none of them): ${strong.length}`);
  L.push("", "## Gap topics, most contested first", "", "| Topic | Intent | Queries | Volume | Competitors |", "|---|---|---|---|---|");
  for (const t of topics.slice(0, 30)) L.push(`| ${t.topic} | ${t.intent} | ${t.queries.length} | ${t.volume || "-"} | ${t.competitors.join(", ")} |`);
  L.push("", "## Weak: you are close (page 2 and below)", ...(gap.weak.slice(0, 20).map((g) => `- ${g.query}: you ${g.yours}; ${g.competitors.map((c) => `${c.domain} ${c.position}`).join(", ")}${g.volume != null ? ` (volume ${g.volume})` : ""}`)), ...(gap.weak.length ? [] : ["- none"]));
  L.push("", "## Their pages behind the most gap queries", ...(pages.slice(0, 15).map((p) => `- ${p.url}: ${p.queries.length} queries (${p.queries.slice(0, 4).join(", ")})`)), ...(pages.length ? [] : ["- none"]));
  L.push("", "## Yours alone: protect these", ...(strong.slice(0, 15).map((s) => `- ${s.query} (${s.position})`)), ...(strong.length ? [] : ["- none"]));
  if (notes.length) L.push("", "## Notes", ...notes.map((n) => `- ${n}`));
  return L.join("\n") + "\n";
}
