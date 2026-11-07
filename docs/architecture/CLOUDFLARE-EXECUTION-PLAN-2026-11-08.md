# SEO Autopilot — Cloudflare Execution Plan (owner direction, 2026-11-08)

## Scope and decision
SEO Autopilot ONLY. Do not build a shared execution platform or touch other projects.
Keep existing portal on Hostinger, existing Supabase project `ymwwwhdlyjnqbxxhtcew`, and existing GitHub repo. Use Cloudflare Workers as the preferred cloud trigger/API execution layer; Cron for scheduling; Workflows only where necessary for durable multi-step tasks. Supabase is the source of truth for site state, jobs, approvals, organizational memory, leases, audit, cost and results. GitHub remains source control and release/build system, not the primary recurring production scheduler. No new paid service, VPS, migration, DNS change, production secret, deployment or merge without owner approval. Target $0 incremental Cloudflare execution cost until measured free-tier constraints require reconsideration.

## Verified baseline (main, as read 2026-11-08)
- `docs/implementation/STATUS.md` last updated 2026-11-03, v2.22.1; 474 tests reported passing on fixtures/mocks (not rerun during this documentation task).
- Existing core Node CLI, 38 agent definitions, jobs, MCP, Supabase portal and ingest function, existing GitHub scheduled daily workflows.
- Portal at `seo.erudience.com` on Hostinger; Supabase project above.
- `cloud/connector/README.md` documents an existing Cloudflare Worker MCP hosted connector with OAuth/KV; **not deployed** per STATUS. Do not conflate read-only MCP connector with execution runtime.
- No root `wrangler.toml` or `wrangler.jsonc` found on main; inspect nested `cloud/connector/wrangler.toml` and all branches.
- `docs/implementation/DECISIONS.md` D13 explicitly states the full existing CLI **cannot run in Workers** because it spawns git, Go and Python and uses filesystem operations. This remains a critical compatibility constraint. Do not assert all SEO engine tasks can run in free Workers.
- `docs/product/SEO-GOD-MASTER-SPEC.md` and roadmap not found on main; inspect PR #35 and active branches before declaring them missing.
- Provider live calls mocked; existing site snapshot integration still needs live end-to-end validation.

## Responsibilities
- Cloudflare Worker: authenticated scheduler tick, API/webhook ingestion, light SEO API jobs, approved external API calls, small task dispatch, state reconciliation and monitoring endpoints.
- Cloudflare Cron: a small number of centralized triggers; read due work from Supabase; stagger across 25 websites.
- Cloudflare Workflows: use selectively for multi-step, waiting and recovery where they materially help; do not spend Workflow step allowance on every trivial job.
- Supabase Postgres: tenant-scoped durable job ledger, scheduling data, idempotency keys, attempts, lease/heartbeat, approval hashes, budgets, evidence, agent memory, logs and RLS.
- GitHub: code, PRs, release builds and any CLI tasks that cannot run on Cloudflare Free, subject to Actions quotas; no assumption that GitHub Actions can sustain production schedules.
- Existing Hostinger: portal only; do not move hosting or DNS.
- Existing Cloudflare MCP connector: separate deployable unit, maintain its read-only permissions.

## Required architecture review before implementation
1. Inventory actual existing schedules, job dispatch, job types, runtime dependencies, data contracts, Supabase tables/RLS, approvals, secrets, hosted connector, all active branches/PRs and production integrations.
2. Classify EVERY job as (a) Cloudflare Free-compatible lightweight Worker; (b) Cloudflare Workflow candidate; (c) Node CLI/OS/browser/heavy task not compatible with Free Workers; (d) existing CI/build-only GitHub task.
3. Identify a realistic **cloud-only, no-purchase** execution strategy for category (c), if possible, using existing approved resources. If no viable free path exists, flag it as blocked rather than inventing a capability or silently paying.
4. Check current Cloudflare Free plan limits from official docs (requests/day, CPU/invocation, memory, Cron trigger count, Workflows invocations/steps/concurrency, Queues if proposed) and actual existing account usage. Limits and pricing are subject to change.
5. Preserve tenant isolation, consent/approval boundaries, secret management, site ownership verification and rollback. Never expose Supabase service-role credentials to frontend; use least privilege for Cloudflare secrets.
6. Avoid duplicate scheduling while transitioning: feature-flag and stage migration, verify parity before disabling existing jobs. Preserve existing portal and integrations.

## Initial capacity and cost model (estimates, not actual telemetry)
25 SEO sites × 14 lightweight job units/day = 350 jobs/day = 2,450/week = 10,500/30-day month. This is a planning scenario, not a promise of 350 full crawls/day. For a central hourly scheduler: 24 Cron Worker invocations/day, plus one or more Worker invocations per job, retries and callbacks. At 2 invocations/job, ~724 Worker requests/day for this project, before public traffic. 3 Workflow steps/job would mean 1,050 steps/day if every job uses Workflows; prefer selective use. External AI, SERP, crawler, storage and Supabase charges are separate. Record real CPU time, duration, memory, requests, workflow steps, provider spend and failures to revise projections.

## Implementation sequence (isolated branch and draft PR)
A. Audit current code and docs, reconcile D13 vs Cloudflare-first preference and PR #35; publish a capability matrix and migration map.
B. Implement Cloudflare Worker scheduler/API entrypoints with Wrangler config, environment separation, typed Supabase contracts, auth, budget/rate-limit enforcement, and idempotency; unit and integration tests.
C. Add targeted Workflows only where needed, with step and cost accounting; use Supabase for approval waiting when simpler.
D. Staging smoke tests with mock providers then one authorized real site, verify crash recovery, retries, approvals, multi-tenant isolation, secret handling and no duplicate execution.
E. Report exact setup steps for owner (Cloudflare account ID, Worker project, GitHub deployment identity, Supabase credentials securely entered by owner), projected usage, free-tier compatibility, blockers and rollback. Request explicit approval before Cloudflare deployment or production changes.

## Acceptance gates
- No production changes, DNS changes, purchases, merges, or new credential exposure.
- Existing portal, connector and GitHub workflows not broken.
- Repeated job dispatch cannot duplicate site modifications or publications.
- No client can access another client's site, secrets or results.
- Agency-only approvals enforced for high-risk operations.
- Queue/recovery and external API failure paths tested.
- Clear measured free-tier cost/limit dashboard, plus explicit heavy-job limitations.
- No claim that the full existing CLI executes inside Cloudflare Workers without proving runtime compatibility.
