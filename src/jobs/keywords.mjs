// Keyword explorer: topics, parent topics, intent, demand, difficulty, gaps and questions for seed terms, from the sources you
// have. Search Console alone works (rows saved by the daily job); each key adds a source.
//   npx seo-autopilot run keywords "web hosting" "domain names" [--suggest] [--serp 20]
//   --suggest   also collect Google autocomplete phrasings (unofficial endpoint, capped, off by default)
//   --stackexchange webmasters,money   also mine questions from these Stack Exchange sites (default: research.stackExchangeSites)
//   --no-video   skip YouTube results (on when YOUTUBE_API_KEY is set; at most 5 searches a run)
//   --no-open-data   skip Wikipedia pageviews and Stack Exchange (both free, no key)
//   --serp N    check the live results of the top N keywords with your SERP provider: true topic grouping and difficulty
// Keys (all optional): Google Keyword Planner (GOOGLE_ADS_DEVELOPER_TOKEN + GOOGLE_ADS_CUSTOMER_ID + sign-in, see
// src/lib/google-ads.mjs), BING_WEBMASTER_API_KEY, DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD, OPENPAGERANK_API_KEY, and a SERP
// provider (BRAVE_API_KEY, SERPAPI_KEY or DataForSEO). Writes keywords.json and keywords.md in the state folder.
import { readJson, writeJson, writeText, sleep } from "../core/util.mjs";
import { loadPages } from "../adapters/index.mjs";
import { pickProvider } from "../lib/serp.mjs";
import { bing, dataforseo, openpagerank, suggest } from "../lib/research-sources.mjs";
import { planner } from "../lib/google-ads.mjs";
import { wikipedia, stackexchange } from "../lib/open-data.mjs";
import { youtube } from "../lib/youtube.mjs";
import { explore, keywordsMarkdown, demand, mergeCandidates, interest, communityQuestions, openDataMarkdown, videoCandidates, videoSummary, videoMarkdown } from "../analysis/keywords.mjs";

export const description = "Keyword explorer: topics, intent, demand, difficulty, gaps and questions from Search Console plus any keys you add";

export const marketOf = (site) => site.research?.market || site.citations?.market || "GB";

/** `deps` lets tests inject fetch, env and a zero delay. */
export async function run({ site, flags = {}, positional = [] }, deps = {}) {
  const env = deps.env || process.env, f = deps.fetch || globalThis.fetch, delay = deps.delayMs ?? 1000;
  const s = site.paths.state, m = marketOf(site);
  const seeds = positional.map((x) => String(x).toLowerCase().trim()).filter(Boolean);
  const notes = [];
  const sources = { gsc: readJson(`${s}/gsc-rows.json`, { rows: [] }).rows || [], bing: [], ideas: [], planner: [], suggest: [] };
  if (!sources.gsc.length) notes.push("No Search Console rows saved yet (run the daily job): own demand and positions are missing.");
  const tryIt = async (name, fn, fallback = []) => { try { return await fn(); } catch (e) { notes.push(`${name}: ${e.message}`); return fallback; } };
  for (const seed of seeds.slice(0, 10)) {
    if (bing.enabled(env)) sources.bing.push(...(await tryIt("bing", () => bing.related(seed, m, { fetch: f, env }))));
    if (flags.suggest) sources.suggest.push(...(await tryIt("suggest", () => suggest.expand(seed, m, { fetch: f, delayMs: delay, sleep }))));
  }
  if (seeds.length && planner.enabled(env)) sources.planner = await tryIt("google-ads", () => planner.ideas(seeds, m, { fetch: f, env, token: deps.adsToken }));
  if (seeds.length && dataforseo.enabled(env)) sources.ideas = await tryIt("dataforseo", () => dataforseo.ideas(seeds, m, { fetch: f, env }));
  if (!seeds.length && !sources.gsc.length) { console.log("keywords: give seed terms (run keywords \"your topic\") or run the daily job first."); return; }

  // Live results for the top candidates: the true test of which queries are one topic, and the input to difficulty.
  const serps = {}, serpResults = {};
  const provider = pickProvider(env), want = Number(flags.serp || 0);
  if (want > 0 && !provider) notes.push("--serp needs a SERP provider key (BRAVE_API_KEY, SERPAPI_KEY or DataForSEO); grouped by words instead.");
  if (want > 0 && provider) {
    const brandTerms = site.brandTerms || [];
    const top = mergeCandidates(sources, { seeds, brandTerms, ignore: site.ignoreQueries || [] }).sort((a, b) => demand(b).value - demand(a).value).slice(0, Math.min(want, 100));
    for (const [i, k] of top.entries()) {
      if (i) await sleep(delay);
      try { const r = await provider.search(k.query, m, { fetch: f, env }); serpResults[k.query] = r.results; serps[k.query] = r.results.slice(0, 10).map((x) => x.url); }
      catch (e) { notes.push(`${provider.name} "${k.query}": ${e.message}`); }
    }
  }
  let authority = {};
  const domains = [...new Set(Object.values(serpResults).flatMap((r) => r.slice(0, 10).map((x) => x.domain)))];
  if (domains.length && openpagerank.enabled(env)) authority = await tryIt("openpagerank", () => openpagerank.authority(domains, { fetch: f, env }), {});

  let pages = [];
  try { pages = await loadPages(site); } catch { /* sitemap site without content files: owner pages come from Search Console only */ }
  const r = explore(sources, { seeds, brandTerms: site.brandTerms || [], ignore: site.ignoreQueries || [], serps, serpResults, authority, pages });

  // Open data, no key: interest over time from Wikipedia pageviews, and real questions from Stack Exchange.
  const open = { topics: [], community: [] };
  if (seeds.length && !flags["no-open-data"]) {
    for (const seed of seeds.slice(0, 5)) {
      const article = await tryIt("wikipedia", () => wikipedia.article(seed, m, { fetch: f }), null);
      if (article) open.topics.push({ seed, article, interest: interest(await tryIt("wikipedia", () => wikipedia.pageviews(article.title, article.lang, { fetch: f, today: deps.today }))) });
    }
    const seSites = (typeof flags.stackexchange === "string" ? flags.stackexchange.split(",") : site.research?.stackExchangeSites || []).map((x) => x.trim()).filter(Boolean).slice(0, 5);
    const asked = [];
    for (const se of seSites) for (const seed of seeds.slice(0, 5)) asked.push(...(await tryIt("stackexchange", () => stackexchange.questions(seed, se, { fetch: f, env }))));
    open.community = communityQuestions(asked, pages);
  }
  // Video results for how-to, review and comparison topics (YOUTUBE_API_KEY; 5 searches = 500 of the 10,000 free daily units).
  const video = [], channel = site.research?.youtubeChannel || "";
  if (youtube.enabled(env) && !flags["no-video"]) {
    for (const q of videoCandidates(r.groups, 5)) { const v = await tryIt("youtube", () => youtube.videos(q, m, { fetch: f, env }), null); if (v) video.push(videoSummary(q, v, channel)); }
  }
  writeJson(`${s}/keywords.json`, { generatedAt: new Date().toISOString(), market: m, provider: provider && want ? provider.name : null, notes, ...r, ...open, video });
  const md = keywordsMarkdown(r, site.name) + openDataMarkdown(open) + videoMarkdown(video, channel) + (notes.length ? `\n## Notes\n${notes.map((x) => `- ${x}`).join("\n")}\n` : "");
  writeText(`${s}/keywords.md`, md);
  console.log(md);
}
