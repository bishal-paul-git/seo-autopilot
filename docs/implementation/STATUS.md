# Implementation status

Kept short; read at the start of every session, together with [REVIEW-QUESTIONS.md](REVIEW-QUESTIONS.md) (open questions and the owner's replies). History: [history/STATUS-to-2026-11-03.md](history/STATUS-to-2026-11-03.md). Detail: [CHANGELOG.md](CHANGELOG.md), [DECISIONS.md](DECISIONS.md). Deployed state: [../deployment-status.md](../deployment-status.md). Tests: [../test-matrix.md](../test-matrix.md).

## 1. Snapshot
- Last updated: 2026-11-08 ~17:30 UTC. Release 1 merged into `main` as `5b5f103` ([#51](https://github.com/bishal-paul-git/seo-autopilot/pull/51), owner-authorized; carries #33–#50). Follow-up docs on `claude/hopeful-euler-662mu5`. Release `v2.22.1` (no new tag yet).
- Environment: Linux cloud container, Node 22, Postgres 16 (local SQL checks); network allowed to Supabase, GitHub and the owner's three websites.

## 1b. Production (2026-11-08, Supabase `ymwwwhdlyjnqbxxhtcew`)
| Step | State | Evidence |
|---|---|---|
| Backup | done | schema `backup_20261108` (9 tables + function definitions) |
| P1 migrations (15, one transaction) + P2 Vault + platform admin + pause | **applied by the owner** in the SQL editor via a loader that downloads `release-1-apply.sql` at commit 674a931 and checks its md5 (`eef7677c…`) | read-only check: 18 migrations (latest 20261108130000), 0 cron jobs, 2 Vault secrets, 1 platform admin, `god_control.paused = true`, 4 sites and 2 agencies intact, helper `http` extension removed; pg_cron and pg_net installed |
| `notify` Edge Function v1 | deployed (verify_jwt off; own secret check) | POST without/with a wrong secret: 403 |
| `scan` Edge Function v3 | deployed; product modules imported from `src/` at pinned commit 674a931 (identical to the `build-scan.mjs` copy) | 403 without secret; job-mode scan of erudience.com (10 pages, read-only) through pg_net: HTTP 200, `snapshotStored: true` |
| Cloudflare Worker `seo-god` | **deployed 2026-11-11 23:01 UTC** by the owner's run #4 of deploy-seo-god into the Erudience Cloudflare account (version decc4bf8); cron every 15 min | health `{"ok":true}`; `god_runs` rows every 15 min with no errors and `paused=true`; Supabase calls work with an `sb_secret_` key |
| Read-only pilot, erudience.com only | **owner said go 2026-11-12**: the other 3 sites set to `status='paused'` (previous statuses in `backup_20261108.pilot_site_status`), database switch `god_paused()=false`; waits on the owner setting the Worker var `SEO_GOD_PAUSED=false` in the Cloudflare dashboard | not yet run |
| SMTP | **owner**: Auth → SMTP settings, and `SMTP_*` + `PORTAL_URL` function secrets | summaries are skipped (reported) until set |
| Portal publish (P6), unpause (P7), GitHub execution for the pilot (P8) | not done; not authorized for the pilot | n/a |
Rollback: `cloud/portal/supabase/rollback/release-1.sql`; previous scan is v2 (redeploy from the pre-Release-1 source).

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
| Learning from results (D31): accepted advice re-checked by later scans; lessons per agent change planning and reach agents; shown to the agency | `src/god/learning.mjs`, migration 060000 | `learning.test.mjs`, `rls10.sql`, workerd e2e (26 checks) | not deployed; real outcomes need a live site |
| Operations (D32): agency overview of all sites; platform health and pause switch for platform admins | portal, migration 070000 | `rls11.sql`, `portal-ops.test.mjs` | not deployed |
| Search Console for hosted sites (D33): accepted advice measured against the rest of the site | `src/god/search-console.mjs` | `search-console.test.mjs` (mocked Google) | not deployed; needs `GOOGLE_KEY_JSON` (Q11) |
| Security fixes from an independent review (D34) and a go-live preflight check | migration 080000, `scripts/god-preflight.mjs` | `rls12.sql`, `security-fixes.test.mjs`, `god-preflight.test.mjs` | not deployed |
| One agency approval per strategy (D35): drafted right after the scan; only the agency adopts it | `src/god/`, migration 090000 | `rls13.sql`, `tick.test.mjs`, `god-pg-e2e.mjs`, workerd e2e | not deployed |
| Verified execution through the site's own GitHub (D37): work order, agency approval, issue + seo-implement, pull request followed, verified by the next scan | `src/god/github.mjs`, `tick.mjs`, migration 110000, portal | `github-execution.test.mjs`, `rls16.sql`, `portal-github.test.mjs`, workerd e2e (full path) | not deployed; never run against real GitHub |
| Notifications, monthly work report, team page by department (D38) | migration 120000, portal | `rls17.sql`, `portal-notes.test.mjs`, `portal-team.test.mjs` | not deployed |
| Brand discovery, stated/inferred (D39) | `src/analysis/discover.mjs`, `onboarding.mjs` | `discover.test.mjs`, `portal-app.test.mjs` | not deployed |
| R1 onboarding (dossier, questions, strategy proposal, site memory) | `src/god/onboarding.mjs`, `handlers.mjs`, memory migration | `onboarding.test.mjs`, `rls5.sql`; live runs on 2 sites (in-memory store) | not deployed |
| R1 scheduler (tick, budgets, costs; strategy drafted at once, one agency approval adopts it, D35) | `src/god/tick.mjs`, `scripts/god-run.mjs`, scheduler migration | `tick.test.mjs`, `rls6.sql`, `god-pg-e2e.mjs`; live dry run on 2 sites | not scheduled or deployed |
| R1 agent runner (advise only, user's key, budget-bounded; D29) | `src/god/agent-runner.mjs` | `agent-runner.test.mjs` (mocked API only) | no live model call yet |
| Cloudflare execution (Worker scheduler, scan job mode, pause, lease recovery, run log; D30) | `cloud/worker/`, scan function, migration 030000 | `cf-worker.test.mjs`, `rls7.sql`, `cf-local-e2e.mjs` in workerd, `scan-fn-local.mjs` in Deno on a real site | **not deployed**; see `docs/cloudflare/README.md` |
| Agency console: the SEO God page (approvals, questions, escalations, results, spend) | `cloud/portal/app/index.html`, migration 040000 | `rls8.sql`, `portal-god.test.mjs` (Chromium) | not deployed (portal unchanged) |
| Client portal: client accounts with reports and requests; agency inbox and client access; requests assessed as advice after agency approval | portal, migration 050000, `tick.mjs`, `agent-runner.mjs` | `rls9.sql`, `portal-requests.test.mjs`, `client-request.test.mjs`, workerd e2e (24 checks) | not deployed |

## 4. Checks this session
- Head 5f9948a: `npm test` 580/580.
- `bash cloud/portal/supabase/test/run.sh`: 17 suites pass.
  - `rls13.sql`: one-approval strategy.
  - `rls14.sql`: invite-only sign-up.
  - `rls15.sql`: every outsider-callable function called against another agency's ids. 1,250 calls to 39 functions; none leaked or changed data; a planted leak was caught.
  - `rls16.sql`: GitHub execution (token in Vault, owner only). `rls17.sql`: notifications, work report, workforce.
- `node scripts/db-rollback-check.mjs`: after 14 migrations, the rollback restores the production-equivalent catalog exactly, and the chain re-applies cleanly.
- Read-only production fingerprint (2026-11-08): the schema equals the two portal migrations, with 3 noted exceptions (manifest section 0).
- `god-pg-e2e.mjs`: passes.
- `cf-local-e2e.mjs`: the Worker ran in workerd against all migrations through 110000; 31 checks pass. They include one-approval strategy adoption, the client request path, learning, and the full GitHub execution path with a GitHub stand-in.
- `scan-fn-local.mjs`: the scan function ran in Deno on a real site; 8 checks pass.
- `cf-measure.mjs`: CPU measured on 3 real sites. A scan costs 0.8-1.6 s of CPU; Worker steps cost 0.4-2.5 ms.
- Cloudflare and Supabase limits were read from the official docs.
- Read-only Supabase check: production is unchanged.

## 5. Blockers and owner items
Owner answered Q1, Q2, Q3 and Q8 (2026-11-08). The other open decisions are in [REVIEW-QUESTIONS.md](REVIEW-QUESTIONS.md) and [RELEASE-1-PRODUCTION-GATES-2026-11-08.md](RELEASE-1-PRODUCTION-GATES-2026-11-08.md).
1. **Gate A/B:**
   - Review PR #51.
   - Approve each step in [RELEASE-1-PRODUCTION-CHANGE-MANIFEST.md](RELEASE-1-PRODUCTION-CHANGE-MANIFEST.md): backup, P1 migrations, P2 Vault, P3 scan v3, P4 paused Worker.
   - P6 (portal publish) and P7 (unpause) are not authorized.
2. Portal secrets on each site repository (E2E-GH flow).
3. Keys for live-provider tests (`docs/runbook.md` lists names); `SEO_AGENT=true` on one site to grade agents.
4. Supabase Auth: leaked-password protection (Q9). Invite-only sign-up is handled by migration 100000 (D36), with no Auth setting change.
5. Confirm who the platform admin is (Q10). D1 was confirmed and D35 is merged into #51.
6. Old PRs #23, #24 and #31: see [STALE-PR-AUDIT-2026-11-08.md](STALE-PR-AUDIT-2026-11-08.md). Nothing was closed.

## 6. Cost
No provider spend. Hosted scan within the Supabase free plan (about 3 sites per wake, 144 wakes a day).

## 7. Next
Owner: review #51 and approve the manifest steps one at a time. After approval, Claude applies P1–P4 exactly as written, with the backup first, and records the evidence. Then: a day of paused runs (CPU p99, X1), then a separate approval to unpause erudience.com read-only (manifest section 3).
Next check needing the owner: one live agent run on a pilot site with the owner's own Anthropic key (set it as an environment secret, never in chat), then grade the advice. Needs a decision: the R1-P2 portal (build on #31 or not), a schedule for `god-run.mjs`.
R1 order: owner merges #33/#34 → #35/#36 → contracts PR; then R1-P2 (client portal + submission inbox) and R1-A2 (SEO God planner and queue worker) in parallel.

Milestone: **both end-to-end flows pass on real sites** (test-matrix rows E2E-URL and E2E-GH), then live-provider tests and agent grading. Resume prompt: "seo-autopilot: read AGENTS.md and docs/implementation/STATUS.md; continue the blockers in order."
