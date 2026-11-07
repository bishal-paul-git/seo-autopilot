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
