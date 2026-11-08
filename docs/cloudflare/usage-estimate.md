# Free-tier usage for 25 websites (estimate, 2026-11-08)

These are estimates. They are computed from the defaults in `cloud/worker/wrangler.toml`, the planner's rules, and CPU measured on three real websites ([measurements-2026-11-08.json](measurements-2026-11-08.json)). They are not Cloudflare telemetry. After deployment, `select public.god_usage(7)` and the Workers dashboard give the real figures, and this page must be corrected from them.

## Limits used (official docs, read 2026-11-08)
| Limit | Free plan | Source |
|---|---|---|
| Workers requests | 100,000 per day (Workflows executions share it) | developers.cloudflare.com/workers/platform/limits |
| Workers CPU per invocation (HTTP and Cron) | 10 ms | same |
| Subrequests per invocation | 50 (1,000 to Cloudflare services, which includes service bindings) | same |
| Open connections per invocation | 6 | same |
| Cron Triggers per account | 5 | same |
| Workflows | 10 ms CPU per step, 3,000 steps per day, 100 concurrent instances, 50 subrequests per instance | developers.cloudflare.com/workflows/reference/limits, /workers/platform/pricing |
| Node APIs in Workers | `child_process` is a non-functional stub; `fs` is virtual, and `/tmp` is cleared per request | developers.cloudflare.com/workers/runtime-apis/nodejs |
| Supabase Edge Functions | 2 s CPU per request, 150 s wall clock, 256 MB; 500,000 invocations per month on Free | supabase.com/docs/guides/functions/limits, supabase.com/pricing |

## Measured CPU (Node 22, same V8 engine as Workers; includes JIT warm-up)
| Step | CPU | Runs where |
|---|---|---|
| Crawl and audit, 59-60 pages | 792-1,599 ms, which is 13-27 ms per page | Supabase scan function, capped at 40 pages per request |
| Onboarding dossier and memory rows | 0.4-1.0 ms | Worker |
| Planning a site (`planSite`) | 0.6-2.5 ms | Worker |
| Agent prompt build | 0.6-1.1 ms | Worker |
| Agent reply parse | 0.1-0.2 ms | Worker |
| Parse the compact scan result (2-14 KB) | under 0.1 ms | Worker |

A single crawled page costs more than the Worker's 10 ms. That is why crawling never runs in a Worker. Every Worker step above stays at least 4 times under 10 ms. The real CPU inside Workers still has to be confirmed in staging from the Workers dashboard's CPU time (p99).

## Daily volume for 25 sites, with the default settings
| Item | Rule | Per day |
|---|---|---|
| Cron runs | `*/15 * * * *` | 96 |
| Site planning invocations | each site at most every 6 h, plus as soon as the agency approves something | about 100 |
| Scan jobs | a new scan when the audit is older than 36 h | about 13-25 |
| Agent jobs | weekly key per agent, about 5-8 agents per site, only with an approved strategy and a budget | 0 with a $0 budget; about 18-29 with one |
| Job invocations | jobs, plus at most one "queue empty" probe per run | about 110-150 |
| **Worker requests** | sum of the above | **about 310-350 (0.35% of 100,000)** |
| Subrequests per invocation | measured in workerd: 115 over 22 invocations, about 5 on average; worst case estimated at about 30 (planning that creates 8 jobs) | at most 50 allowed |
| Cron Triggers | one | 1 of 5 |
| Workflow steps | Workflows are not used (D30) | 0 of 3,000 |
| Supabase Edge invocations | one per scan job | about 13-25 a day, so about 400-750 a month (0.15% of 500,000) |
| Supabase CPU per scan | 40-page cap: about 0.5-1.1 s estimated | under 2 s |
| Supabase rows | `god_runs` 96 a day, about 10 `job_events` per job, memory superseded on change | about 1,000 rows a day; storage well under the 500 MB Free database |

The owner's planning scenario in PR #42 was 25 sites × 14 job units a day, or 350 jobs a day. At that volume the requests would still be under 1,000 a day. The binding limits would then be the Supabase scan CPU per request and provider spend, not Cloudflare.

## Money
- **Cloudflare:** $0. Workers Free and one Cron Trigger; no Workflows, Queues, KV, D1 or paid add-ons.
- **Supabase:** within the Free plan for the volumes above.
- **AI provider:** the agency's own Anthropic key (rule 6). It is capped per site per day by `SEO_GOD_DAILY_BUDGET_USD` (default $0, which means no paid work). The workerd test used stand-in usage of 4,000 input and 800 output tokens on Opus 5.5, which is $0.032 per run. Real per-run cost is unknown until a live run. At the cap, 25 sites × $0.50 is at most $12.50 a day.
- **GitHub Actions:** unchanged. The site repositories' existing workflows keep running the 52 CLI jobs.

## What would break the free tier first
1. **CPU per Worker invocation.** Mitigations: one site or one job per invocation, compact payloads, no crawling. If staging p99 exceeds about 7 ms, lower the memory payloads before considering a paid plan.
2. **Subrequests per invocation (50).** Planning that queues many new jobs at once uses about 3 per job. `tick` already defers work over budget; a per-invocation job cap would be the next step.
3. **Scan CPU at Supabase.** Heavy pages can push 40 pages towards 2 s. Lower `SCAN_MAX_PAGES` if the function logs CPU-limit errors.
