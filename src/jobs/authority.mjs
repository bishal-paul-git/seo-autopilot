// Backlink and authority profile: referring domains (your Search Console export via `inbound`, plus DataForSEO when set),
// their authority (Open PageRank), new and lost since the last run, you vs competitors, and the link intersect.
//   npx seo-autopilot run authority [--competitors a.com,b.com]
// Keys (optional): DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD (referring domains for you and competitors), OPENPAGERANK_API_KEY.
// Competitors: --competitors, else research.competitors, else from the rank tracker's live check.
// Writes authority.json, authority.md and authority-snapshot.json in the state folder. Never contacts anyone.
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { dataforseo, openpagerank } from "../lib/research-sources.mjs";
import { competitors as pickCompetitors } from "../analysis/gap.mjs";
import { mergeDomains, profile, intersect, compare, authorityMarkdown } from "../analysis/authority.mjs";

export const description = "Backlink and authority profile: referring domains with authority, new and lost, you vs competitors, link intersect";

export async function run({ site, flags = {} }, deps = {}) {
  const env = deps.env || process.env, f = deps.fetch || globalThis.fetch, s = site.paths.state;
  const own = new URL(site.url).hostname.replace(/^www\./, "");
  const notes = [], sources = {};
  const inbound = readJson(`${s}/inbound.json`, null);
  if (inbound?.domains?.length) sources["search-console export"] = inbound.domains;
  else notes.push("No Search Console links export read yet: save one in seo-autopilot/inbound-links and run `inbound`.");
  const configured = flags.competitors ? String(flags.competitors).split(",") : site.research?.competitors || [];
  const comp = pickCompetitors({ configured, shareOfVoice: readJson(`${s}/rank.json`, {}).live?.shareOfVoice || [], own });
  const theirs = {};
  if (dataforseo.enabled(env)) {
    try { sources.dataforseo = await dataforseo.referringDomains(own, { fetch: f, env }); } catch (e) { notes.push(`dataforseo ${own}: ${e.message}`); }
    for (const d of comp.domains) { try { theirs[d] = await dataforseo.referringDomains(d, { fetch: f, env }); } catch (e) { notes.push(`dataforseo ${d}: ${e.message}`); } }
  } else notes.push("Competitor links and the link intersect need DataForSEO (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD).");
  const domains = mergeDomains(sources);
  if (!domains.length && !Object.keys(theirs).length) { console.log(`authority: no link data yet.\n${notes.map((n) => `- ${n}`).join("\n")}`); return; }

  let authority = {};
  if (openpagerank.enabled(env)) {
    const ix0 = intersect(domains.map((d) => d.domain), theirs, { exclude: [own] });
    const ask = [own, ...comp.domains, ...domains.map((d) => d.domain), ...ix0.slice(0, 300).map((x) => x.domain)].slice(0, 1500);
    try { authority = await openpagerank.authority(ask, { fetch: f, env }); } catch (e) { notes.push(`openpagerank: ${e.message}`); }
  } else notes.push("Authority scores need OPENPAGERANK_API_KEY (free at openpagerank.com).");

  const previous = readJson(`${s}/authority-snapshot.json`, null);
  const p = profile(domains, { authority, previous });
  const ix = intersect(domains.map((d) => d.domain), theirs, { authority, exclude: [own] });
  const cmp = compare(own, p.referringDomains, theirs, authority);
  const sourcesUsed = [...Object.keys(sources), ...(Object.keys(authority).length ? ["open pagerank"] : [])];
  writeJson(`${s}/authority.json`, { generatedAt: new Date().toISOString(), sourcesUsed, competitors: comp, profile: p, compare: cmp, intersect: ix.slice(0, 200), notes });
  writeJson(`${s}/authority-snapshot.json`, { date: today(), domains: p.domains });
  const md = authorityMarkdown({ siteName: site.name, p, cmp, ix, sourcesUsed, notes });
  writeText(`${s}/authority.md`, md);
  console.log(md);
}
