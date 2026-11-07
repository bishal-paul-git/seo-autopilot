# Implementation status

Kept short; read at the start of every session. History: [history/STATUS-to-2026-11-03.md](history/STATUS-to-2026-11-03.md). Detail: [CHANGELOG.md](CHANGELOG.md), [DECISIONS.md](DECISIONS.md). Deployed state: [../deployment-status.md](../deployment-status.md). Tests: [../test-matrix.md](../test-matrix.md).

## 1. Snapshot
- Last updated: 2026-11-08 UTC. Branch `claude/cloudflare-execution` (stacked: #33 → #34 → #36 → #37 → #38 → #39 → #40 → #41 → this; includes PR #42's plan); base `main` `e982f64`; release `v2.22.1`. Requirements: PR #35 (`docs/product/`).
- Environment: Linux cloud container, Node 22, Postgres 16 (local SQL checks); network allowed to Supabase, GitHub and the owner's three websites.

## 2. Goal and phase
Release 1: agency-ready multi-client platform (`docs/product/SEO-GOD-MASTER-SPEC.md`). Phase: **M1 audit done** (`docs/product/R1-AUDIT-AND-PLAN.md`), **M2 shared contracts started** (`docs/product/R1-CONTRACTS.md`, D27).
Architecture: [../system-architecture.md](../system-architecture.md). Every job and agent: [../registry.md](../registry.md).

## 3. Capabilities
| Area | Built | Verified | Deployed |
|---|---|---|---|
| Engine (58 jobs, 57 audit rules) | yes | `npm test` 498/498 (mocked network); 16 jobs observed in real runs | v2.22.1 on 3 sites; new rules unreleased |
| Agents (38) | definitions | definition tests only; output never graded | 7 wired to workflows, but `SEO_AGENT`/`SEO_AUTOPILOT` off: none runs in production |
| Portal (auth, tenancy, approvals, invites, brand, share links) | yes | SQL checks `rls.sql`, `rls2.sql`; browser test | live; no site pushes snapshots yet |
| Address-only sites (D25) with SSRF guard and robots (D26) | yes | `rls3.sql`, `safe-fetch.test.mjs`, real scans of 3 live sites | `scan` v2 (pre-guard) deployed, migration **not applied** |
| Live providers (research, AEO/GEO, backlinks) | yes | mocked only | no keys |
| R1 contracts (clients, jobs, reviews, agency-only approvals, submissions, memory, audit) | migration + `job-lifecycle.mjs` | `rls4.sql`, `job-lifecycle.test.mjs` | **not applied** |
| R1 orchestration (per-site planner, reviewer, worker) | `src/god/` | `god.test.mjs`, `scripts/god-pg-e2e.mjs` on Postgres 16 | not deployed |
| R1 onboarding (dossier, questions, strategy proposal, site memory) | `src/god/onboarding.mjs`, `handlers.mjs`, memory migration | `onboarding.test.mjs`, `rls5.sql`; live runs on 2 sites (in-memory store) | not deployed |
| R1 scheduler (tick, budgets, costs, two-step strategy approval; D28) | `src/god/tick.mjs`, `scripts/god-run.mjs`, scheduler migration | `tick.test.mjs`, `rls6.sql`, `god-pg-e2e.mjs`; live dry run on 2 sites | not scheduled or deployed |
| R1 agent runner (advise only, user's key, budget-bounded; D29) | `src/god/agent-runner.mjs` | `agent-runner.test.mjs` (mocked API only) | no live model call yet |
| Cloudflare execution (Worker scheduler, scan job mode, pause, lease recovery, run log; D30) | `cloud/worker/`, scan function, migration 030000 | `cf-worker.test.mjs`, `rls7.sql`, `cf-local-e2e.mjs` in workerd, `scan-fn-local.mjs` in Deno on a real site | **not deployed**; see `docs/cloudflare/README.md` |

## 4. Checks this session
- `npm test`: 535/535.
- `bash cloud/portal/supabase/test/run.sh`: 7 suites pass.
- `god-pg-e2e.mjs`: passes.
- `cf-local-e2e.mjs`: the Worker ran in workerd against the real migrations; 18 checks pass.
- `scan-fn-local.mjs`: the scan function ran in Deno on a real site; 8 checks pass.
- `cf-measure.mjs`: CPU measured on 3 real sites. A scan costs 0.8-1.6 s of CPU; Worker steps cost 0.4-2.5 ms.
- Cloudflare and Supabase limits were read from the official docs.
- Read-only Supabase check: production is unchanged.

## 5. Blockers and owner items
1. Go-ahead to: redeploy `scan` from the audit commit, apply the D25 migration and Vault secrets, publish the portal page.
2. Portal secrets on each site repository (E2E-GH flow).
3. Keys for live-provider tests (`docs/runbook.md` lists names); `SEO_AGENT=true` on one site to grade agents.
4. Supabase Auth: leaked-password protection on; decide invite-only sign-up before public launch.

## 6. Cost
No provider spend. Hosted scan within the Supabase free plan (about 3 sites per wake, 144 wakes a day).

## 7. Next
Cloudflare: follow `docs/cloudflare/README.md` (account setup, secrets, deploy paused, one pilot site). Confirm CPU p99 in the Workers dashboard before un-pausing all sites.
Next check needing the owner: one live agent run on a pilot site with the owner's own Anthropic key (set it as an environment secret, never in chat), then grade the advice. Needs a decision: the R1-P2 portal (build on #31 or not), a schedule for `god-run.mjs`.
R1 order: owner merges #33/#34 → #35/#36 → contracts PR; then R1-P2 (client portal + submission inbox) and R1-A2 (SEO God planner and queue worker) in parallel.

Milestone: **both end-to-end flows pass on real sites** (test-matrix rows E2E-URL and E2E-GH), then live-provider tests and agent grading. Resume prompt: "seo-autopilot: read AGENTS.md and docs/implementation/STATUS.md; continue the blockers in order."
