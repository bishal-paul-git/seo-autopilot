# SEO Autopilot — SEO God Master Product & Architecture Specification
Status: APPROVED REQUIREMENTS / IMPLEMENTATION NOT VERIFIED
Date: 2026-11-08
Owner: Product owner; execution by Claude Code and development team
Source of truth for product intent: this specification plus DECISION-QA-REGISTER.md. Current code and deployment status must be independently audited.

## 0. Non-negotiable product intent
Evolve the EXISTING seo-autopilot repository, preserving verified functionality. Do not rewrite blindly, merge unreviewed PRs, modify live production, buy tools, or expand provider permissions without explicit authorization. First release: **agency-ready multi-client autonomous SEO platform**; later self-service SaaS. Develop core engine, onboarding, command center and supporting infrastructure in coordinated parallel workstreams, using shared interfaces and integration gates.

SEO Autopilot is a real, operating AI SEO department, not a simulated team UI. Each website has an independent SEO God (AI Director) managing eight departments, department leads, specialists, jobs, skills, procedures, memory, research, quality assurance and strategy. The agency owns administrative control.

## 1. Tenancy, identities and boundaries
- Agency workspace owns clients; clients own one or more websites; each website has its own SEO God instance and private operational context.
- Client users: **reporting and submissions only**. They may view balanced SEO performance, rankings, work, opportunities, reports, and their submission status. They may submit plans, docs, keywords, files, suggestions, and feedback. They cannot chat with SEO God, issue operational commands, approve strategies, change websites, inspect internal agents, modify integrations or budgets.
- Agency administrators/staff: role-based access to websites, SEO God conversations, workforce, approvals, integrations, execution, reporting, and client submissions. **Only agency authority approves strategies and high-impact/destructive changes**.
- Client submissions are untrusted advisory inputs, never instructions or triggers for autonomous execution. Submission → validation/file scan → private SEO God research and recommendation → agency review/discussion → accept/reject/request clarification → approved work joins normal pipeline. A client's submission must never silently change strategy or create execution.
- Enforce server-side authorization, tenant isolation, per-site scoping, RLS and audit records. Never rely on UI-only hiding. Prevent cross-tenant retrieval in search, vectors, caches, logs, reports, and shared skills.

## 2. AI organization
- Independent SEO God per website: objective/strategy owner, opportunity prioritization, departmental delegation, resource allocation within limits, adaptive planning, decisions, progress and proactive reporting.
- Eight departments: (1) Research & Intelligence, (2) Technical SEO, (3) Content & On-Page SEO, (4) Authority & Off-Page SEO, (5) Analytics & Performance, (6) AI Search & Visibility, (7) Automation & Integrations, (8) Quality, Risk & Governance.
- Department leads coordinate specialist work; specialists execute bounded tasks using approved skills and tools. Temporary subagents may be created for scoped tasks.
- Target conceptual specialist capabilities (not a claim they exist): Research: keyword, competitor, SERP, opportunity, trends. Technical: site audit, indexing/crawl, performance, schema, technical fixes. Content: planning, research, drafting, on-page, internal links, refresh. Authority: backlink intelligence, opportunities, digital PR, outreach, brand mentions. Analytics: GSC, rankings, traffic/conversions, reporting, anomaly detection. AI Search: AI visibility, entities/brand, citation research, AI content readiness. Automation: orchestration, scheduling, integrations, recovery, knowledge/memory. Quality: SEO review, fact/content review, technical change review, security/policy, compliance/audit.
- Do not require a separate always-running model instance for every role. Distinguish agent *definition*, *registered capability*, *scheduled job*, *running execution*, *verified outcome*. Existing repository reportedly has 38 agent definitions, most manually invoked; verify rather than presenting them as autonomous.
- SEO God may create/adjust agents, skills, procedures and workflows **only within preapproved execution permissions and budgets**, with independent tests/review, versions and rollback. It cannot change platform infrastructure, self-grant credentials, purchase services, or override policy.

## 3. Planning, decision authority and execution
- Progressive website research and personalized onboarding culminate in a proposed initial SEO strategy, requiring agency approval before execution.
- Once approved, SEO God autonomously adapts tactics and routine strategy within objectives, scope, budgets and risk boundaries; material strategy changes are surfaced to agency for approval as policy requires. Reviews are adaptive, based on evidence/events, not a fixed-only calendar.
- Jobs can be scheduled, event-triggered, on-demand, or generated by SEO God/leads. Prioritize explicit owner requests, critical maintenance, then high-value opportunities. Include deduplication, dependencies, leases, concurrency limits, idempotency, retry caps, timeouts, cost caps, escalation.
- Every job: tenant/site, request source, actor, agent/skill version, objective, priority, inputs/provenance, tools/permissions, cost/time budgets, dependencies, status, attempts, evidence, outputs, reviewer decision, approval, deployment and rollback references.
- Recommended lifecycle: proposed → scoped → queued → running → awaiting_review → awaiting_approval (if needed) → authorized → deploying → verifying → completed; failure/cancel/reject/escalate paths. Never let rejected or unapproved jobs execute.
- Failure handling: autonomous diagnosis, bounded repair/retries, independent re-review, escalation after cap. No endless retry or unbounded cost.

## 4. Website discovery and onboarding
- Start with URL and progressive public discovery; crawl safely respecting robots.txt, request limits, timeouts, SSRF/redirect/DNS defenses and provenance. Investigate homepage, navigation, key pages, sitemaps, robots, structured data, public brand assets, logo/favicon, colors, typography, business messaging, services/products, locations, social accounts, audience, competitors, SERPs, technical health and market context.
- Use affordable/open-source Python/Node utilities where justified; tool choice belongs to developers/platform owner. Optional paid tools only after owner approval.
- Clearly label verified facts vs inference vs unknown; never fabricate business identity, performance or assets. Present source URLs and extraction confidence.
- Dynamically ask ONLY relevant unanswered business questions, progressively alongside research: goals, target geographies, products/services, customer personas, conversions, priorities, restrictions, brand voice, competitors, capacity, compliance, publishing and access permissions.
- Produce website dossier, brand profile, baseline technical/SEO audit, market/opportunity analysis, initial proposed strategy with KPIs, risks, resource estimate and explicit agency approval gate. Support read-only and separately authorized full-management modes.

## 5. Integrations and change execution
Initial requested integrations: Google Search Console, GA4, GitHub, website crawling/sitemaps, Bing Webmaster Tools, Google Sheets. CMS providers such as WordPress/Shopify are not assumed approved; recommend connectors where necessary but do not silently add them.
- Separate data-read scopes from write scopes; GSC connection never implies website modification rights.
- SEO God can perform **low-risk, authorized** SEO modifications automatically within an approved strategy, after appropriate tests and independent QA.
- High-impact, destructive, site-wide or business-critical changes require agency approval. Risk policy must classify e.g. mass redirects/deletions, robots/noindex changes, large-scale page edits, site migrations, critical page modifications, external outreach/publication, permissions changes.
- Deployment: generate change proposal/diff → validate technical/SEO/brand/security constraints → independent review → approval if risk policy requires → staged/verified deploy through authorized adapter → live verification → monitoring → safe rollback if regressions. Maintain immutable evidence and rollback references.
- Never claim rollback is possible where the integration has no supported reversible mechanism; require safer manual approval/backup.

## 6. Independent reviewer and quality
- Independent reviewer must not be identical to producing execution/context. Risk-based review for changes; routine automated validation for read-only jobs and periodic sampling.
- Check source quality, factual grounding, content quality, SEO policy, site compatibility, security, tenant scope, change impact, tests, permissions and business constraints.
- Failed review → bounded correction/retest → escalate. Record rationale, reviewer identity/version and evidence. Guard against prompt injection in crawled pages, client uploads, search results, issue text and external content.

## 7. Organizational memory and learning
- Full persistent site-specific memory: identity, brand, strategy, objectives, decisions, experiments, agent work, workflows, job evidence, analytics, outcomes, reviews, approvals, skills and prior failures.
- Shared knowledge layer: ONLY verified, generalized, non-sensitive reusable lessons, procedures, skills and methods. No confidential client strategy, credentials, identifiable metrics or private files crossing websites.
- Autonomous learning pipeline: observe outcomes → propose improvement → test on fixtures/sandbox → independent evaluation → version → safe gradual promotion within authorized scope → monitor → rollback on regression. Track provenance, applicability and efficacy.
- No self-approval of permissions, infrastructure changes, vendor purchases or spend increases. Owner/developers choose paid providers and platform architecture.

## 8. Agency command center and client portal
Internal command center: conversational SEO God for authorized agency staff, per-site and portfolio views, eight departments and specialist roster, real job timelines, decisions, tools, evidence, queues, approvals, experiments, learning versions, audit trails, integration status, costs, errors and outcomes. Premium professional brandable agent fleet visual concept, never fake live agents.
Client portal: balanced performance dashboard (GSC/GA4 where connected), rankings, completed/planned work presented appropriately, opportunities, reports and submission inbox/status. No internal agent operations, SEO God chat, change/strategy approvals or direct execution controls. Do not show invented KPI data; clearly label stale/unavailable metrics.
Proactive adaptive communication via dashboard and email only initially; meaningful failures, strategy shifts, agency approvals, anomalies and reporting. Avoid routine-notification spam.

## 9. Security, cost, operations
- Role/tenant/site authorization for every API, job, file, vector query, tool, integration and report. Secrets server-side only, scoped and rotated. RLS tests, audit logs, signed events/webhooks, encryption, retention, backup/restore and recovery.
- Sandbox generated code, restrict file/network access, validate URLs, cap crawls and provider usage, enforce rate limits, monitor queue and worker health.
- Cost: performance-first within platform-owner-approved paid tools and budgets. SEO God may recommend additional services but cannot buy/connect them.
- Observability: per-agent/job event log, traces, failures, tool/provider usage, cost, quality metrics, outcomes, alerts, SLA/latency and reliability.

## 10. Parallel implementation workstreams
A. SEO God engine & orchestration; B. progressive onboarding; C. interactive agency/client portals; D. memory/learning; E. integrations/verified website execution; F. QA/security/operations.
Shared contracts first: tenancy/site IDs, actors, capabilities, jobs/events, permissions, reviews/approvals, memory/evidence, adapters, audit logs, status. Coordinate via integration tests, not isolated UI demos.

## 11. Release 1 acceptance (agency-ready)
1. Two or more isolated client workspaces with independent websites/SEO Gods; negative cross-tenant access tests.
2. URL-only discovery and dynamic Q&A, evidence-backed strategy proposal and agency approval.
3. Autonomous multi-department execution on a real authorized site, with actual jobs, independent review, evidence and reporting.
4. Real selected integrations with least privilege, observable failures and cost controls; distinguish unconnected integrations.
5. At least one safe authorized website change deployed and verified with demonstrated rollback/recovery path; high-risk change blocked until agency approval.
6. Persistent memory across restarts; safe, tested improvement promotion and rollback; no private cross-site leaks.
7. Client portal results, keywords, opportunities, completed work, reports and proposal/document/keyword/file submission; client cannot chat with SEO God or approve/trigger jobs.
8. Agency receives and reviews client submission before it can become executable work.
9. CI, browser/mobile QA, RLS/security tests, provider smoke tests, logs, backups and incident runbook.
10. Accurate implementation-status matrix and production evidence; no fake agent activity or metrics.

## 12. Exclusions and later stages
Self-service SaaS sign-up/subscription billing, autonomous vendor purchases, unlimited platform-level self-modification, mandatory WhatsApp/Discord, client SEO God chat, and unrestricted client execution are OUT of Release 1 unless separately approved.

## 13. Instruction to implementer
Read this document, DECISION-QA-REGISTER.md, IMPLEMENTATION-ROADMAP.md, current AGENTS.md/STATUS, PRs and actual code. Audit first; propose architecture/contracts and smallest safe increments. Work in feature branches/PRs, preserve working production, verify each change and log evidence. Never treat aspirational requirements as implemented capabilities.
