# Release 1 orchestration (SEO God per website)

Status: **built and tested locally (in-memory and against the database gates on Postgres 16); not deployed; no agent
has run on a real site through it.** Code: `src/god/`. Contracts it uses: [R1-CONTRACTS.md](R1-CONTRACTS.md).

| Part | File | What it does |
|---|---|---|
| Departments | `src/god/departments.mjs` | The spec's eight departments, mapped to existing agent folders and engine jobs (Analytics & Performance and Automation & Integrations get `seo-reporter` and `seo-coordinator`; verticals stay packs under Research). Risk per agent: read-only low, editing medium, site-wide/destructive high. No files moved. |
| Planner (one per site) | `src/god/planner.mjs` | From the site's reports and strategy: a fresh-scan job when the audit is older than 36 h; **before an approved strategy only discovery and a high-risk `strategy_proposal` (needs agency approval)**; after approval, specialist jobs from the existing deterministic router with department, risk, priority (requests 1, critical fixes 2, opportunities 3), evidence and a weekly idempotency key. |
| Independent reviewer | `src/god/review.mjs` | `quality-gate@1`: evidence present, changes only on the job's own site, change count within the risk class, numbers need a source, actions must not repeat instruction-like untrusted text, never reviews its own work. Model-based review plugs in with the same signature. |
| Stores | `src/god/stores.mjs` | `MemoryStore` (gates from `src/core/job-lifecycle.mjs`) and `SupabaseStore` (the contract RPCs with the service key). |
| Worker | `src/god/worker.mjs` | `enqueue` (create, scope, queue or send to approval) and `runOnce` (claim with lease, run the handler with a timeout, complete low-risk read-only work, otherwise review → approval if required → deploy → verify → rollback on failed verification, capped retries then escalation). Never approves. |

Evidence: `test/god.test.mjs` (8 tests); `node scripts/god-pg-e2e.mjs` against the real migrations: idempotent
planning, two agencies' sites scanned in one queue, strategy proposals held for approval, worker refused authorization,
cross-agency approval refused, every move recorded.

Not built yet: handlers that call the existing jobs and agents for real (scan → `src/hosted/scan.mjs`, agent jobs → the
Python agent runtime), a scheduler that runs the planner and worker (Supabase cron or GitHub Actions), costs per job,
strategy content generation, and portal views of jobs.

## Onboarding (R1-B1)
| Part | File | What it does |
|---|---|---|
| Dossier, questions, strategy draft | `src/god/onboarding.mjs` | Facts the site states (with source and basis stated/inferred/answered), questions only for what is unknown and relevant to this kind of site (local business, shop, several services), and a strategy draft from the audit's top priorities, marked `approval: agency`. Site text is stored as data; it never becomes an action. |
| Handlers | `src/god/handlers.mjs` | `scan` (the hardened hosted scanner; writes stated facts to site memory) and `strategy_proposal` (drafts the proposal and questions; reviewed, then back to the agency). |
| Site memory writes | migration `20261108010000_r1_memory.sql` (`remember`, `recall`, service role only) and the stores' `writeMemory`/`readMemory` | A new value supersedes the old; history kept; several values of one fact get their own keys. |

Live evidence (2026-11-08, from this session, through the worker with an in-memory store): erudience.com in 16 s and
manchesterdisrepairclaims.co.uk in 10 s, each scanned, 8-9 stated facts with sources, 8 relevant questions, strategy
proposal reviewed and held for agency approval. A bug found on the first run (three social profiles stored as one) is
fixed and tested.

## Scheduler (R1-A2, D28)
| Part | File | What it does |
|---|---|---|
| Tick | `src/god/tick.mjs` | For each site that is not paused: carry out the agency's recorded decisions (`advance`), work out the strategy status, plan with the site's own planner, queue only kinds with a runner and within the day's budget (open jobs' remaining budget is reserved), then run up to `maxJobs` jobs. Each site is handled on its own; one site's error is reported and the others continue. Kill switch: `paused`. |
| Runner | `scripts/god-run.mjs` | Against Supabase with the service key, or `--memory <urls>` as a dry run on real sites (`--approve` plays the agency, in memory only; refused against Supabase). Not scheduled or deployed. |
| Costs and outputs | migration `20261108020000_r1_scheduler.sql` | `job_costs` (one row per charge; agency members read their own), `record_job_output`, `site_spend`, `site_jobs`, `god_sites` (service role only); site memory kinds `report` and `setting`. |
| Worker changes | `src/god/worker.mjs`, `review.mjs` | Stores each run's output (proposal, changes, claims, questions, evidence) and cost before review; overspending fails review without retry. |

Evidence:
- `test/tick.test.mjs`: 6 tests.
- `cloud/portal/supabase/test/rls6.sql`.
- `node scripts/god-pg-e2e.mjs` against all six migrations: two ticks take an approved proposal through drafting, review, a second agency approval and acceptance, while the other agency's site keeps waiting.
- Live dry run (2026-11-08, in memory): `node scripts/god-run.mjs --memory https://erudience.com https://manchesterdisrepairclaims.co.uk --approve`.
  - Both sites were scanned in 29.6 s, with 10 and 9 sourced facts and 8 questions each.
  - Both proposals were drafted, reviewed and accepted after the two approvals.
  - After approval the planner chose 7 agents (link builder, content pruner, entity reputation, reporter, strategist, snippet optimizer, technical fixer). All 7 are deferred because no agent runner exists yet.

Not built yet:
- an agent runner (the Python runtime with the user's own AI key);
- the apply step for approved changes (R1-E1);
- a schedule for `god-run.mjs` (Supabase cron or GitHub Actions; needs the owner's go-ahead);
- portal views for jobs, costs and approvals (R1-P2).
