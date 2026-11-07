# Implementation status

Kept short; read at the start of every session. History: [history/STATUS-to-2026-11-03.md](history/STATUS-to-2026-11-03.md). Detail: [CHANGELOG.md](CHANGELOG.md), [DECISIONS.md](DECISIONS.md). Deployed state: [../deployment-status.md](../deployment-status.md). Tests: [../test-matrix.md](../test-matrix.md).

## 1. Snapshot
- Last updated: 2026-11-08 UTC. Branch `claude/r1-contracts` (stacked: #33 → #34 → #36 audit plan → this); base `main` `e982f64`; release `v2.22.1`. Requirements: PR #35 (`docs/product/`).
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

## 4. Checks this session
`npm test` 498/498. `bash cloud/portal/supabase/test/run.sh`: all three suites pass. Real hosted scans: erudience.com (59 pages, 19 s), manchesterdisrepairclaims.co.uk (60, 13 s), www.excelerrorfinder.com (60, 31 s); one false-high fixed. Supabase advisors: intended `SECURITY DEFINER` warnings, leaked-password protection off.

## 5. Blockers and owner items
1. Go-ahead to: redeploy `scan` from the audit commit, apply the D25 migration and Vault secrets, publish the portal page.
2. Portal secrets on each site repository (E2E-GH flow).
3. Keys for live-provider tests (`docs/runbook.md` lists names); `SEO_AGENT=true` on one site to grade agents.
4. Supabase Auth: leaked-password protection on; decide invite-only sign-up before public launch.

## 6. Cost
No provider spend. Hosted scan within the Supabase free plan (about 3 sites per wake, 144 wakes a day).

## 7. Next
R1 order: owner merges #33/#34 → #35/#36 → contracts PR; then R1-P2 (client portal + submission inbox) and R1-A2 (SEO God planner and queue worker) in parallel.

Milestone: **both end-to-end flows pass on real sites** (test-matrix rows E2E-URL and E2E-GH), then live-provider tests and agent grading. Resume prompt: "seo-autopilot: read AGENTS.md and docs/implementation/STATUS.md; continue the blockers in order."
