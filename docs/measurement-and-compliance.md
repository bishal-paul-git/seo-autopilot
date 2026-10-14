# Measurement and compliance

Four weekly jobs that keep the site safe to publish on and honest about how it is measured. All are read-only: they write reports into the state folder and change nothing on your site. The weekly workflow runs them before `team`, so their findings reach the agent plan.

| Job | Question it answers | Reports | Agent it brings in |
|---|---|---|---|
| `consent` | Does tracking run without a consent tool? | `consent.json`, `consent.md` | `seo-compliance-auditor` (a high finding is a blocker) |
| `ymyl` | Do health, legal, tax and money pages name an author and a reviewer? | `ymyl.json`, `ymyl.md` | `seo-compliance-auditor` |
| `pace` | Are pages going live faster than search engines will trust? | `pace.json`, `pace.md` | `seo-strategist` |
| `citations` | Is the site cited in search results and AI answers for my questions? | `citations.json`, `citations.md` | `seo-ai-search-agent` |

## consent

`npx seo-autopilot run consent` fetches the home page and the privacy pages it finds (`/privacy`, `/privacy-policy`, `/cookies`, `/cookie-policy`, `/legal/privacy`).

| Finding | Severity | Meaning |
|---|---|---|
| `tracking-without-consent-tool` | high | Google Analytics, Tag Manager, Clarity, Meta Pixel, Hotjar and similar load, and the page has no known consent platform (Cookiebot, OneTrust, CookieYes, Osano, Termly, iubenda and others) and no Consent Mode default of denied. |
| `privacy-claims-consent-but-no-mechanism` | high | The policy says "your consent" or "opt-in", but the site never asks. |
| `consent-mode-default-not-denied` | medium | `gtag('consent','default',...)` grants storage before the visitor chooses. |
| `trackers-injected-at-runtime-unknown` | info | Nothing visible in the HTML. This does not prove nothing runs: tags added by JavaScript or a tag manager are invisible to a static check. |

Cookieless analytics (Plausible, Fathom) do not trigger the first finding. The report also explains the gap between real and measured traffic: where visitors can refuse analytics, your analytics undercount. Report both numbers; do not hide the gap.

## ymyl (sensitive-topic review gate)

Pages that give health, medical, legal, data protection, tax, finance, safety or children's advice should say who wrote them and who checked them. `npx seo-autopilot run ymyl` matches page title, URL and indexed text against keyword lists and reports, per page, the topic, the missing fields and a status: `ok`, `needs reviewer` or `held`.

It needs page fields, so use content type `json` or `markdown`; with a sitemap it lists topics but marks pages `unchecked`. Put the fields in each page:

```json
{ "slug": "gdpr-basics", "title": "GDPR basics", "author": "Ann Smith", "reviewedBy": "Dr Lee, solicitor", "hold": false }
```

Markdown front matter works the same (`author: Ann Smith`). `author` may also be `{ "name": "Ann Smith" }`. A page with `"hold": true` is reported as `held`; hold it until a reviewer signs off.

Configure in `seo-autopilot.config.json`, per site:

```json
"review": { "topics": { "weapons": ["firearm\\w*"], "children": [] }, "requireFields": ["author", "reviewedBy"] }
```

`topics` adds to or replaces the defaults by name (an empty list switches a topic off); keywords are regular-expression text matched case-insensitively at a word start. Keyword matching is blunt, so expect some false alarms and tune the lists.

## pace (content-pace governor)

Publishing many pages at once looks like scaled content. `npx seo-autopilot run pace [--json]` counts releases per day and per rolling 7 days from `publishAt`, flags days and weeks over `limits.pagesPerDay` (default 2), `limits.pagesPerWeek` (default 8) and `limits.perTemplatePerDay` (off by default; uses a page's `template` or `type` field), and writes a recommended schedule.

The recommendation keeps order, never moves a page earlier and never before today, and fills the earliest free slots. If at least 3 of the pages published in the last 30 days, and 40 percent or more of those checked, are "Crawled - currently not indexed" or "Discovered" in `inspect-state.json`, the recommended pace is halved until indexing catches up.

The job never edits content. To apply it, change each listed page's `publishAt` (or front-matter date) to the `To` date and commit. Pages held with `hold: true` are ignored.

## citations (AI answer and SERP citation tracker)

`npx seo-autopilot run citations` asks a search provider your real customer questions and records whether your domain is an organic result or a cited source in an AI answer, which other domains are cited most, and which questions you are absent from. Each run is appended to `citations.json` (last 26 kept), and `citations.md` shows this run's table, the monthly trend of the share of questions where you appear, the top cited domains and the absent questions.

1. Replace the example list in `seo-autopilot/questions.json` (strings, or `{ "q": "...", "market": "GB" }`). While the "REPLACE THESE" note is present the job refuses to spend credits. At most 40 questions run per job, one at a time with a short pause. The default market is `GB`; change it with `citations.market`.
2. Enable one provider (first found wins):

| Provider | Env var and repository secret | Gives |
|---|---|---|
| Brave Search API | `BRAVE_API_KEY` | organic results; no AI answer sources |
| SerpAPI | `SERPAPI_KEY` | organic results and Google AI Overview sources when shown |
| DataForSEO | `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` | organic results and AI Overview references when shown |

Check each provider's current plans and free allowance before relying on one. With no key the job prints these instructions and exits with success. Keys are only sent to the provider and are never logged.

**Untested against the live services.** The request and response handling follows each provider's public documentation and is tested only with mocked responses. The AI Overview parts in particular depend on response shapes the providers may change. Run it once by hand with a key and read `citations.md` before trusting the trend.

A snapshot is one provider, one location, one moment. Treat movement across several runs as the signal, not a single table.
