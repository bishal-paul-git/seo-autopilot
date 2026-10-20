// Entity check: does the business exist as a clear entity in Google's Knowledge Graph and in Wikidata (which Google and AI
// assistants both draw on), is it the right one (its official website is this site), and do the site's own sameAs links
// point at it. Pure: parse the API responses and compare.

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const sameSite = (u, site) => { const a = host(u), b = host(site); return Boolean(a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`))); };

/** Knowledge Graph Search results: [{ id, name, types, description, url, score, matchesSite }]. */
export function parseKg(j, siteUrl) {
  return (j?.itemListElement || []).map((x) => {
    const r = x.result || {};
    return { id: r["@id"] || "", name: r.name || "", types: [].concat(r["@type"] || []), description: r.description || r.detailedDescription?.articleBody?.slice(0, 200) || "", url: r.url || "", wikipedia: r.detailedDescription?.url || null, score: x.resultScore ?? null, matchesSite: sameSite(r.url, siteUrl) };
  });
}

/** Wikidata search plus entity details: [{ id, label, description, website, matchesSite, wikipedia }]. */
export function parseWikidata(search, entities, siteUrl) {
  return (search?.search || []).map((s) => {
    const e = entities?.entities?.[s.id] || {};
    const sites = (e.claims?.P856 || []).map((c) => c.mainsnak?.datavalue?.value).filter(Boolean);
    const wiki = e.sitelinks?.enwiki?.title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(e.sitelinks.enwiki.title.replace(/ /g, "_"))}` : null;
    return { id: s.id, label: s.label || "", description: s.description || "", website: sites[0] || null, matchesSite: sites.some((u) => sameSite(u, siteUrl)), wikipedia: wiki, url: `https://www.wikidata.org/wiki/${s.id}` };
  });
}

/** Verdict and actions. sameAs: the URLs the site's own Organization markup (or config) declares. */
export function assess({ name, siteUrl, kg = [], wikidata = [], sameAs = [], kgChecked = false }) {
  const kgMatch = kg.find((x) => x.matchesSite) || null, wdMatch = wikidata.find((x) => x.matchesSite) || null;
  const lookalikes = [...kg.filter((x) => !x.matchesSite && x.name.toLowerCase() === name.toLowerCase()).map((x) => `${x.name} (${x.description || x.types.join(", ")}) in Google's Knowledge Graph`), ...wikidata.filter((x) => !x.matchesSite && x.label.toLowerCase() === name.toLowerCase()).map((x) => `${x.label} (${x.description || x.id}) in Wikidata`)];
  const declared = new Set(sameAs.map((u) => String(u).replace(/\/$/, "")));
  const actions = [];
  if (kgChecked && !kgMatch) actions.push("Google's Knowledge Graph has no entity whose website is this site. Make the business unambiguous: consistent name, Organization or LocalBusiness markup with url, logo and sameAs on the home page, a complete Google Business Profile if it serves customers locally, and mentions on reputable sites that link to it.");
  if (!wdMatch) actions.push("Wikidata has no item whose official website is this site. If the business is notable enough under Wikidata's rules, a person can create or correct an item with the official website (P856); never create one just for SEO.");
  if (wdMatch && !declared.has(wdMatch.url)) actions.push(`Add ${wdMatch.url} to the home page's Organization sameAs.`);
  if (wdMatch?.wikipedia && !declared.has(wdMatch.wikipedia)) actions.push(`Add ${wdMatch.wikipedia} to sameAs.`);
  if (lookalikes.length) actions.push(`Other entities share the name (${lookalikes.slice(0, 3).join("; ")}): use the full business name and location consistently so search engines and AI assistants do not confuse them.`);
  return { name, knowledgeGraph: kgChecked ? (kgMatch ? { found: true, ...kgMatch } : { found: false }) : { checked: false }, wikidata: wdMatch ? { found: true, ...wdMatch } : { found: false }, lookalikes, sameAs: [...declared], actions };
}

export function entityMarkdown(r, siteName) {
  const L = [`# ${siteName} entity check: "${r.name}"`, "", "Whether search engines and AI assistants can recognise the business as one clear thing. Found means an entity whose official website is this site.", ""];
  const kg = r.knowledgeGraph;
  L.push(`- Google Knowledge Graph: ${kg.checked === false ? "not checked (set GOOGLE_KG_API_KEY)" : kg.found ? `**found**: ${kg.name} (${kg.types.join(", ")})${kg.description ? `, "${kg.description}"` : ""}` : "**not found**"}`);
  L.push(`- Wikidata: ${r.wikidata.found ? `**found**: ${r.wikidata.label} (${r.wikidata.id})${r.wikidata.description ? `, "${r.wikidata.description}"` : ""}` : "**not found**"}`);
  L.push(`- sameAs declared: ${r.sameAs.length ? r.sameAs.join(", ") : "none"}`);
  L.push("", "## What to do", ...(r.actions.length ? r.actions.map((a) => `- ${a}`) : ["- Nothing: the entity is clear and linked."]));
  return L.join("\n") + "\n";
}
