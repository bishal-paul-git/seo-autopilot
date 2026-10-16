# SEO Autopilot — product build brief for Claude Code
Written: 2026-10-16 UTC / 2026-10-17 Asia/Dhaka.
Status: planning handoff, not implementation or deployment evidence.

## Start here
Read this file, CLAUDE.md, applicable repository instructions, README, CHANGELOG, package scripts, source, migrations/templates and tests before changing code. Inspect the actual repository thoroughly; documentation and previous reviews may be stale. First produce an architecture map and a keep/adapt/replace/defer decision table with exact source paths. Reuse working modules; do not rebuild the engine simply to add a hosted interface.

The owner wants one sellable SEO product, with selected capabilities from Marketing Mouse and News to Blog integrated into SEO Autopilot. The other repositories are sources to evaluate, not instructions to copy entire applications or merge histories. Further owner requirements will follow. For this handoff, no product code has been changed.

## Repositories to inspect
1. Primary: https://github.com/bishal-paul-git/seo-autopilot (main).
2. Marketing Mouse: https://github.com/bishal-paul-git/marketingmouse (main).
3. News to Blog: https://github.com/bishal-paul-git/feed-to-site-magic (main). The repository name differs from the product name.
4. Optional future execution integration: https://github.com/bishal-paul-git/keel (master), especially KEEL-AGENTIC-PLATFORM-BUILD-PLAN.md. Keep Keel a separate product; SEO must work without it.

If a source is inaccessible, record the missing access precisely and continue independent work. Never invent its implementation. Record audited commit SHAs for all three source repositories. Inspect each repository's own instructions and licence before reusing code. Keep appropriate notices and avoid importing credentials or customer data.

## Intended product and customer
Initial customer hypothesis: small agencies managing multiple client websites, including the owner's Erudience sites.
Core workflow: connect an authorised website and Google properties -> collect evidence -> prioritise opportunities -> approve a specific plan -> draft content or technical changes -> review -> publish through a verified adapter -> measure results.

Useful outcome: agencies can show what needs attention, what they approved, what actually changed, and what happened afterwards. SEO/AEO/GEO are measurable areas of work, not promises of rankings or AI citations. News content is optional editorial input, not the whole product.

Start with GitHub-backed sites and one fully proven publishing path. Extend CMS coverage after that. Platform detection is not a working publishing integration.

## Existing primary engine to understand
At this review, package.json says v2.13.0 and MIT. Verify the current state.
Inspect bin/, src/, agents/, playbooks/, knowledge/, schema/, templates/, engines/, docs/, test/ and GitHub workflow templates.
Particularly inspect:
- src/lib/google-auth.mjs, gh.mjs, ingest.mjs, llm.mjs, feed.mjs and serp.mjs.
- src/analysis/agent-router.mjs and src/jobs/audit.mjs, then all jobs and their storage contracts.
- docs/expert.md, agents.md, engines.md, jobs.md, content-automation.md, dashboard.md, measurement-and-compliance.md.
- templates/dashboard-supabase/ and its migrations/security assumptions.
- Node tests, Python tests and Go crawler tests; discover the actual commands.

Existing areas include GSC/GA4 reporting, audits, keyword/opportunity analysis, site profiling, indexing checks, speed checks, content workflows, RSS, experiment reporting and citation tracking. Agent Markdown definitions and deterministic routing do not prove independent workers exist. Optional SDK agents, mock citation-provider tests, dashboard templates and local UI are not proof of a hosted multi-tenant service. Distinguish fixture-tested, live-tested, scaffolded and proposed functionality.

Preserve useful CLI/GitHub Actions operation and its lightweight dependency model. Put hosted concerns behind clear interfaces; do not force commercial web dependencies into the CLI without a documented reason.

## What to evaluate from Marketing Mouse
Inspect package.json, src/routes, auth, database client boundaries, Supabase migrations/config and these modules:
- src/lib/projects.functions.ts and connections.functions.ts.
- gsc.functions.ts, gsc-extras.functions.ts, ga4.functions.ts and google-token.server.ts.
- keyword-research.functions.ts, dataforseo.functions.ts and competitors.functions.ts.
- llm-visibility.functions.ts, site-scrape.functions.ts, research.functions.ts and content.functions.ts.
- ai-gateway.ts, openrouter.ts and mock-data.ts.

Candidates: dashboard/navigation, project onboarding, connection management, keyword/research views, competitor views, content workspace, reporting.
For each, identify actual provider calls, mocks, missing credentials, ownership checks, token refresh, pagination, error handling and tests. Do not ship mock numbers as real analytics. Compare competing Google auth/data implementations and choose one well-tested contract rather than maintaining two hidden sources of truth.

## What to evaluate from News to Blog
Inspect src/routes, migrations, jobs/scheduling, permissions, credentials and:
- src/components/GenerationWorkspace.tsx and AutopilotDialog.tsx.
- src/lib/feeds.functions.ts, feeds-management.functions.ts, saved-feeds.functions.ts and feed-catalog.ts.
- generate.functions.ts, refine.functions.ts, editorial-cleanup.ts, default-prompts.ts and persona-templates.ts.
- autopilot.functions.ts, budget.functions.ts, limits.functions.ts and usage.functions.ts.
- publish.functions.ts and src/lib/publishers/ (WordPress, Ghost, Webflow, webhook and others).
- api-tokens.functions.ts, team.functions.ts and project scoping.

Candidates: source collection, editorial queue, brand/persona configuration, article editor, budget control and publishing adapters.
Verify each adapter against real authorised staging destinations before advertising support. Check scheduler authentication and replay protection at both route and deployment layers; do not assume a public tick endpoint is protected elsewhere.
Feed material is untrusted input: source attribution, canonical URLs, duplication checks, factual review and prompt-injection boundaries are required. Generate original useful material; do not republish whole source articles or assume a feed grants republication rights. Keep third-party source content separate from trusted instructions.
Do not import broad auto-publishing defaults. Default to approval before external changes.

## Architecture decisions to settle before building
Write decisions with alternatives and migration implications:
- Hosted app boundary vs reusable CLI/analysis engine; retain current implementation where viable.
- Workspace -> client -> site -> environment model; membership roles and verified ownership.
- One durable metadata store for connections, property bindings, audit runs, findings, content, approvals, publications, measurements, costs and audit events.
- Credential storage, encryption/key management, scoped OAuth, revocation and refresh; server-only privileged credentials.
- Durable jobs with atomic claims, leases, retries/backoff, idempotency, cancellation and recovery after restart.
- Typed engine inputs/outputs and publishing interfaces; version results with source timestamp and evidence.
- Access boundaries for every server endpoint and background job. RLS alone is insufficient if the server uses a service-role client.
- Existing installation migration/import and compatibility; no destructive schema replacement.
- Agent execution vs deterministic work: use code for collection/checks/routing; models for bounded reasoning and drafting.
- Costs including crawling, SERP, AI, storage, hosting and retries, not only model tokens.

Proposed records (adapt to existing schema): workspaces, memberships, clients, sites, connections, property_bindings, runs/jobs, findings, recommendations, sources, content_drafts, change_sets, approvals, publications, measurements, usage_events, audit_events.
Every tenant-owned record must have a verifiable ownership chain. External IDs must bind to the intended site/property/account.

## Ordered phases and acceptance gates
### Phase 0 — baseline and reuse audit
Map source and data flows; identify current deployable units, live dependencies, mocks, duplicated services and licence constraints. Run existing relevant checks in a clean environment. Record failures honestly without weakening tests. Produce baseline, reuse matrix and architecture decisions before importing code.
Gate: reviewer can trace onboarding -> evidence -> recommendation -> approval -> publication -> measurement with exact current/missing paths.

### Phase 1 — hosted foundation
Implement only missing workspace/client/site/auth/role boundaries, secure connections and durable jobs. Support multiple client sites, isolate tenants, and show connection health/reconnect states.
Gate: two separate workspaces cannot read or mutate each other's data through UI, direct endpoint or worker paths; restart/retry does not duplicate jobs.

### Phase 2 — evidence dashboard
Expose engine results in the best reusable dashboard components: GSC/GA4 metrics, technical findings, near-miss queries, decay, content gaps and prioritised actions. Show data freshness, source property, permissions and insufficient-data states.
Gate: a real authorised site shows traceable data; absent access yields a clear empty/error state rather than demo metrics.

### Phase 3 — content and research workspace
Adapt selected News to Blog/Marketing Mouse capabilities into one editorial workflow: source shortlist -> brief -> original draft -> brand/factual/internal-link review -> approval.
Include editable site/brand knowledge, audience, goals, exclusions and references. Add deduplication and existing-content/cannibalisation checks before creating a new article.
Gate: a reviewer can compare a draft to its sources, edit it and reject it without publishing.

### Phase 4 — verified changes and publishing
First support one GitHub-backed site with branch/PR/check evidence and one proven content path. Each approval binds to exact revision, destination, operation and schedule; edits invalidate approval. Technical audit findings need actual verified fixes, not just a generated suggestion.
Use idempotency and external receipt IDs. Handle partial failure and reconciliation without duplicate posts. Document rollback limits, especially external CMS changes.
Gate: authorised staging publication, duplicate retry, failed check, changed draft and wrong destination tests all behave correctly.

### Phase 5 — measurement and bounded agents
Compare baselines/windows and report uncertainty, seasonality and data lag. Mark experiment results directional unless causal design justifies more.
Add bounded analyst/planner/writer/reviewer/monitor responsibilities only where useful. Roles need not be separate model processes. Human approval gates remain enforced by server code.
Gate: every completed task has evidence, cost, actions, errors and a user-visible outcome. No recursive unbounded spending or autonomous backlink outreach.

### Phase 6 — agency operation and pilot
Client-facing reports, permissions, notification preferences, usage quotas, billing readiness and support diagnostics. Start with the owner's sites, then a small paid pilot.
Gate: demonstrate a complete cycle with actual publication and measured follow-up; collect willingness-to-pay evidence before widening the integration list.

## Scope and commercial assumptions
One product in this repository; do not automatically delete/archive the two source repos. No full app rewrite, new brand decision, live customer migration, purchases or production deployment is authorised by this brief alone. Later explicit owner implementation instructions define execution scope.
Possible paid value: hosting, multi-client operations, approvals, scheduled execution and reporting/support. MIT engine remains subject to its existing licence; do not assume exclusivity over open code.
Earlier suggested prices were hypotheses, not validated demand. Measure cost per active site and completed approved action; cap quotas and avoid unlimited promises.

## Build reporting and review
Follow CLAUDE.md. Maintain docs/implementation/STATUS.md as the first review entry point, plus CHANGELOG.md and DECISIONS.md under that directory. Include source commits, implemented vs tested vs deployed state, test evidence, integration access gaps and exact next step.
This file records intended direction, not proof of feature completion.

## Prompt to start a new Claude Code session
Read SEO-PRODUCT-BUILD-BRIEF.md and CLAUDE.md completely. Inspect SEO Autopilot thoroughly and audit the linked Marketing Mouse and News to Blog repositories. Map what exists and produce a source-path-based reuse matrix and phased implementation proposal. Check current branches, instructions, licences, tests, data ownership and live-vs-mock integrations. Do not import complete apps or start a rewrite. Update docs/implementation/STATUS.md with your findings and proposed next milestone. For this initial session, stop after the audit/proposal unless I explicitly ask you to implement. When implementation is authorised, work on a feature branch, reuse existing modules, verify one milestone at a time and maintain the handoff files.
