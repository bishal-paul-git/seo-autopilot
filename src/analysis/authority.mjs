// Backlink and authority profile: referring domains from every source you have, their authority, what is new and lost, how
// you compare with competitors, and the link intersect (sites that link to several competitors but not to you, the best
// prospects for honest outreach). Pure.
//
// Sources: your Search Console links export (via `inbound`), a provider's referring-domains data (DataForSEO), and Open
// PageRank authority (0 to 10, computed from the open Common Crawl web graph). Provider and Open PageRank numbers are
// third-party estimates; the report labels them.

const bare = (d) => String(d || "").replace(/^www\./, "").toLowerCase();

/** One record per referring domain, with the sources that saw it. */
export function mergeDomains(sources) {
  const by = new Map();
  for (const [src, list] of Object.entries(sources)) for (const x of list || []) {
    const d = bare(typeof x === "string" ? x : x.domain);
    if (!d) continue;
    const e = by.get(d) || { domain: d, sources: [], links: null, providerRank: null, firstSeen: null };
    if (!e.sources.includes(src)) e.sources.push(src);
    if (typeof x === "object") {
      if (x.links != null || x.backlinks != null) e.links = Math.max(e.links ?? 0, x.links ?? x.backlinks);
      if (x.rank != null) e.providerRank = x.rank;
      if (x.firstSeen && (!e.firstSeen || x.firstSeen < e.firstSeen)) e.firstSeen = x.firstSeen;
      if (x.lost) e.lost = x.lost;
    }
    by.set(d, e);
  }
  return [...by.values()];
}

export const tier = (a) => (a == null ? "unknown" : a >= 7 ? "high (7-10)" : a >= 4 ? "medium (4-6.9)" : a >= 2 ? "low (2-3.9)" : "very low (<2)");

/** Profile: counts, authority tiers, top domains by authority, new and lost against the last snapshot. */
export function profile(domains, { authority = {}, previous = null } = {}) {
  const withA = domains.map((d) => ({ ...d, authority: authority[d.domain] ?? null })).filter((d) => !d.lost);
  const tiers = {};
  for (const d of withA) tiers[tier(d.authority)] = (tiers[tier(d.authority)] || 0) + 1;
  const prev = new Set(previous?.domains || []), now = new Set(withA.map((d) => d.domain));
  const known = withA.filter((d) => d.authority != null);
  return {
    referringDomains: withA.length, tiers,
    averageAuthority: known.length ? Number((known.reduce((n, d) => n + d.authority, 0) / known.length).toFixed(2)) : null,
    top: [...withA].sort((a, b) => (b.authority ?? -1) - (a.authority ?? -1) || (b.links ?? 0) - (a.links ?? 0)).slice(0, 25),
    newDomains: previous ? withA.filter((d) => !prev.has(d.domain)).sort((a, b) => (b.authority ?? -1) - (a.authority ?? -1)) : [],
    lostDomains: previous ? [...prev].filter((d) => !now.has(d)).sort() : [],
    providerLost: domains.filter((d) => d.lost).map((d) => ({ domain: d.domain, lost: d.lost })),
    domains: withA.map((d) => d.domain).sort(),
  };
}

/** Link intersect: domains linking to at least `min` competitors and not to you, best authority first. */
export function intersect(own, competitors, { authority = {}, min = 2, exclude = [] } = {}) {
  const mine = new Set(own.map(bare)), skip = new Set(exclude.map(bare));
  const by = new Map();
  for (const [comp, list] of Object.entries(competitors)) for (const x of list || []) {
    const d = bare(x.domain || x);
    if (!d || mine.has(d) || skip.has(d) || d === bare(comp)) continue;
    const e = by.get(d) || { domain: d, linksTo: [] };
    if (!e.linksTo.includes(comp)) e.linksTo.push(comp);
    by.set(d, e);
  }
  return [...by.values()].filter((e) => e.linksTo.length >= min).map((e) => ({ ...e, authority: authority[e.domain] ?? null }))
    .sort((a, b) => b.linksTo.length - a.linksTo.length || (b.authority ?? -1) - (a.authority ?? -1));
}

/** You vs each competitor: referring domains and site authority. */
export function compare(ownDomain, ownCount, competitors, authority = {}) {
  return [{ domain: bare(ownDomain), you: true, referringDomains: ownCount, authority: authority[bare(ownDomain)] ?? null },
    ...Object.entries(competitors).map(([d, list]) => ({ domain: bare(d), you: false, referringDomains: (list || []).length, authority: authority[bare(d)] ?? null }))]
    .sort((a, b) => (b.authority ?? -1) - (a.authority ?? -1));
}

export function authorityMarkdown({ siteName, p, cmp, ix, sourcesUsed, notes = [] }) {
  const L = [`# ${siteName} backlink and authority profile`, "", `Sources: ${sourcesUsed.join(", ") || "none"}. Authority is Open PageRank (0 to 10, from the open Common Crawl web graph) where available; provider counts are the provider's estimates. A link's worth depends on relevance as much as authority: use this to find and prioritise, not to buy.`, ""];
  L.push(`- Referring domains: **${p.referringDomains}**${p.averageAuthority != null ? `, average authority ${p.averageAuthority}` : ""}`);
  L.push(`- By authority: ${Object.entries(p.tiers).map(([k, v]) => `${k}: ${v}`).join(", ") || "-"}`);
  if (p.newDomains.length || p.lostDomains.length) L.push(`- Since last run: ${p.newDomains.length} new, ${p.lostDomains.length} lost`);
  if (cmp.length > 1) L.push("", "## You and your competitors", "", "| Site | Authority | Referring domains |", "|---|---|---|", ...cmp.map((c) => `| ${c.domain}${c.you ? " (you)" : ""} | ${c.authority ?? "-"} | ${c.referringDomains} |`));
  L.push("", "## Strongest referring domains", ...(p.top.length ? p.top.slice(0, 15).map((d) => `- ${d.domain}: authority ${d.authority ?? "-"}${d.links != null ? `, ${d.links} links` : ""} (${d.sources.join(", ")})`) : ["- none"]));
  if (p.newDomains.length) L.push("", "## New referring domains", ...p.newDomains.slice(0, 20).map((d) => `- ${d.domain} (authority ${d.authority ?? "-"})`));
  if (p.lostDomains.length) L.push("", "## Lost referring domains (check whether the link or the page went away)", ...p.lostDomains.slice(0, 20).map((d) => `- ${d}`));
  L.push("", "## Link intersect: they link to several competitors, not to you", "These sites already link to businesses like yours. Look at why (a directory, a guide, a list, a partner page) and whether you honestly belong there. Drafts only; a person decides and sends.", ...(ix.length ? ix.slice(0, 25).map((x) => `- ${x.domain}: links to ${x.linksTo.join(", ")}${x.authority != null ? ` (authority ${x.authority})` : ""}`) : ["- none found (needs a provider key and at least two competitors)"]));
  if (notes.length) L.push("", "## Notes", ...notes.map((n) => `- ${n}`));
  return L.join("\n") + "\n";
}
