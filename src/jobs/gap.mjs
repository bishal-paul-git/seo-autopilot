// Competitor and keyword gap: which queries your competitors rank for that you do not, grouped into topics, with the
// competitor pages that win them and what is yours alone.
//   npx seo-autopilot run gap [--competitors a.com,b.com] [--limit 500]
// Competitors: --competitors, else research.competitors in the config, else discovered by `run rank --serp`.
// Full gap (every query a competitor ranks for) needs DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD. Without it the gap covers the
// rank tracker's tracked queries only. Writes gap.json and gap.md in the state folder.
import { readJson, writeJson, writeText } from "../core/util.mjs";
import { dataforseo } from "../lib/research-sources.mjs";
import { competitors, keywordGap, strengths, winningPages, gapTopics, gapMarkdown } from "../analysis/gap.mjs";
import { marketOf } from "./keywords.mjs";

export const description = "Competitor and keyword gap: queries competitors win that you do not, by topic, with their winning pages (full gap needs DataForSEO)";

export async function run({ site, flags = {} }, deps = {}) {
  const env = deps.env || process.env, f = deps.fetch || globalThis.fetch, s = site.paths.state, m = marketOf(site);
  const own = new URL(site.url).hostname.replace(/^www\./, "");
  const rank = readJson(`${s}/rank.json`, {});
  const configured = flags.competitors ? String(flags.competitors).split(",") : site.research?.competitors || [];
  const comp = competitors({ configured, shareOfVoice: rank.live?.shareOfVoice || [], own });
  if (!comp.domains.length) { console.log("gap: no competitors yet. Pass --competitors a.com,b.com, set research.competitors in the config, or run `rank --serp` first."); return; }

  const notes = [];
  // Your positions: Search Console (impression-weighted per query), the site's own data.
  const ownPos = new Map(), w = new Map();
  for (const r of readJson(`${s}/gsc-rows.json`, { rows: [] }).rows || []) {
    const q = String(r.query).toLowerCase(), x = w.get(q) || [0, 0];
    x[0] += r.position * r.impressions; x[1] += r.impressions; w.set(q, x);
  }
  for (const [q, [p, n]] of w) if (n) ownPos.set(q, Number((p / n).toFixed(1)));

  const theirs = {};
  let method;
  if (dataforseo.enabled(env)) {
    method = "each competitor's ranked keywords from DataForSEO, against your Search Console positions";
    for (const d of comp.domains) {
      try { theirs[d] = await dataforseo.ranked(d, m, { fetch: f, env, limit: Number(flags.limit || 500) }); }
      catch (e) { notes.push(`dataforseo ${d}: ${e.message}`); }
    }
    // Queries you rank for but Search Console does not report (anonymised or below its row limit): ask for your own domain too.
    try { for (const k of await dataforseo.ranked(own, m, { fetch: f, env, limit: Number(flags.limit || 500) })) if (!ownPos.has(k.query) && k.position != null) ownPos.set(k.query, k.position); }
    catch (e) { notes.push(`dataforseo ${own}: ${e.message}`); }
  } else {
    method = "the live results of your tracked queries only (`rank --serp`); add DataForSEO for every query your competitors rank for";
    const serps = rank.live?.perQuery || [];
    if (!serps.length) notes.push("No live check saved: run `rank --serp` with a SERP provider key, or add DataForSEO.");
    for (const d of comp.domains) theirs[d] = [];
    for (const r of serps) for (const x of r.results || []) if (theirs[x.domain]) theirs[x.domain].push({ query: r.query, position: x.position, url: x.url });
    // On the tracked set the live check is a fairer "you" than the Search Console average: same moment, same place.
    for (const r of serps) if (r.livePosition != null) ownPos.set(r.query, r.livePosition); else if (!r.error && !ownPos.has(r.query)) ownPos.set(r.query, null);
  }
  const gap = keywordGap(ownPos, theirs);
  const topics = gapTopics([...gap.missing, ...gap.weak]);
  const pages = winningPages([...gap.missing, ...gap.weak]);
  const strong = strengths(ownPos, theirs);
  writeJson(`${s}/gap.json`, { generatedAt: new Date().toISOString(), market: m, competitors: comp, method, gap, topics, pages: pages.slice(0, 50), strengths: strong.slice(0, 100), notes });
  const md = gapMarkdown({ siteName: site.name, comp, gap, topics, pages, strong, method, notes });
  writeText(`${s}/gap.md`, md);
  console.log(md);
}
