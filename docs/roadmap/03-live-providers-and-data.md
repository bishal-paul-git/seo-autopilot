# 03 Live-test and harden the data providers

**Goal:** every external data source works against the real service, is tested, and the docs say which sources were verified.

**Context:** `citations` (`src/jobs/citations.mjs`, `src/lib/serp.mjs`, `src/analysis/citations.mjs`) supports Brave, SerpAPI and DataForSEO but was only tested with mocked responses; SerpAPI AI-overview handling is the least verified. The built-in agent web search is US-only, so UK results and AI answers need a location-aware provider.

**Build**
1. Run each citations provider with real keys (owner supplies them locally, never committed). Save sanitised responses as fixtures, fix format mismatches, add fixture tests, add a `doctor` live check when a key exists.
2. Make market and language flow into every provider call; verify a UK query returns UK results.
3. Rank tracking over time for tracked queries (history file, dashboard chart, feeds `seo-reporter`).
4. Bing Webmaster Tools (index coverage, queries) as an optional source.
5. CrUX and CrUX History field data next to lab data in `speed`.
6. GA4 Data API: read key events and conversions by landing page, flag missing or unstarred events (`generate_lead`, `tool_complete`, ...).
7. Search Console URL Inspection in bulk with quota handling (about 2,000 a day per property).
8. Docs table: provider, what it gives, verified date, limits (only state limits you verified on the provider's own page).

**Done when:** citations verified live with one provider, ranks and field data available, plain-English failure messages (key, quota, location), no keys in logs, tests, docs, CHANGELOG, release.
