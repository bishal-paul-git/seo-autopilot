# Release 1 audit, gap matrix and plan

Date: 2026-11-08. Branch `claude/r1-audit-plan` (stacked on PR #34 → #33; PR #35's product docs merged in).
Requirements: [SEO-GOD-MASTER-SPEC.md](SEO-GOD-MASTER-SPEC.md), [DECISION-QA-REGISTER.md](DECISION-QA-REGISTER.md),
[IMPLEMENTATION-ROADMAP.md](IMPLEMENTATION-ROADMAP.md). This document changes nothing in production.

Status words: **Verified** (code + test + observed on a real system), **Partial** (some of it exists or is proven),
**Unverified** (built, tested only with mocks or not at all), **Missing** (no code).

## 1. Baseline (checked 2026-11-08)
| Item | State | Evidence |
|---|---|---|
| `main` | `e982f64` (2026-11-04), release `v2.22.1` (`f2301b4`) | `git log`, `git ls-remote --tags` |
| Open PRs | #35 product docs (draft); #34 audit hardening (draft, CI green); #33 address-only scan (draft, CI green); #31 portal "Style A" (draft, from another session, not rebased on #33); #24 Dependabot setup-node 4→7; #23 work evidence + SaaS redesign plan (draft, stale since 2026-10-25) | GitHub |
| CI | Node 20/22 test jobs green on #33 head `3176cf0` and #34 head `d28b231` | check runs |
| Tests | `npm test` 498/498 on #34; portal SQL suites rls, rls2, rls3 pass on local Postgres 16 | runs on 2026-11-07 |
| Supabase `ymwwwhdlyjnqbxxhtcew` (read-only check) | last migration `20261030211548`; 4 sites, 2 snapshots (latest 2026-10-31 seed), 1 user; pg_cron/pg_net off; `ingest` v1, `scan` v2 (pre-guard, inert) | SQL + function list |
| Portal | seo.erudience.com, `seo-portal` `1daf25f` (includes #33's UI, which errors until D25 is applied) | Hostinger log 2026-11-05 |
| Sites | erudience-flow-engine, tenanthousingdisrepair, excel-error-finder run seo-daily on v2; `SEO_AGENT`/`SEO_AUTOPILOT` unset, so no AI agent runs in production; no site pushes to the portal | Actions history |

## 2. Gap and traceability matrix
| Spec ref | Requirement | Existing code | Status | Tests | Live evidence | Risk | Action (workstream) |
|---|---|---|---|---|---|---|---|
| §1 | Agency workspace → clients → websites | `orgs` (agency), `sites.org_id`; no client entity | Partial | rls.sql | 2 orgs live | High: no client layer to scope client users | R1-C1 contracts (WS-F/C) |
| §1 | Client users: reporting + submissions only | share links (anon, read one site); no client accounts, no submissions | Partial | rls.sql (`shared_site`) | 3 share links | High | R1-C1 client membership + submissions; R1-P2 portal |
| §1 / Q28 | Agency-only approvals | `decide_proposal` requires org membership (agency only; clients are never members) | Partial: holds today because clients have no accounts | rls2.sql | 0 decisions | High once client accounts exist | R1-C1: explicit role check + negative tests |
| §1 / Q29 | Client submission → validation → SEO God analysis → agency review → accept/reject; never executes | none | Missing | none | none | High | R1-C1 schema + state machine; R1-P2 inbox |
| §1 / §9 | Server-side authorization, tenant isolation, audit records | RLS + definer checks; no audit log table | Partial | rls, rls2, rls3 | advisors: intended warnings only | Medium | R1-C1 `audit_log`, per-site scoping |
| §2 | Independent SEO God per website | `team` job + `agent-router` (deterministic plan per site); `agent` job (Python runtime, strategist/researcher) | Partial: per-site planning exists; no persistent director, no conversation | agent-router tests (fixtures) | never run in production | Medium | WS-A after contracts |
| §2 | Eight departments as specified | `departments/`: command, research, technical, content, authority, ai-search, verticals, quality | Partial: 6 of 8 match; spec's Analytics & Performance and Automation & Integrations are missing as departments; command/verticals are extra | agents.test | n/a | Low | R1-D mapping (section 3) |
| §2 | Distinguish definition / capability / scheduled job / running execution / verified outcome | `docs/registry.md` (definition, trigger, verification level) | Partial: no execution records | registry.test | 16 jobs observed in real runs | Medium | R1-C1 `jobs`, `job_events` |
| §2 | Agent/skill creation only within permissions, tested, versioned, rollback | agent definitions are files in git (versioned); no runtime creation | Missing | none | none | Medium | WS-D later (M4) |
| §3 | Initial strategy needs agency approval before execution | proposals as GitHub issues + label gates (D17) | Partial (GitHub sites only) | autonomy tests | seo-autopilot workflow skipped (off) | High | R1-C1 strategy + approval records |
| §3 | Job lifecycle with leases, dedup, idempotency, retry caps, budgets, escalation | `work-orders` (dependencies, page locks, checks) for local runs; `claim_scan` (lease) for scans | Partial | work tests, rls3 | none | High | R1-C1 state machine (`src/core/job-lifecycle.mjs`) + tables |
| §3 | Every job records tenant, actor, versions, inputs, budgets, evidence, review, approval, deploy, rollback | none centrally | Missing | none | none | High | R1-C1 |
| §4 | URL discovery with SSRF/DNS/redirect/robots defenses and provenance | `src/hosted/scan.mjs`, `safe-fetch.mjs`, `discover.mjs` (PRs #33/#34) | Partial: built and tested; not deployed | safe-fetch, discover, rls3 | real scans of 3 sites (2026-11-07) | Medium | R1-O1 (WS-B): deploy after authorization |
| §4 | Brand assets (logo, favicon, colours, typography), market, competitors | logo/icon only; no colours, typography, competitors from URL | Partial | discover tests | real scans | Low | WS-B extension |
| §4 | Verified vs inferred vs unknown labels, confidence | every discovered value has a source URL; no inference/confidence field | Partial | discover tests | real scans | Low | WS-B: add `basis` (stated/inferred) + confidence |
| §4 | Dynamic personalised questions, dossier, strategy proposal with approval gate | `onboarder` agent definition only | Missing | none | none | High | WS-B (M3), after contracts |
| §5 | GSC, GA4, GitHub, crawl/sitemap, Bing, Sheets | GSC, GA4, GitHub, crawl, sitemap, Bing (jobs); no Sheets | Partial: GSC/GA4/GitHub/crawl verified on real sites; Bing mocked; Sheets missing | job tests | seo-daily runs | Medium | WS-E: Bing live test, Sheets adapter |
| §5 | Read scopes separate from write scopes | GSC read-only scope; GitHub token per workflow; no per-site credential registry | Partial | none | n/a | Medium | R1-C1 `integrations` with `scope` (read/write) |
| §5 | Risk policy, diff, QA, approval, staged deploy, live verification, rollback | `autonomy.mjs` (risk classes), seo-check/seo-review, watch (revert proposals) for GitHub sites | Partial: built, autopilot off in production, never exercised live | autonomy tests | none | High | WS-E (M4) on one authorized site |
| §6 | Independent reviewer, not the producer | `seo-review` workflow runs `seo-editor` on drafted PRs | Partial | template tests | never run in production | Medium | R1-C1 `reviews` with `reviewer != producer` constraint |
| §6 | Prompt-injection guard for crawled pages, uploads, search results | rule 3 in agent definitions; no enforcement layer | Partial | agents.test (text) | none | High once submissions exist | R1-C1 submissions stored as untrusted; WS-F tests |
| §7 | Persistent site memory | per-site state on `seo-data` branch (reports, history) and snapshots | Partial: data persists; no decision/strategy memory model | state tests | seo-data branches live | Medium | R1-C1 `site_memory` (private) |
| §7 | Shared non-sensitive knowledge layer; tested promotion with rollback | `knowledge/` playbooks (versioned in git, human-reviewed) | Partial: manual only | agents.test | n/a | Medium | WS-D (M4) |
| §8 | Agency command center (SEO God chat, workforce, jobs, approvals, costs) | portal: sites, approvals (issues), team, brand, share links; PR #31 adds Portfolio and all-approvals | Partial | portal-app browser test | live portal, no live data flowing | High | WS-C after contracts (M3) |
| §8 | Client portal: results + submissions; no chat, approvals, agents, execution | share-link view hides agency pages (`AGENCY_ONLY`); no submissions | Partial | portal-app test | live | High | R1-P2 (WS-C) |
| §8 | No invented KPIs; stale/unavailable labelled | snapshot builder uses only report numbers; integration notes say "not connected" | Partial | portal tests | live | Low | keep; add stale flag (>36 h) |
| §8 | Proactive email | none | Missing | none | none | Medium | needs email provider (OPEN) |
| §9 | Audit logs, signed events, backups, rate limits, cost tracking | rate limits on scan/add; no audit log, cost table or backups policy | Partial | rls3 | none | Medium | R1-C1 audit_log; WS-F |
| §11.1 | Two isolated client workspaces, negative cross-tenant tests | two-org RLS tests | Partial | rls, rls2, rls3 | n/a | | R1-C1 extends to clients and new tables |
| §11.2-10 | Remaining acceptance criteria | see rows above | Missing or Partial | | | | milestones below |

## 3. Department mapping (spec → current)
| Spec department | Current home | Gap |
|---|---|---|
| Research & Intelligence | `research` (4 agents) | none |
| Technical SEO | `technical` (9) | none |
| Content & On-Page | `content` (6) | none |
| Authority & Off-Page | `authority` (3) | none |
| Analytics & Performance | jobs (daily, rank, digest, forecast, experiments) + `seo-reporter` in `command` | no department/lead |
| AI Search & Visibility | `ai-search` (2) | none |
| Automation & Integrations | workflows, `work`, `autopilot`, `release`; `seo-coordinator` in `command` | no department/lead |
| Quality, Risk & Governance | `quality` (3) | none |
| (SEO God) | `command` (coordinator, strategist, onboarder, reporter) | becomes the per-site director layer |
| (verticals) | `verticals` (7 local/ecommerce) | keep as specialist packs (D21) under Research/Content |

Proposal (needs owner OK, no files moved yet): re-home `seo-reporter` to Analytics & Performance and `seo-coordinator`
to Automation & Integrations; keep `command` as the SEO God layer; keep verticals as packs.

## 4. PR integration plan (owner merges)
1. **#33 + #34** together (scanner + hardening; CI green). Production steps after merge need separate go-ahead.
2. **#35** product docs (docs only).
3. **R1 PRs from this plan**, stacked on #34 (below).
4. **#31** portal Style A: valuable (Portfolio, client access, all approvals; all agency-only) but conflicts with #33's
   `index.html` changes; needs a rebase onto #34 and a check that nothing gives clients approvals. Recommend: rebase after
   #33/#34 merge, before the R1 portal work (R1-P2), so the client portal builds on the chosen design.
5. **#23** work evidence: overlaps the job/evidence contracts; mine for ideas, then close or rebase (stale 14 days).
6. **#24** Dependabot: CI uses setup-node v4 while templates already use v7; merge after a green CI run.

## 5. Dependency-aware plan
| ID | Milestone | Scope | Depends on | Status |
|---|---|---|---|---|
| R1-A | M1 | this audit, gap matrix, PR plan, scorecard | — | **this PR** |
| R1-C1 | M2 | shared contracts: clients, memberships (agency roles, client viewers), jobs, job_events, reviews, approvals (agency-only), submissions (untrusted), site_memory, integrations (read/write scope), audit_log; RLS; negative tests; job state machine module | R1-A | **started in this session** |
| R1-O1 | M2/M3 | deploy hardened scanner (after owner go-ahead), then URL onboarding dossier with stated/inferred labels | #33/#34 merged; owner go-ahead | blocked on authorization |
| R1-P2 | M3 | client portal: results + submission inbox; agency inbox with accept/reject/clarify | R1-C1, #31 rebased | not started |
| R1-A2 | M2/M3 | SEO God orchestration: per-site planner writing `jobs`, queue worker with leases, retry caps, budgets, reviewer separation | R1-C1 | not started |
| R1-B2 | M3 | progressive questions + strategy proposal + agency approval | R1-C1, R1-O1 | not started |
| R1-E1 | M4 | one authorized low-risk change on a real site with review, verification, rollback | R1-A2, owner pick of site | not started |
| R1-D1 | M4 | memory promotion pipeline for shared knowledge | R1-C1 | not started |
| R1-F | all | security tests per PR, browser/mobile QA, runbook, backups | continuous | ongoing |

## 6. Release 1 readiness scorecard (2026-11-08)
| Acceptance item | Status | Blocker |
|---|---|---|
| 1 Two isolated client workspaces + negative tests | Partial (agencies isolated; no clients) | R1-C1 |
| 2 URL discovery + dynamic Q&A + approved strategy | Partial (discovery built, not deployed; Q&A missing) | authorization, R1-B2 |
| 3 Autonomous multi-department execution on a real site | Missing (agents never run in production) | R1-A2, keys, owner opt-in |
| 4 Real integrations, least privilege, visible failures | Partial (GSC/GA4/GitHub real; others mocked) | keys |
| 5 Safe change deployed, verified, rollback; high-risk blocked | Unverified (policy built, never exercised) | R1-E1 |
| 6 Persistent memory, safe learning promotion | Partial / Missing | R1-C1, R1-D1 |
| 7 Client portal results + submissions; no chat/approvals | Partial (results only) | R1-P2 |
| 8 Agency reviews client submissions first | Missing | R1-C1, R1-P2 |
| 9 CI, browser/mobile QA, RLS, smoke tests, logs, backups, runbook | Partial | WS-F |
| 10 Accurate status matrix, no fake activity | Partial (registry + this matrix) | keep current |

## 7. Open questions for the owner (recorded, not guessed)
From the register: paid providers, CMS adapter priority, pilot websites, SLA, retention periods, risk thresholds,
agency roles, pricing. New from the audit:
1. Client identity: keep anonymous share links for viewing and add client accounts for submissions, or move clients to
   accounts only? (R1-C1 supports both; the portal default needs a decision.)
2. Email provider for proactive messages (Supabase SMTP is also needed for sign-up).
3. Department re-homing in section 3.
4. Which real site is the first authorized "full management" pilot for R1-E1.
