// SERP providers for the citations, rank and keywords jobs. Each returns { results:[{url,domain,title,position}],
// aiSources:[{domain,url}], features:[{type,domains}], raw:false }. Feature types: featured-snippet, people-also-ask, local-pack,
// video, images, top-stories, shopping, ai-overview, knowledge-panel, discussions.
// Chosen by environment variable: BRAVE_API_KEY, SERPAPI_KEY, or DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD (first one found wins).
// `fetchFn` is injectable so tests never touch the network. Keys go in headers or the request only and are never logged or put in errors.
// Request formats follow each provider's public documentation; they have not been exercised against the live services.

export const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return String(u || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase(); } };
const country = (m) => String(m || "GB").toUpperCase().replace(/^UK$/, "GB");
const LOCATIONS = { GB: "United Kingdom", US: "United States", CA: "Canada", AU: "Australia", IE: "Ireland", DE: "Germany", FR: "France", ES: "Spain", IT: "Italy", NL: "Netherlands", IN: "India" };
const norm = (url, title, position) => ({ url, domain: domainOf(url), title: title || "", position });
const dedupe = (a) => { const seen = new Set(); return a.filter((x) => x.url && !seen.has(x.url) && seen.add(x.url)); };

async function getJson(fetchFn, name, url, init) {
  let r;
  try { r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(30000) }); } catch (e) { throw new Error(`${name}: request failed (${e.name || "error"})`); }
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}${r.status === 429 ? " (rate limited)" : r.status === 401 || r.status === 403 ? " (key rejected)" : ""}`);
  return r.json();
}

// Brave Search API: GET /res/v1/web/search?q&country&count, key in X-Subscription-Token. No AI answer sources in this endpoint.
export const brave = {
  name: "brave",
  enabled: (env) => Boolean(env.BRAVE_API_KEY),
  async search(q, market, { fetch: f = fetch, env = process.env } = {}) {
    const url = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q, country: country(market), count: "20" })}`;
    const j = await getJson(f, "brave", url, { headers: { Accept: "application/json", "X-Subscription-Token": env.BRAVE_API_KEY } });
    const results = (j.web?.results || []).map((r, i) => norm(r.url, r.title, i + 1));
    const features = [["faq", "people-also-ask"], ["videos", "video"], ["news", "top-stories"], ["locations", "local-pack"], ["discussions", "discussions"]]
      .filter(([k]) => (j[k]?.results || []).length).map(([k, type]) => ({ type, domains: [...new Set(j[k].results.map((r) => domainOf(r.url || r.meta_url?.hostname || "")).filter(Boolean))] }));
    return { results: dedupe(results), aiSources: [], features, raw: false };
  },
};

// SerpAPI: GET /search?engine=google&q&gl&hl&api_key. organic_results[].link/position. AI Overview sources come from
// ai_overview.references, or (when only a page_token is returned) from a second engine=google_ai_overview request.
export const serpapi = {
  name: "serpapi",
  enabled: (env) => Boolean(env.SERPAPI_KEY),
  async search(q, market, { fetch: f = fetch, env = process.env } = {}) {
    const c = country(market);
    const url = `https://serpapi.com/search.json?${new URLSearchParams({ engine: "google", q, gl: c === "GB" ? "uk" : c.toLowerCase(), hl: "en", api_key: env.SERPAPI_KEY })}`;
    const j = await getJson(f, "serpapi", url, {});
    const results = (j.organic_results || []).map((r, i) => norm(r.link, r.title, r.position ?? i + 1));
    let refs = j.ai_overview?.references;
    if (!refs?.length && j.ai_overview?.page_token) {
      try {
        const k = await getJson(f, "serpapi", `https://serpapi.com/search.json?${new URLSearchParams({ engine: "google_ai_overview", page_token: j.ai_overview.page_token, api_key: env.SERPAPI_KEY })}`, {});
        refs = k.ai_overview?.references || k.references;
      } catch { /* the AI Overview token expires within a minute; organic results are still useful */ }
    }
    const aiSources = dedupe((refs || []).map((r) => ({ url: r.link || r.url, domain: domainOf(r.link || r.url) })));
    const has = (x) => (Array.isArray(x) ? x.length : Boolean(x));
    const doms = (list, key = "link") => [...new Set((Array.isArray(list) ? list : [list]).map((r) => domainOf(r?.[key] || r?.link || "")).filter(Boolean))];
    const features = [
      has(j.answer_box) && { type: "featured-snippet", domains: doms(j.answer_box) },
      has(j.related_questions) && { type: "people-also-ask", domains: doms(j.related_questions) },
      has(j.local_results?.places || j.local_results) && { type: "local-pack", domains: [] },
      has(j.inline_videos) && { type: "video", domains: doms(j.inline_videos) },
      has(j.inline_images) && { type: "images", domains: [] },
      has(j.top_stories) && { type: "top-stories", domains: doms(j.top_stories) },
      has(j.shopping_results || j.inline_shopping) && { type: "shopping", domains: [] },
      (has(j.ai_overview) || aiSources.length) && { type: "ai-overview", domains: [...new Set(aiSources.map((s) => s.domain))] },
    ].filter(Boolean);
    return { results: dedupe(results), aiSources, features, raw: false };
  },
};

// DataForSEO: POST /v3/serp/google/organic/live/advanced with Basic auth and a one-task array. items[] of type organic
// (url, domain, title, rank_absolute) and ai_overview (references[].url/domain).
export const dataforseo = {
  name: "dataforseo",
  enabled: (env) => Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD),
  async search(q, market, { fetch: f = fetch, env = process.env } = {}) {
    const auth = Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString("base64");
    const body = [{ keyword: q, location_name: LOCATIONS[country(market)] || "United Kingdom", language_code: "en", depth: 20 }];
    const j = await getJson(f, "dataforseo", "https://api.dataforseo.com/v3/serp/google/organic/live/advanced", { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const task = j.tasks?.[0];
    if (task && task.status_code && task.status_code !== 20000) throw new Error(`dataforseo: task status ${task.status_code}`);
    const items = task?.result?.[0]?.items || [];
    const results = items.filter((i) => i.type === "organic").map((i) => ({ url: i.url, domain: (i.domain || domainOf(i.url)).replace(/^www\./, "").toLowerCase(), title: i.title || "", position: i.rank_absolute ?? i.rank_group }));
    const refs = items.filter((i) => i.type === "ai_overview").flatMap((i) => [...(i.references || []), ...(i.items || []).flatMap((e) => e.references || [])]);
    const aiSources = dedupe(refs.map((r) => ({ url: r.url, domain: (r.domain || domainOf(r.url)).replace(/^www\./, "").toLowerCase() })));
    const TYPES = { featured_snippet: "featured-snippet", people_also_ask: "people-also-ask", local_pack: "local-pack", map: "local-pack", video: "video", images: "images", top_stories: "top-stories", shopping: "shopping", ai_overview: "ai-overview", knowledge_graph: "knowledge-panel", discussions_and_forums: "discussions" };
    const byType = new Map();
    for (const i of items) {
      const type = TYPES[i.type];
      if (!type) continue;
      const set = byType.get(type) || byType.set(type, new Set()).get(type);
      for (const d of [i.domain, ...(i.items || []).map((e) => e.domain), ...(i.references || []).map((e) => e.domain)]) if (d) set.add(String(d).replace(/^www\./, "").toLowerCase());
    }
    const features = [...byType].map(([type, set]) => ({ type, domains: [...set] }));
    return { results: dedupe(results), aiSources, features, raw: false };
  },
};

export const PROVIDERS = [brave, serpapi, dataforseo];
export const pickProvider = (env = process.env) => PROVIDERS.find((p) => p.enabled(env)) || null;

export const SETUP_HELP = `citations: no search provider key is configured, so nothing was checked. This is not an error. Turn it on with ONE of these:

  1. Brave Search API (organic results only, no AI answers). Sign up at https://brave.com/search/api/ (check the current plans; there has been a small free allowance).
     Env var: BRAVE_API_KEY.  Repository secret name: BRAVE_API_KEY
  2. SerpAPI (organic results and Google AI Overview sources). Sign up at https://serpapi.com/ (has a small free plan; check current limits).
     Env var: SERPAPI_KEY.  Repository secret name: SERPAPI_KEY
  3. DataForSEO (organic results and AI Overview references, pay as you go, a small deposit is needed). Sign up at https://dataforseo.com/
     Env vars: DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD.  Repository secret names: DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD

Locally: set the variable in your shell, then run "npx seo-autopilot run citations". On GitHub: Settings > Secrets and variables > Actions > New repository secret, using the secret name above; the weekly workflow already passes all three.
Then list your questions in seo-autopilot/questions.json (the init template has examples to replace).`;
