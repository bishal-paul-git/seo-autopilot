# Cost ledger

Every dollar this project spends, in one place (owner's request, 2026-11-13). Each session that spends money or reads spend appends a dated row, and a source must be given for every figure.

The figures have three kinds of source:
- **Measured:** the production table `public.job_costs`, or the cost line of a GitHub Actions run.
- **Estimate:** says so in the Source column.
- **Unknown:** said plainly when nothing records the spend.

Amounts are USD, AI usage only. Hosting is listed separately at the end.

## Running total (AI, measured)
| Up to | Production specialists | Agent exams | Total measured |
|---|---|---|---|
| 2026-11-13 | $0.40 | $6.15 | **$6.55** |

## Entries
| Date (UTC) | What | Where the money went | USD | Source |
|---|---|---|---|---|
| 2026-11-12 | Pilot erudience.com: seo-snippet-optimizer, seo-entity-reputation, seo-reporter (1 run each) | agency Anthropic key (Worker secret) | 0.305 | `job_costs` |
| 2026-11-13 | Pilot erudience.com: seo-strategist (1 run) | agency Anthropic key | 0.091 | `job_costs` |
| 2026-11-13 | Agent exam run 1 (16 cases) | owner's Anthropic key (repo secret, `agent-exams` workflow) | 2.22 | Actions run 43342999204 |
| 2026-11-13 | Agent exam run 2 | owner's Anthropic key | 2.05 | Actions run 43346022217 |
| 2026-11-13 | Agent exam run 3 (14 cases) | owner's Anthropic key | 1.88 | Actions run 43348165017 |

## Spend outside the records
These spend on keys this project does not see, so their totals are unknown.

- **tenanthousingdisrepair (Manchester Disrepair Claims):** its repository has its own `ANTHROPIC_API_KEY`, which is used by its seo-daily, seo-weekly and seo-agent workflows (seen in the run logs on 2026-11-13). That spend shows only in the owner's Anthropic console, under that key. To bring it into this ledger, either remove the key (the hosted specialists don't need it) or read its usage from the console each month.
- **Other projects using the same Anthropic key:** about $6 on 2026-11-13. The owner identified it as not this project.

## Caps in place
| Cap | Value | Where |
|---|---|---|
| Hosted specialists | $2 per site per day (default) | Worker `budget` setting, D44; `sites.daily_budget_usd` overrides it per site |
| Agent exams | $5 per run (`--max-usd`), $0.50 per case | `scripts/exams.mjs`, the `agent-exams` workflow |
| Paused sites | $0: paused sites are never planned; a GitHub push doesn't unpause them | D54 |

## Not AI
- Supabase, Cloudflare Workers and Hostinger hosting are billed on the owner's existing plans. This project hasn't measured their marginal cost.
- GitHub Actions minutes come from the owner's plan.
