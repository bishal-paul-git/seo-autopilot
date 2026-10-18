# Jobs and secrets

Run any job with `npx seo-autopilot run <job> [--site id] [--dry]`.

| Job | Default schedule | Needs | Output |
|---|---|---|---|
| `daily` | daily (seo-daily) | `GOOGLE_KEY_JSON` | `daily-summary.md`, `inspect-state.json`, `history.json`, `proposals.json` |
| `propose` | daily | `GITHUB_TOKEN` | issues labelled `seo-proposal` |
| `indexnow` | daily | `INDEXNOW_KEY` (+ key file on the site) | `indexnow-state.json` |
| `news` | daily | feeds file; AI key optional | `news-digest.md`, issues labelled `seo-topic` |
| `mentions` | daily | `mentions.json`; AI key optional | issues labelled `seo-backlink` |
| `audit` | daily | none (crawls your live site) | `audit.json`: findings with why and fix, including heading structure (skipped levels, generic or repeated H2s, long H1s, long pages without subheadings) |
| `redirects` | weekly (check and smoke) | a redirect map (`<dataDir>/redirects.json`) | `redirects-check.json/.md` (targets live, no chains, loops or hidden pages); `redirects generate` prints Apache, nginx, Netlify or Vercel rules (`--write <file>` fills a marked block); `redirects smoke` writes `redirects-smoke.json/.md` from the live site |
| `facts` | weekly (warn); `--strict` for a build or PR check | content files (json or markdown sites) or the live pages; `<dataDir>/verified-facts.json` | `facts.json`, `facts.md`: unverified percentages, prices, "N+" figures, multipliers, rankings, awards and client claims; sourced and verified ones listed separately |
| `conversions` | weekly | `GOOGLE_KEY_JSON`, `ga4PropertyId`, Viewer access | `conversions.json`, `conversions.md`: events received in 28 days, key events, expected conversions missing or not marked. The key-event read (GA4 Admin API) is tested with mocked responses only |
| `links` | weekly | output of `audit` | `links.json`, `links.md`: internal links to add for pages with few inbound links (mentions without a link, missing link-backs, same-section siblings). Report only |
| `render` | weekly, opt-in (`SEO_RENDER=true`) | Playwright and Chromium (installed by the step); `SEO_CHROMIUM_PATH` optional | `render.json`, `render.md`: prerendered sentences the page does not show (high), labels that differ (low), content only after JavaScript, changed title or H1. Opens FAQ accordions and `<details>` before comparing |
| `quality` | weekly | output of `audit`; `daily` for the query check | `quality.json`, `quality.md`: each page's top search query vs its title, H1 and description; average headings per site section |
| `analyze` | daily | output of `daily` | `insights.json`: striking distance, CTR gaps, cannibalization, decay, content gaps |
| `refresh` | weekly | `GITHUB_TOKEN`; output of `analyze` | issues labelled `seo-proposal` + `seo-refresh` for your pages that lost visibility |
| `deepdive` | weekly (seo-agent) | Python 3.10+ | `deepdive.md`, `deepdive.json`: query topics, unusual days, pages losing visibility |
| `agent` | weekly (seo-agent), opt-in | Python, `claude-agent-sdk`, a Claude login | `agent-reports/`, `agent-proposals.json`, issues with `--issue` / `--issues` |
| `geo` | weekly | none | `geo.json`, `geo.md`: AI-crawler access, llms.txt, answer-first and entity signals |
| `speed` | weekly | none (`PAGESPEED_API_KEY` optional) | `speed.json`, `speed.md`: Core Web Vitals, lab and real-user |
| `priorities` | daily (dry) and weekly (issue) | `audit`/`analyze` output | `priorities.json`, `priorities.md`, issue `seo-priorities` |
| `experiments` | weekly | `experiments.json` log | `experiments.md` (14 days before vs after) |
| `consent` | weekly | none | `consent.json`, `consent.md`: tracking without a consent tool, policy wording the site does not meet |
| `ymyl` | weekly | content type json or markdown for the real check | `ymyl.json`, `ymyl.md`: sensitive-topic pages missing an author or reviewer |
| `pace` | weekly | dated pages (`publishAt`) | `pace.json`, `pace.md`: releases per day and week, recommended schedule (report only) |
| `citations` | weekly | one of `BRAVE_API_KEY`, `SERPAPI_KEY`, `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD`; `questions.json` | `citations.json` (with history), `citations.md` |
| `dashboard` | daily | none | `dashboard/index.html` |
| `research` | weekly (seo-weekly) | `GOOGLE_KEY_JSON` | `keyword-backlog.json`, `keyword-research.md`, topic issues |
| `digest` | weekly | `GOOGLE_KEY_JSON` (+ GA4 access optional) | `weekly-digest.md`, issue `seo-digest` |
| `backlinks-queue` | weekly | `GITHUB_TOKEN` | issue `seo-backlink` |
| `indexing-queue` | weekly | `GITHUB_TOKEN` | `request-indexing.md`, issue `seo-indexing` |
| `backlinks` | daily (seo-backlinks), dry | Playwright; `BROWSER_WS_ENDPOINT` optional | `backlinks-state.json`, `backlinks-log.md`, screenshots |
| `schedule` | daily (seo-release) | none | edits your content files (`publishAt`) |
| `release` | daily | `DEPLOY_HOOK_URL` optional | `due=N`, rebuild trigger |
| `mark` | by hand | none | records a hand-done listing |

Outside GitHub Actions the jobs that open issues print what they would do unless `GITHUB_TOKEN` and `GITHUB_REPOSITORY` are set.

## Secrets and variables

| Name | Where | Needed for |
|---|---|---|
| `GOOGLE_KEY_JSON` | secret | everything that reads Google |
| `INDEXNOW_KEY` | secret | IndexNow |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | secret | optional AI judging, ideas, digest wording. `SEO_LLM_PROVIDER`, `SEO_MODEL`, `OPENAI_BASE_URL` pick the provider/model |
| `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` | secret | the implementer (drafts approved pages as pull requests); either works and drafting is optional |
| `PAGESPEED_API_KEY` | secret | optional, raises the PageSpeed rate limit |
| `BRAVE_API_KEY`, `SERPAPI_KEY`, `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` | secrets | optional, any one turns on the `citations` job |
| `SEO_INGEST_URL`, `SEO_INGEST_TOKEN` | secrets | optional database dashboard |
| `BROWSER_WS_ENDPOINT` | secret | optional cloud browser for backlinks |
| `DEPLOY_HOOK_URL` | secret | optional rebuild hook for scheduled publishing |
| `BACKLINKS_LIVE` | **variable** | `true` turns on real backlink submissions |

## Memory

Each run restores its memory from the `seo-data` branch and saves it back (`state restore` / `state save`), so the next run picks up where the last stopped (which pages were inspected, which news was seen, which backlinks were tried). The workflows share one concurrency group so two runs never save at once.
