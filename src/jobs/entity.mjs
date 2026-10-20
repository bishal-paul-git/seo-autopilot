// Entity check: looks the business up in Google's Knowledge Graph (free GOOGLE_KG_API_KEY, optional) and Wikidata (no key),
// confirms which result is this business by its official website, and compares with the sameAs links the site declares.
//   npx seo-autopilot run entity [--name "Business name"]
// Name: --name, else the site name in the config. sameAs: research.sameAs in the config plus the home page's markup.
// Writes entity.json and entity.md. Changes nothing; creating or editing a Wikidata item is a person's decision.
import { readJson, writeJson, writeText } from "../core/util.mjs";
import { politeFetch } from "./optimize.mjs";
import { jsonldNodes } from "../analysis/schema.mjs";
import { parseKg, parseWikidata, assess, entityMarkdown } from "../analysis/entity.mjs";

export const description = "Entity check: Google Knowledge Graph and Wikidata, confirmed by official website, against your sameAs links";

const UA = { "user-agent": "seo-autopilot-entity/1.0 (+https://github.com/bishal-paul-git/seo-autopilot)", accept: "application/json" };

async function getJson(f, url) {
  const r = await f(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 403 ? " (key rejected or API not enabled)" : ""}`);
  return r.json();
}

export async function run({ site, flags = {} }, deps = {}) {
  const env = deps.env || process.env, f = deps.fetch || globalThis.fetch;
  const name = String(flags.name || site.name || "").trim();
  if (!name) { console.log("entity: give --name \"Business name\" or set the site name in the config."); return; }
  const notes = [];
  let kg = [], kgChecked = false;
  if (env.GOOGLE_KG_API_KEY) {
    try { kg = parseKg(await getJson(f, `https://kgsearch.googleapis.com/v1/entities:search?${new URLSearchParams({ query: name, key: env.GOOGLE_KG_API_KEY, limit: "10" })}`), site.url); kgChecked = true; }
    catch (e) { notes.push(`Knowledge Graph: ${e.message}`); }
  } else notes.push("Google Knowledge Graph not checked: set GOOGLE_KG_API_KEY (free; enable the Knowledge Graph Search API).");
  let wikidata = [];
  try {
    const search = await getJson(f, `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: "wbsearchentities", search: name, language: "en", type: "item", limit: "10", format: "json" })}`);
    const ids = (search.search || []).map((x) => x.id).slice(0, 10);
    const entities = ids.length ? await getJson(f, `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: "wbgetentities", ids: ids.join("|"), props: "claims|sitelinks", format: "json" })}`) : {};
    wikidata = parseWikidata(search, entities, site.url);
  } catch (e) { notes.push(`Wikidata: ${e.message}`); }
  // sameAs the site already declares: config plus the home page's own markup.
  const sameAs = [...(site.research?.sameAs || [])];
  const home = await politeFetch(site.url, f);
  if (home.html) for (const n of jsonldNodes(home.html).nodes) sameAs.push(...[].concat(n.sameAs || []));
  const r = assess({ name, siteUrl: site.url, kg, wikidata, sameAs, kgChecked });
  writeJson(`${site.paths.state}/entity.json`, { generatedAt: new Date().toISOString(), notes, ...r, candidates: { knowledgeGraph: kg.slice(0, 5), wikidata: wikidata.slice(0, 5) } });
  const md = entityMarkdown(r, site.name) + (notes.length ? `\n## Notes\n${notes.map((n) => `- ${n}`).join("\n")}\n` : "");
  writeText(`${site.paths.state}/entity.md`, md);
  console.log(md);
}
