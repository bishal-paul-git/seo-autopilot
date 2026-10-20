// Internal link graph: where the site's own links send authority, how far each page is from the home page, which pages no
// page links to, and which pages earn search demand but receive little internal weight. Pure.
//
// Internal PageRank is the classic random-surfer model (damping 0.85) over indexable pages only. It measures how the site's
// own linking distributes weight, not Google's view of the site, and the report says so. Weight sent to redirects, errors
// and noindex pages is counted as leaked.
import { terms, jaccard } from "./text.mjs";

const norm = (u) => String(u || "").replace(/#.*$/, "").replace(/\/$/, "");

/** PageRank over { node: [targets] }. Dangling nodes spread their weight evenly. Returns { node: score } summing to 1. */
export function pagerank(graph, { damping = 0.85, tolerance = 1e-9, maxIterations = 200 } = {}) {
  const nodes = Object.keys(graph), n = nodes.length;
  if (!n) return {};
  let pr = Object.fromEntries(nodes.map((x) => [x, 1 / n]));
  for (let it = 0; it < maxIterations; it++) {
    const next = Object.fromEntries(nodes.map((x) => [x, (1 - damping) / n]));
    let dangling = 0;
    for (const x of nodes) {
      const out = graph[x];
      if (!out.length) { dangling += pr[x]; continue; }
      const share = (damping * pr[x]) / out.length;
      for (const t of out) next[t] += share;
    }
    for (const x of nodes) next[x] += (damping * dangling) / n;
    const delta = nodes.reduce((s, x) => s + Math.abs(next[x] - pr[x]), 0);
    pr = next;
    if (delta < tolerance) break;
  }
  return pr;
}

/** Breadth-first click depth from the home page; unreachable pages are absent. */
export function clickDepth(graph, home) {
  const depth = { [home]: 0 }, queue = [home];
  while (queue.length) { const x = queue.shift(); for (const t of graph[x] || []) if (!(t in depth)) { depth[t] = depth[x] + 1; queue.push(t); } }
  return depth;
}

/**
 * pages: audit.json pages ({ url, finalUrl, status, noindex, canonical, links, title, h1 }). rows: Search Console rows.
 * Returns scores, depth, orphans, leaks, hubs and the pages that earn demand but get little internal weight.
 */
export function analyseGraph(pages, { home, rows = [] } = {}) {
  const byUrl = new Map(pages.map((p) => [norm(p.url), p]));
  const indexable = (p) => p && p.status === 200 && !p.noindex && (!p.canonical || norm(p.canonical) === norm(p.url));
  const nodes = pages.filter(indexable).map((p) => norm(p.url));
  const set = new Set(nodes), graph = {}, inbound = Object.fromEntries(nodes.map((x) => [x, 0]));
  let edges = 0, leaked = 0;
  const leaks = new Map();
  for (const x of nodes) {
    const outs = [...new Set((byUrl.get(x).links || []).map(norm))].filter((t) => t !== x);
    graph[x] = outs.filter((t) => set.has(t));
    for (const t of graph[x]) inbound[t]++;
    edges += graph[x].length;
    for (const t of outs.filter((t) => !set.has(t) && byUrl.has(t))) {
      const p = byUrl.get(t);
      const why = p.status >= 400 ? `answers ${p.status}` : p.status >= 300 ? "redirects" : p.noindex ? "noindex" : "canonical points elsewhere";
      leaked++;
      const e = leaks.get(t) || { url: t, why, from: 0 }; e.from++; leaks.set(t, e);
    }
  }
  const pr = pagerank(graph);
  const max = Math.max(...Object.values(pr), 0) || 1;
  const homeKey = norm(home);
  const depth = clickDepth(graph, set.has(homeKey) ? homeKey : nodes[0]);
  const demand = new Map();
  for (const r of rows) { const k = norm(r.page); const d = demand.get(k) || { impressions: 0, clicks: 0, pw: 0 }; d.impressions += r.impressions || 0; d.clicks += r.clicks || 0; d.pw += (r.position || 0) * (r.impressions || 0); demand.set(k, d); }

  const list = nodes.map((x) => {
    const d = demand.get(x);
    return { url: x, score: Number(((pr[x] / max) * 100).toFixed(1)), share: pr[x], inbound: inbound[x], outbound: graph[x].length, depth: depth[x] ?? null, impressions: d?.impressions || 0, clicks: d?.clicks || 0, position: d?.impressions ? Number((d.pw / d.impressions).toFixed(1)) : null, title: byUrl.get(x).title || "" };
  });
  const sorted = [...list].sort((a, b) => b.share - a.share);
  const rankOf = new Map(sorted.map((p, i) => [p.url, i / Math.max(1, sorted.length - 1)]));
  const byDemand = list.filter((p) => p.impressions > 0).sort((a, b) => b.impressions - a.impressions);
  const demandRank = new Map(byDemand.map((p, i) => [p.url, i / Math.max(1, byDemand.length - 1)]));
  // Under-linked: in the top half by demand, bottom half by internal weight, and within reach (positions 4 to 20).
  const underLinked = byDemand.filter((p) => demandRank.get(p.url) <= 0.5 && rankOf.get(p.url) >= 0.5 && p.position != null && p.position >= 4 && p.position <= 20)
    .map((p) => ({ ...p, donors: donors(p, sorted, graph) }));
  return {
    pages: list.length, edges, averageInbound: list.length ? Number((edges / list.length).toFixed(1)) : 0,
    top: sorted.slice(0, 20), orphans: list.filter((p) => p.inbound === 0 && p.url !== homeKey),
    unreachable: list.filter((p) => p.depth == null), deep: list.filter((p) => p.depth != null && p.depth > 3).sort((a, b) => b.depth - a.depth),
    leaks: { links: leaked, share: edges + leaked ? Number((leaked / (edges + leaked)).toFixed(3)) : 0, targets: [...leaks.values()].sort((a, b) => b.from - a.from).slice(0, 25) },
    hubs: [...list].sort((a, b) => b.outbound - a.outbound).slice(0, 10), underLinked: underLinked.slice(0, 25),
    depthCounts: list.reduce((m, p) => { const k = p.depth == null ? "unreachable" : String(p.depth); m[k] = (m[k] || 0) + 1; return m; }, {}),
  };
}

/** Strong pages that do not link to the target yet, preferring ones about a related topic (shared title words). */
function donors(target, sorted, graph) {
  const tt = terms(target.title);
  return sorted.filter((p) => p.url !== target.url && !graph[p.url].includes(target.url))
    .map((p) => ({ url: p.url, score: p.score, related: Number(jaccard(tt, terms(p.title)).toFixed(2)) }))
    .filter((p) => p.related > 0 || p.score >= 50).sort((a, b) => b.related - a.related || b.score - a.score).slice(0, 3);
}

export function graphMarkdown(r, { siteName, site }) {
  const p = (u) => u.replace(site.replace(/\/$/, ""), "") || "/";
  const L = [`# ${siteName} internal link graph`, "", `${r.pages} indexable pages, ${r.edges} internal links between them (${r.averageInbound} per page on average). Scores are internal PageRank from your own links (100 = the strongest page): how your linking spreads weight, not Google's view of the site.`, ""];
  L.push(`- Click depth from the home page: ${Object.entries(r.depthCounts).sort().map(([d, n]) => `${d}: ${n}`).join(", ")}`);
  L.push(`- Orphan pages (no internal links in): **${r.orphans.length}**; deeper than 3 clicks: ${r.deep.length}; unreachable from the home page: ${r.unreachable.length}`);
  L.push(`- Links to redirects, errors or noindex pages: ${r.leaks.links} (${Math.round(r.leaks.share * 100)}% of internal links)`);
  L.push("", "## Earning search demand but weakly linked (most to gain)", "Pages in the top half by Search Console impressions, the bottom half by internal weight, and at positions 4 to 20.", ...(r.underLinked.length ? r.underLinked.map((x) => `- ${p(x.url)}: ${x.impressions} impressions, position ${x.position}, internal score ${x.score}, ${x.inbound} links in. Link from: ${x.donors.map((d) => `${p(d.url)} (score ${d.score}${d.related ? ", related" : ""})`).join(", ") || "-"}`) : ["- none"]));
  L.push("", "## Strongest pages", ...r.top.slice(0, 10).map((x) => `- ${p(x.url)}: ${x.score} (${x.inbound} in, depth ${x.depth ?? "-"})`));
  if (r.orphans.length) L.push("", "## Orphan pages", ...r.orphans.slice(0, 25).map((x) => `- ${p(x.url)}${x.impressions ? ` (${x.impressions} impressions)` : ""}`));
  if (r.leaks.targets.length) L.push("", "## Links that leak weight (fix the link or the target)", ...r.leaks.targets.slice(0, 15).map((x) => `- ${p(x.url)} ${x.why}: linked from ${x.from} page(s)`));
  return L.join("\n") + "\n";
}
