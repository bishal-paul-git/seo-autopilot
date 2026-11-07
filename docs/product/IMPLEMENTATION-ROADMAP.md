# SEO Autopilot — Claude Implementation Roadmap and Audit Checklist
Status: PLANNED. This document authorizes NO production changes.
Companion docs: SEO-GOD-MASTER-SPEC.md and DECISION-QA-REGISTER.md.

## 1. Mandatory first action: evidence-based read-only audit
Inspect actual main branch and active PRs (not just stale STATUS docs). Record commit SHA/date, open PRs, CI checks and workflow history. Read AGENTS.md if present, docs/implementation/STATUS.md, CHANGELOG.md, decisions, architecture/security/deployment docs, registry and test matrix. Inventory Node jobs, agent definitions vs real runnable agents, workflow schedules, provider adapters, portal routes, scanner, Supabase migrations/functions, permissions, secrets boundaries and existing live deployments. Review PR #33 (D25 URL scan) and #34 (D26 hardening) together; don't assume merged/deployed. Verify against live Supabase/Hostinger/GitHub only with authorized read-only access. Record access blockers explicitly.
Deliver: audit table [requirement | existing code path | status verified/partial/missing | tests | live evidence | risk | recommended action]; deployment inventory; security findings; prioritized blockers. Never label mock tests as real-provider tests.

## 2. Shared contracts and invariants (first engineering milestone)
Define tenant, client, site, SEO God, department, agent, skill, tool, strategy, job, event, evidence, review, approval, integration, submission, memory, learning version and deployment. Define lifecycle state machines, API schemas, permission matrix, RLS and negative tests. Separate client-readable projection from internal operational records. Event and audit schemas must support attribution, retries, provenance, budgets and rollbacks.
Exit: documented contracts + tests + migration plan without breaking existing interfaces.

## 3. Coordinated parallel workstreams
### A — Autonomous orchestration
- Inventory/reuse existing jobs and 38 agent definitions. Map to eight departments and role registry; record manual vs scheduled vs actually autonomous.
- Implement site-specific SEO God planning, department delegation, execution scheduling, job queue, bounded retries, budgets, recovery, priority, evidence and independent review.
- Distinguish real running agents from metadata. No simulated activity. Verify multiple sites concurrently.
### B — Intelligent onboarding
- Harden/reuse D25/D26 scanner with SSRF, DNS, redirects, robots, size/time limits.
- Extract brand assets and business facts with provenance; competitor/market research and initial audit.
- Progressive personalized questions, dossier and initial strategy proposal with agency approval.
- Read-only mode by default; write mode separately authorized.
### C — Agency and client portals
- Preserve existing portal functions and design where verified. Add agency HQ, per-site SEO God chat, workforce/job visibility, approval queue, integration health, reports.
- Client reporting: performance, rankings, completed/planned work, opportunities, reports and submissions/status; NO client SEO God chat, internal agents, approvals or execution.
- Client submission types: plan, document, keyword, file, suggestion, feedback. File validation/scanning, site scope, agency queue and audit history.
### D — Memory and learning
- Private site memory and controlled shared verified non-sensitive knowledge.
- Decision/evidence/experiment history; source provenance; retention/backup.
- Tested, independent, versioned improvement promotion with monitoring and rollback; no self-permission escalation.
### E — Providers and verified changes
- GSC, GA4, GitHub, crawler/sitemap, Bing Webmaster, Sheets. Inventory existing connectors before adding. Scope credentials per site.
- Risk classifier, diff/previews, independent QA, approval gates, staged deploy where supported, live checks, rollback.
- Verify real provider integration with test accounts; mark mocks separately.
### F — QA, security and operations
- RLS/tenant isolation, auth, least privilege, prompt-injection resistance, SSRF, upload scanning, logging, CI, browser/mobile QA, disaster recovery, cost and rate limits, email/dashboard notifications.
- Independent reviewer cannot approve its own work. Review failures have bounded correction and escalation.

## 4. Milestone and merge gates
M1 Audit + stabilization: full evidence inventory, blockers, CI green, safe PR integration plan. No production writes.
M2 Contracts + orchestration: working job lifecycle, independent QA, memory persistence, two-site isolation tests.
M3 Onboarding + portal integration: real URL onboarding → personalized Q&A → agency-approved strategy; client submissions and reporting, with strict role boundaries.
M4 Authorized execution + learning: one real safe website change with QA/monitor/rollback, verified memory and shared learning tests.
M5 Agency release hardening: multiple clients/sites, real data/providers, operational monitoring, access control, end-to-end browser/mobile and negative security tests.

## 5. Required acceptance tests (minimum)
- Client A cannot read Client B metrics, jobs, files, conversations, embeddings or submission records.
- Client cannot access SEO God chat, agency approvals, admin endpoints, tool calls or site modification APIs even with crafted HTTP requests.
- Client-submitted document containing instructions to execute changes is stored as untrusted reference, reviewed, never executed without agency approval.
- No job executes a strategy before agency approval; no high-risk change executes without agency approval.
- Agent failure retries capped and escalated; duplicate event does not duplicate deployment.
- SEO God learning cannot access another site's private memory, increase budgets or register unauthorized tools.
- Real integration failures, stale data and missing permissions are visible and do not generate invented metrics.
- Scanner blocks internal network targets and unsafe redirects and honors robots rules.
- Approved low-risk change follows review, verified deploy and monitoring; failure triggers tested rollback/manual escalation.
- Agency/client portal tested on desktop and mobile; all displayed activity corresponds to actual stored events.

## 6. Development discipline for Claude
1. Read all three product docs and latest repo instructions before coding.
2. Produce gap matrix and dependency-aware issue/PR plan first.
3. Small branches/PRs; no merge to main or production deployment without explicit owner authorization.
4. Do not alter existing client data, live provider secrets, Hostinger portal, Supabase production, workflows or schedules during audit.
5. Tests must be run and reported with exact command, environment, outcome and commit. Never assert real-key/provider tests from fixtures.
6. Update docs/implementation/STATUS.md and change log with verified state, links, blockers, next steps and exact commits. If a live activity log is used, create/maintain it consistently without duplicating source of truth.
7. For each PR: scope, affected modules, migration/backward compatibility, security risks, screenshots if UI, tests, deployment steps, rollback and owner approvals required.
8. Maintain a traceability table from each master-spec requirement to code, tests, deployment and operational evidence.
9. Escalate ambiguous product choices instead of inventing permissions or provider spending.
10. Finish with an agency release readiness scorecard showing blockers, not just feature count.

## 7. Known historical audit leads (must reverify)
- Prior STATUS on main (dated 2026-11-03) claims 474 tests passing, but browser login and daily site push unverified.
- docs/agents.md describes 38 agents; most are manual, first six tied to unattended workflows.
- PR #33 introduces URL-only hosted scan and SQL; PR #34 hardens security and adds registry/docs; PR descriptions report 481/498 tests respectively but are not independent verification.
- Prior PR text says D25 migration and function deployment incomplete; recheck current live state.
- Supabase project identified in historical docs as ymwwwhdlyjnqbxxhtcew; verify authorization before inspection. Never expose keys in logs.
- Existing portal: seo.erudience.com; do not assume current deployment matches PR code.
