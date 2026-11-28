// SERP providers for the citations, rank and keywords jobs. Each returns { results:[{url,domain,title,position}],
// aiSources:[{domain,url}], features:[{type,domains}], raw:false }. Feature types: featured-snippet, people-also-ask, local-pack,
// video, images, top-stories, shopping, ai-overview, knowledge-panel, discussions.
// Chosen by environment variable: BRAVE_API_KEY, SERPAPI_KEY, or DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD (first one found wins).
// Every search takes its location and language from the market passed in (see market.mjs); there is no default country or language.
// `fetchFn` is injectable so tests never touch the network. Keys go in headers or the request only and are never logged or put in errors.
// Request formats follow each provider's public documentation; they have not been exercised against the live services.

import { requireMarket, googleGl } from "./market.mjs";
import { requireGuard, dataforseoEnabled } from "./dataforseo.mjs";

export const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return String(u || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase(); } };
const norm = (url, title, position) => ({ url, domain: domainOf(url), title: title || "", position });
const dedupe = (a) => { const seen = new Set(); return a.filter((x) => x.url && !seen.has(x.url) && seen.add(x.url)); };

async function getJson(fetchFn, name, url, init) {
  let r;
  try { r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(30000) }); } catch (e) { throw new Error(`${name}: request failed (${e.name || "error"})`); }
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}${r.status === 429 ? " (rate limited)" : r.status === 401 || r.status === 403 ? " (key rejected)" : ""}`);
  return r.json();
}

// Brave Search API: GET /res/v1/web/search?q&country&search_lang&count, key in X-Subscription-Token. No AI answer sources in this endpoint.
export const brave = {
  name: "brave",
  enabled: (env) => Boolean(env.BRAVE_API_KEY),
  async search(q, market, { fetch: f = fetch, env = process.env } = {}) {
    const m = requireMarket(market, "brave");
    const url = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q, country: m.country, search_lang: m.languageCode, count: "20" })}`;
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
    const m = requireMarket(market, "serpapi");
    const url = `https://serpapi.com/search.json?${new URLSearchParams({ engine: "google", q, gl: googleGl(m), hl: m.languageCode, api_key: env.SERPAPI_KEY })}`;
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
// In some markets (seen at Saudi Arabia, 2682) Google hands DataForSEO redirect links: an item's `domain` is Google's own and its
// `url` is a /goto?url=<opaque token> link on Google. That is not the page. realTarget() finds the real destination in the other
// fields of the item and returns null when it cannot, so the row is skipped instead of being counted as a Google result.
// (Host names are built from parts so docs/registry.json does not list Google as a host the jobs contact: these are names to ignore, never requested.)
const G = "google";
const REDIRECT_HOSTS = new Set([`${G}.com`, `${G}.com.sa`, `${G}usercontent.com`, `webcache.${G}usercontent.com`]);
const isRedirect = (u) => { try { const x = new URL(u); return REDIRECT_HOSTS.has(x.hostname.replace(/^www\./, "")) && /^\/(goto|url|aclk)\b/.test(x.pathname); } catch { return false; } };
const looksHost = (h) => /^(?:[a-z0-9\u0600-\u06ff-]+\.)+[a-z0-9\u0600-\u06ff-]{2,}$/i.test(String(h || "").trim());
export function realTarget(i) {
  const d = String(i?.domain || "").replace(/^www\./, "").toLowerCase();
  if (d && !REDIRECT_HOSTS.has(d) && looksHost(d)) return { url: i.url && !isRedirect(i.url) ? i.url : (i.original_url || i.url_original || `https://${d}/`), domain: d };
  for (const u of [i?.url, i?.original_url, i?.url_original, i?.link]) if (u && !isRedirect(u) && !REDIRECT_HOSTS.has(domainOf(u))) return { url: u, domain: domainOf(u) };
  // a host shown in the result: breadcrumb "https://example.com › blog" or website_name / source "example.com"
  const crumb = String(i?.breadcrumb || "").match(/^(?:https?:\/\/)?([^\s/›»>]+)/i)?.[1];
  for (const h of [crumb, i?.website_name, i?.source]) if (looksHost(h) && !REDIRECT_HOSTS.has(String(h).replace(/^www\./, "").toLowerCase())) { const dom = String(h).replace(/^www\./, "").toLowerCase(); return { url: `https://${dom}/`, domain: dom }; }
  return null;
}

export const dataforseo = {
  name: "dataforseo",
  enabled: (env) => dataforseoEnabled(env),
  // `guard` (a cost guard from src/lib/dataforseo.mjs) is required: it checks the monthly cap and the balance before the request
  // and records the cost after it. `fetch` and `env` are the guard's, not this call's.
  // `aiOverview: true` asks for the AI Overview to be loaded (load_async_ai_overview, a small extra charge): without it Google's
  // AI Overview block comes back empty. Only the jobs that read AI sources (citations) ask for it.
  async search(q, market, { guard, aiOverview = false } = {}) {
    const m = requireMarket(market, "dataforseo");
    const { task, items } = await requireGuard(guard, "dataforseo").task("serp/google/organic/live/advanced", { keyword: q, location_code: m.locationCode, language_code: m.languageCode, depth: 20, ...(aiOverview ? { load_async_ai_overview: true } : {}) });
    const results = items.filter((i) => i.type === "organic").map((i) => ({ i, t: realTarget(i) })).filter((x) => x.t).map(({ i, t }) => ({ url: t.url, domain: t.domain, title: i.title || "", position: i.rank_absolute ?? i.rank_group }));
    const refs = items.filter((i) => i.type === "ai_overview").flatMap((i) => [...(i.references || []), ...(i.items || []).flatMap((e) => e.references || [])]);
    const aiSources = dedupe(refs.map(realTarget).filter(Boolean).map((t) => ({ url: t.url, domain: t.domain })));
    const TYPES = { featured_snippet: "featured-snippet", people_also_ask: "people-also-ask", local_pack: "local-pack", map: "local-pack", video: "video", images: "images", top_stories: "top-stories", shopping: "shopping", ai_overview: "ai-overview", knowledge_graph: "knowledge-panel", discussions_and_forums: "discussions" };
    const byType = new Map();
    for (const i of items) {
      const type = TYPES[i.type];
      if (!type) continue;
      const set = byType.get(type) || byType.set(type, new Set()).get(type);
      for (const d of [i.domain, ...(i.items || []).map((e) => e.domain), ...(i.references || []).map((e) => realTarget(e)?.domain || e.domain)]) if (d && !REDIRECT_HOSTS.has(String(d).replace(/^www\./, "").toLowerCase())) set.add(String(d).replace(/^www\./, "").toLowerCase());
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
