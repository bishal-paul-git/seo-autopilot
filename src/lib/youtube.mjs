// YouTube Data API v3 with the user's own key (YOUTUBE_API_KEY, a Google Cloud API key with the YouTube Data API enabled).
// Free daily quota of 10,000 units: a search costs 100 and a statistics lookup 1, so the keywords job caps itself at 5
// searches a run. `fetch` is injectable; the key goes in the query string (Google's documented way) and never into errors.
// Request shapes follow Google's reference; not yet run against the live API.
import { market } from "./research-sources.mjs";
import { decode } from "./open-data.mjs";

const LANG = { DE: "de", AT: "de", FR: "fr", ES: "es", IT: "it", NL: "nl" };

async function call(f, path, params, env) {
  let r;
  try { r = await f(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key: env.YOUTUBE_API_KEY })}`, { signal: AbortSignal.timeout(30000) }); }
  catch (e) { throw new Error(`youtube: request failed (${e.name || "error"})`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const reason = j.error?.errors?.[0]?.reason || "";
    throw new Error(`youtube: ${reason === "quotaExceeded" ? "daily quota used up (resets at midnight Pacific time)" : reason === "keyInvalid" ? "key rejected" : j.error?.message || `HTTP ${r.status}`}`);
  }
  return j;
}

export const youtube = {
  name: "youtube",
  enabled: (env) => Boolean(env.YOUTUBE_API_KEY),
  /** Top video results for a query in the market, with view counts: [{ title, url, channel, published, views }]. */
  async videos(query, m, { fetch: f = fetch, env = process.env, limit = 10 } = {}) {
    const s = await call(f, "search", { part: "snippet", type: "video", q: query, maxResults: String(limit), regionCode: market(m), relevanceLanguage: LANG[market(m)] || "en" }, env);
    const items = (s.items || []).filter((i) => i.id?.videoId);
    if (!items.length) return [];
    const st = await call(f, "videos", { part: "statistics", id: items.map((i) => i.id.videoId).join(",") }, env);
    const views = new Map((st.items || []).map((v) => [v.id, v.statistics?.viewCount == null ? null : Number(v.statistics.viewCount)]));
    return items.map((i) => ({ title: decode(i.snippet?.title), url: `https://www.youtube.com/watch?v=${i.id.videoId}`, channel: decode(i.snippet?.channelTitle), published: (i.snippet?.publishedAt || "").slice(0, 10) || null, views: views.get(i.id.videoId) ?? null }));
  },
};
