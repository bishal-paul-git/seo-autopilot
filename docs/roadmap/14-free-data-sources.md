# Brief 14: More free data (Search Console in full, Keyword Planner, open data)

Owner request (2026-10-23): "I need free APIs, or to build them. Search Console can do more, and can we connect Keyword Planner?"

## Findings
- The GitHub topic `seo-free` (Python) holds five small tools (0 to 20 stars): page analysers and SERP-similarity scripts. None provides data the product lacks; the audit already covers their checks.
- Wizible (wizible.io) is a hosted product built on Search Console data, with about 22 AI agents, an AI visibility monitor and paid plans (third-party listings: Capterra, PeerPush). It is the closest competitor seen so far, and it confirms the "Search Console first, agents on top" approach. Our differences: open source, runs in the user's own GitHub with their keys, and changes go out as checked pull requests.
- Search Console use today: only Search Analytics (web search) and URL Inspection.

## Build, in order (all free, with the user's own accounts)
1. **Search Console in full** (same service account, no new setup):
   - Sitemaps API: submitted sitemaps, errors and warnings, last download;
   - performance by search type: `discover`, `googleNews`, `image`, `video`, `news`;
   - the `searchAppearance` dimension (rich results and similar features);
   - country and device splits;
   - fresh data with `dataState: "all"`, labelled as preliminary.

   New job `gsc-plus`, or extend `daily`/`weekly`, with tests against recorded responses.
2. **Google Keyword Planner** through the Google Ads API (`KeywordPlanIdeaService.GenerateKeywordIdeas`): keyword ideas, monthly searches, competition and bid ranges for the user's market.
   - Needs the user's own Google Ads manager account, a developer token (Basic access is applied for in the API Center; new tokens work only with test accounts until approved), and OAuth with the `adwords` scope.
   - Free to call, but Google may report broad volume ranges for accounts with little ad spend. Label the figures as Google's estimates, and say when they are ranges.
   - Wire into `keywords` as a demand source, ranked above third-party estimates.
3. **Open data, no key:**
   - Wikipedia pageviews (Wikimedia REST API): topic demand trends;
   - Stack Exchange API: real questions for question mining;
   - Common Crawl (index and web graph): free backlink discovery for any domain, a large-data job that suits the Python engine.
4. **Free-quota APIs, user's key:**
   - YouTube Data API: video results for video-intent queries;
   - Google Cloud Natural Language: entity extraction for content gaps (free tier, then paid; opt-in).

## Status
- Step 1 is done (Unreleased): the `gsc` job. Next: Keyword Planner (the owner applies for a Google Ads developer token meanwhile).

## Not doing
- Scraping Google Trends or Google results without an API: against Google's terms. The opt-in autocomplete source stays capped as it is (D18).
- Third-party "free SEO APIs" with unclear data origin or terms.

## Acceptance
Each source is tested with recorded responses, then run once live with the owner's keys before any claim that it works; the evidence goes in STATUS.
