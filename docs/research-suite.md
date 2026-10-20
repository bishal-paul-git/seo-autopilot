# Research suite: keyword, rank, gap, content, AI visibility and authority

The research tools that paid SEO suites sell, built into seo-autopilot and run on data you own or pay for directly. Search Console alone gets you a long way, at no cost. Each key you add switches on more. Nothing here needs the maintainers' keys or a subscription to a suite.

Every report says where each number came from. Search Console and Bing numbers are measured. Volumes, difficulty and authority from providers are estimates and are labelled as such. Nothing is made up to fill a gap: "no data" is a valid answer.

| Job | What it does | Works with | Adds when you set |
|---|---|---|---|
| `keywords [seeds...]` | Keyword explorer: topics (parent topic plus related queries), intent, demand, difficulty, the page that owns each topic, gaps no page owns, and questions people ask | Search Console rows (from `daily`) | `BING_WEBMASTER_API_KEY` (related queries with Bing impressions, free), DataForSEO (volume, CPC, difficulty), `--serp N` with a SERP key (topics grouped by shared results, difficulty from the authority of the top 10), `--suggest` (autocomplete phrasings) |
| `rank [--serp]` | Rank tracker: daily positions of your tracked queries, this week vs last week vs four weeks ago, movers, dropped queries, a visibility index and position buckets. History is kept beyond Search Console's 16 months | Search Console (free), runs daily | `--serp` with a SERP key: search features on each results page and who holds them, competitors, share of voice by domain |
| `gap` | Competitor and keyword gap: queries competitors rank top 10 for where you are absent ("missing") or on page two ("weak"), grouped into topics; the competitor pages behind most of them; queries only you hold | Your tracked queries' live results (`rank --serp`) | DataForSEO: every query each competitor ranks for |
| `optimize --query ... --url/--file ...` | Content optimiser: scores a page or draft against the top-ranking pages. Covers terms most of them use (with a usage range scaled to your length), sections and questions several of them share, length, readability, and the query in title, H1, description and opening | `--compare url1,url2,...` | A SERP key finds the top pages for you. robots.txt is respected |
| `ai-visibility [--runs 2]` | AI visibility: asks AI answer engines your real customer questions with live web search on, several times each. Records whether they mention you (names and aliases), cite your site, and who they cite instead. History is kept per question set | At least one of `PERPLEXITY_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | More engines and more runs |
| `authority` | Backlink and authority profile: referring domains from every source, authority tiers, new and lost since the last run, you vs competitors, and the link intersect (sites linking to several competitors but not to you) | Your Search Console links export (via `inbound`) | DataForSEO (referring domains for you and competitors), `OPENPAGERANK_API_KEY` (authority 0 to 10 from the open Common Crawl graph, free) |
| `forecast` (Python) | Is traffic normal? A Holt-Winters baseline (level, trend, weekly pattern) fitted on your own history says whether the last 28 days of clicks and impressions, and which pages, fell outside their normal range | About 12 weeks of daily history; Python 3.10+, no packages | - |

The agents use these reports:
- **SERP analyst:** `rank`, `forecast`, `gap`.
- **Topic mapper:** `keywords`.
- **Competitor analyst:** `gap`, `optimize`.
- **AI visibility tracker and AI search agent:** `ai-visibility`.
- **Link builder and backlink auditor:** `authority`.
- **Drafter and refresher:** `optimize`.

`team` recommends the right agent when a report shows something worth acting on.

## Site intelligence (free or nearly free)
| Job | What it does | Needs |
|---|---|---|
| `linkgraph` | Internal link graph. Internal PageRank per page (how your own links spread weight), click depth from the home page, orphan pages, and links that leak weight to redirects, errors or noindex pages. Also lists the pages that earn Search Console demand but get little internal weight, each with the strong, related pages that should link to them | the saved audit and Search Console rows; fetches nothing |
| `vitals` | Real-user Core Web Vitals from the Chrome UX Report (what Chrome users actually experienced) for the whole site and your top pages: current 28 days, the 25-period history, and regressions | a free Google API key with the Chrome UX Report API enabled (`CRUX_API_KEY`) |
| `changes` | Page change monitor: what changed since last week on your key pages (an accidental noindex, canonical or status change) and on competitors' winning pages (titles, headings, structured data, rewrites) | nothing; pages from `watch-pages.json`, or your top pages plus the gap report's competitor pages |
| `schema` | Structured data. Checks existing JSON-LD against required fields and against what the page visibly shows (prices, ratings or FAQ answers only in the markup are a spam-policy risk). Drafts the missing Organization, WebSite, Article, breadcrumb and FAQ markup from facts on the page, with `<fill: ...>` where a person must supply something | nothing |
| `entity` | Entity check: whether Google's Knowledge Graph and Wikidata hold an entity whose official website is this site, look-alikes with the same name, and missing sameAs links | nothing for Wikidata; `GOOGLE_KG_API_KEY` (free) for the Knowledge Graph |

Use any of this from Claude or another AI assistant with the [MCP server](mcp.md) (`seo-autopilot mcp`).

## Schedules
- **Daily:** `rank` (Search Console only, free) and `linkgraph` (after the audit).
- **Weekly, always free:** `schema`, `changes`, and `vitals` once its key is set.
- **Weekly:**
  - `keywords`, `gap` and `authority` run on whatever keys are set.
  - `rank --serp` runs only when the repository variable `SEO_RANK_LIVE` is `true`, because it spends SERP credits: one search per tracked query, capped by `research.serpLimit`, default 50.
- **Monthly:**
  - `entity`.
  - `forecast` feeds the monthly report.
  - `ai-visibility` runs only when `SEO_AI_VISIBILITY` is `true`. It makes questions × engines × runs paid API calls, capped at 40 questions.
- **On request:** `optimize` and `keywords "<seed>"`.

## Configuration (all optional)
```json
"research": {
  "market": "GB",
  "competitors": ["rival.com", "other.co.uk"],
  "competitorNames": ["Rival Ltd"],
  "aliases": ["Acme", "Acme Plumbing Ltd"],
  "engines": ["perplexity", "openai"],
  "aiRuns": 2,
  "serpLimit": 50
}
```
Tracked queries go in `seo-autopilot/tracked-queries.json`. Leave it empty, or with its template note, to track your top 50 non-brand queries. The questions for AI visibility are the same `questions.json` that `citations` uses.

## Keys
Set each key as a repository secret, or in your shell when running locally. Never paste a key into an issue or a chat.

| Secret | Provider | Used by |
|---|---|---|
| `BING_WEBMASTER_API_KEY` | Bing Webmaster Tools (free; Settings > API access) | keywords |
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | DataForSEO (pay as you go) | keywords, gap, authority, live results |
| `OPENPAGERANK_API_KEY` | Open PageRank (free key) | keywords difficulty, authority |
| `BRAVE_API_KEY` or `SERPAPI_KEY` | Brave Search API or SerpAPI | live results (rank --serp, keywords --serp, optimize) |
| `PERPLEXITY_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | Each AI provider | ai-visibility |
| `CRUX_API_KEY` | Google Cloud API key with the Chrome UX Report API (free) | vitals |
| `GOOGLE_KG_API_KEY` | Google Cloud API key with the Knowledge Graph Search API (free) | entity |

Check each provider's current prices before switching a scheduled step on. The defaults keep paid steps off.

## Compared with paid suites, honestly
- **Where this is as good or better:**
  - Positions come from Search Console, the only first-party source of how Google showed your site, and the history is kept for as long as you run it.
  - Grouping by shared results is the method the big tools use.
  - The content optimiser shows its evidence instead of a black-box grade.
  - The AI visibility tracker asks the engines' own APIs with web search on, and repeats runs to show variance.
  - Everything is a file in your repository, and agents act on it.
- **Where a suite still has more:**
  - Their own web-scale crawls: backlink indexes and keyword databases for queries you have never been shown for.
  - Here those come from DataForSEO and Open PageRank, both third-party estimates.
  - Without a provider key, the gap covers only your tracked queries, and keyword ideas come from your own data, Bing and autocomplete.
- **Not included:** paid-ads intelligence (ad copy and budgets) and social scheduling. Those are different products.

## Status
- **Tested:** all of this is unit and fixture tested with mocked provider responses.
- **Not yet run live:** no call has gone to Bing, DataForSEO, Open PageRank, autocomplete, Brave, SerpAPI, Perplexity, OpenAI, Anthropic or Gemini from this project. The request formats follow each provider's public documentation.
- **Before relying on a provider:** run its job once with a real key and check the report against the provider's own dashboard.
