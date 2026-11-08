# Test matrix

What is tested, how, and with what result. "Mocked" tests replace the network with recorded or fake responses: they
prove the logic, not the live integration. Last full run: 2026-11-07 on the audit branch.

## Automated
| Area | Command | Kind | Result |
|---|---|---|---|
| Engine, jobs, analysis, agents, registry, portal snapshot | `npm test` | unit, fixture, mocked network | 498/498 pass |
| Portal page (sign-in, add by GitHub, add by address, dashboard, about card, client link, phone layout) | `npm test` (`test/portal-app.test.mjs`, Chromium) | browser against a stand-in API | pass |
| SSRF guard, robots.txt, body cap | `test/safe-fetch.test.mjs` | security unit tests | 6/6 pass |
| New audit rules | `test/audit-more.test.mjs` | unit | 8/8 pass |
| Registry matches code | `test/registry.test.mjs` | drift check | pass |
| Portal SQL: RLS, tokens, share links, decisions, invites, address-only sites, limits, cron | `bash cloud/portal/supabase/test/run.sh` | Postgres 16 with Supabase stand-ins (`shim.sql`, `shim3.sql`) | all three suites pass |
| Go crawler | `cd engines/go && go test ./...` | unit | not re-run in this audit |
| Python runtime | `engines/python` tests | unit with a stub SDK | not re-run in this audit |

## Live (real sites and services)
| ID | Flow | Status | Evidence |
|---|---|---|---|
| L1 | Hosted scan of erudience.com | **pass**: 59 pages in 19 s, 0 high, 17 low findings, business name, phone, email, address, 3 social profiles, 5 key pages | 2026-11-07, `scanSite` run from the audit session through its proxy |
| L2 | Hosted scan of manchesterdisrepairclaims.co.uk | **pass**: 60 pages in 13 s; LegalService markup, 2 phones, address read | same |
| L3 | Hosted scan of www.excelerrorfinder.com | **pass**: 60 pages in 31 s, Next.js detected, 132 findings (mostly long titles and descriptions) | same |
| L4 | Finding accuracy spot check | one false "high" found and fixed: www variant serving 200 with a canonical to the main host is now "host-variant-canonical-only" (low) | curl check of `https://www.erudience.com/` |
| L5 | Daily GitHub run on a real site | pass (daily, rank, audit, priorities, portal snapshot built) | erudience-flow-engine seo-daily runs |
| E2E-URL | Add by address in the portal, then scan, store, dashboard, next-day scan | **blocked**: D25 not applied | |
| E2E-GH | seo-daily, then portal push, display, approve, apply on GitHub, verify | **blocked**: portal secrets not set on any site | |
| P1 | Live providers (DataForSEO, Brave, SerpAPI, Perplexity, OpenAI, Anthropic, Gemini, Bing, OPR, CrUX, KG, Google Ads) | **blocked**: no keys available to the audit | mocked tests only |
| A1 | Agent output quality on a real site | **untested**: `SEO_AGENT` off; no agent run graded | |

## Measured
- Scan cost: Supabase free plan; about 13-31 s and 60 pages per site, so about 3 sites per 100-second wake and up to 144
  wakes a day. Provider costs: none incurred (no keys).
- Daily GitHub run: 8 minutes before the audit, 6.5 of them URL inspection one by one; now four at a time (expected
  about 2-3 minutes, **not yet observed** on a real run).
