// Keyword, ranking and authority data sources for the research suite. Bring your own keys; every source is optional and the
// jobs work from Search Console alone. `fetchFn` is injectable so tests never touch the network. Keys go in headers or the
// request only and are never logged or put in errors.
// Request formats follow each provider's public documentation; they have not been exercised against the live services.
//
//   source           env                                   gives
//   bing             BING_WEBMASTER_API_KEY                related queries with Bing impressions (free, official API)
//   dataforseo       DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD keyword ideas with volume, CPC, difficulty; a domain's ranked keywords (paid)
//   openpagerank     OPENPAGERANK_API_KEY                  domain authority 0-10 from the open web graph (free key)
//   suggest          none, opt-in with --suggest           Google autocomplete phrasings (unofficial endpoint; off by default)
import { domainOf } from "./serp.mjs";

const LOCATIONS = { GB: "United Kingdom", US: "United States", CA: "Canada", AU: "Australia", IE: "Ireland", DE: "Germany", FR: "France", ES: "Spain", IT: "Italy", NL: "Netherlands", IN: "India", NZ: "New Zealand", ZA: "South Africa" };
export const market = (m) => String(m || "GB").toUpperCase().replace(/^UK$/, "GB");

async function getJson(fetchFn, name, url, init = {}) {
  let r;
  try { r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(30000) }); } catch (e) { throw new Error(`${name}: request failed (${e.name || "error"})`); }
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}${r.status === 429 ? " (rate limited)" : r.status === 401 || r.status === 403 ? " (key rejected)" : ""}`);
  return r.json();
}

const dfsAuth = (env) => `Basic ${Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString("base64")}`;
async function dfs(f, env, path, task) {
  const j = await getJson(f, "dataforseo", `https://api.dataforseo.com/v3/${path}`, { method: "POST", headers: { Authorization: dfsAuth(env), "Content-Type": "application/json" }, body: JSON.stringify([task]) });
  const t = j.tasks?.[0];
  if (t && t.status_code && t.status_code !== 20000) throw new Error(`dataforseo: task status ${t.status_code}`);
  return t?.result?.[0]?.items || [];
}

export const bing = {
  name: "bing",
  enabled: (env) => Boolean(env.BING_WEBMASTER_API_KEY),
  /** Related queries and their Bing impressions over the last 90 days: [{ query, bingImpressions }]. */
  async related(seed, m, { fetch: f = fetch, env = process.env, today = new Date() } = {}) {
    const end = new Date(today.getTime() - 2 * 864e5).toISOString().slice(0, 10), start = new Date(today.getTime() - 92 * 864e5).toISOString().slice(0, 10);
    const c = market(m).toLowerCase();
    const url = `https://ssl.bing.com/webmaster/api.svc/json/GetRelatedKeywords?${new URLSearchParams({ apikey: env.BING_WEBMASTER_API_KEY, q: seed, country: c, language: `en-${c.toUpperCase()}`, startDate: start, endDate: end })}`;
    const j = await getJson(f, "bing", url);
    return (j.d || []).map((k) => ({ query: String(k.Query || "").toLowerCase(), bingImpressions: Number(k.Impressions ?? k.BroadImpressions ?? 0) })).filter((k) => k.query);
  },
};

export const dataforseo = {
  name: "dataforseo",
  enabled: (env) => Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD),
  /** Keyword ideas for seeds: [{ query, volume, cpc, competition, difficulty, intent, trend }]. Volumes are the provider's estimates. */
  async ideas(seeds, m, { fetch: f = fetch, env = process.env, limit = 300 } = {}) {
    const items = await dfs(f, env, "dataforseo_labs/google/keyword_ideas/live", { keywords: seeds.slice(0, 20), location_name: LOCATIONS[market(m)] || "United Kingdom", language_code: "en", limit });
    return items.map((i) => ({
      query: String(i.keyword || "").toLowerCase(), volume: i.keyword_info?.search_volume ?? null, cpc: i.keyword_info?.cpc ?? null,
      competition: i.keyword_info?.competition ?? null, difficulty: i.keyword_properties?.keyword_difficulty ?? null, intent: i.search_intent_info?.main_intent || null,
      trend: (i.keyword_info?.monthly_searches || []).slice(0, 12).map((x) => x.search_volume ?? 0).reverse(),
    })).filter((k) => k.query);
  },
  /** Keywords a domain ranks for: [{ query, position, url, volume, traffic, intent }]. Traffic is the provider's estimate. */
  async ranked(domain, m, { fetch: f = fetch, env = process.env, limit = 500 } = {}) {
    const items = await dfs(f, env, "dataforseo_labs/google/ranked_keywords/live", { target: domain, location_name: LOCATIONS[market(m)] || "United Kingdom", language_code: "en", limit });
    return items.map((i) => ({
      query: String(i.keyword_data?.keyword || "").toLowerCase(), position: i.ranked_serp_element?.serp_item?.rank_group ?? null, url: i.ranked_serp_element?.serp_item?.url || "",
      volume: i.keyword_data?.keyword_info?.search_volume ?? null, traffic: i.ranked_serp_element?.serp_item?.etv ?? null, intent: i.keyword_data?.search_intent_info?.main_intent || null,
    })).filter((k) => k.query);
  },
  /** Referring domains of a target: [{ domain, backlinks, rank, firstSeen, lost }]. */
  async referringDomains(target, { fetch: f = fetch, env = process.env, limit = 500 } = {}) {
    const items = await dfs(f, env, "backlinks/referring_domains/live", { target, limit, order_by: ["rank,desc"] });
    return items.map((i) => ({ domain: String(i.domain || "").toLowerCase(), backlinks: i.backlinks ?? null, rank: i.rank ?? null, firstSeen: i.first_seen || null, lost: i.lost_date || null })).filter((d) => d.domain);
  },
};

export const openpagerank = {
  name: "openpagerank",
  enabled: (env) => Boolean(env.OPENPAGERANK_API_KEY),
  /** Map of domain -> authority 0 to 10 (decimal). Up to 100 domains per request; unknown domains are left out. */
  async authority(domains, { fetch: f = fetch, env = process.env } = {}) {
    const out = {};
    const list = [...new Set(domains.map((d) => domainOf(d)).filter(Boolean))];
    for (let i = 0; i < list.length; i += 100) {
      const qs = list.slice(i, i + 100).map((d, k) => `domains%5B${k}%5D=${encodeURIComponent(d)}`).join("&");
      const j = await getJson(f, "openpagerank", `https://openpagerank.com/api/v1.0/getPageRank?${qs}`, { headers: { "API-OPR": env.OPENPAGERANK_API_KEY } });
      for (const r of j.response || []) if (r.status_code === 200 && r.page_rank_decimal != null) out[String(r.domain).toLowerCase()] = Number(r.page_rank_decimal);
    }
    return out;
  },
};

// Google's autocomplete endpoint is public but not an official API, and Google's terms restrict automated queries. It is
// therefore off unless the user passes --suggest, capped and spaced out, and used only for wording, never as volume.
export const suggest = {
  name: "suggest",
  async expand(seed, m, { fetch: f = fetch, max = 12, delayMs = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    const gl = market(m) === "GB" ? "uk" : market(m).toLowerCase();
    const prefixes = ["", ...("how what why best which can".split(" ").map((w) => `${w} `))].slice(0, max);
    const out = new Set();
    for (const [i, p] of prefixes.entries()) {
      if (i) await sleep(delayMs);
      const q = p ? `${p}${seed}` : seed;
      try {
        const j = await getJson(f, "suggest", `https://suggestqueries.google.com/complete/search?${new URLSearchParams({ client: "firefox", hl: "en", gl, q })}`);
        for (const s of j?.[1] || []) out.add(String(s).toLowerCase());
      } catch { /* one failed prefix is fine; the rest still count */ }
    }
    return [...out].map((query) => ({ query }));
  },
};

/** Which sources are configured, for the reports' "how this was measured" line. */
export const available = (env = process.env) => ({ bing: bing.enabled(env), dataforseo: dataforseo.enabled(env), openpagerank: openpagerank.enabled(env) });
