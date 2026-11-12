# Decisions

## 2026-10-18 Phase 0 architecture decisions (PROPOSED, awaiting owner review; nothing is built)
Evidence: `PHASE-0-AUDIT.md` (same folder). D1 to D11 were written from the SEO Autopilot audit. D12 to D15 were added after Marketing Mouse, News to Blog and Keel were audited later the same day (PHASE-0-AUDIT §5). Neither source audit overturned D1 to D11. Nothing here commits to a vendor or spends money.

**D1 Hosted boundary.** The hosted app is a separate package (proposed: `cloud/` in this repository, with its own `package.json`, excluded from the npm `files` list). It calls the engine through a typed job contract; the engine is never rewritten into the app.
- Stage 1: a worker runs the unchanged CLI (`bin/seo-autopilot.mjs run <job> --site <id>`) in an isolated temp directory. Config is rendered from DB rows and credentials are injected as env. The worker reads the JSON reports and stores them as versioned results (job, engine version, site, source window, generatedAt, input hash).
- Stage 2: add a `StateStore` seam to `src/jobs/*` so jobs read and write through an interface; the file store stays the CLI default. The core stays dependency-free.
- Alternatives: (a) rewrite the analysis in the app's language, rejected because it means two sources of truth and loses the tests. (b) GitHub App only, with no servers (brief 07 option a): cheapest, but repository sites only and no central evidence store. Recommended as the first *distribution* mode, not the hosted product.
- Migration: none for CLI users.
- Web stack and where jobs execute: see D13.

**D2 Tenancy and ownership.** Model: workspace → client → site → environment (production, staging).
- `memberships(workspace_id, user_id, role)` with roles owner, admin, editor and viewer, plus optional client-scoped grants for agency staff and client viewers.
- A site is *verified* only by evidence stored with method and time. Options: the Search Console API returns the property with `siteOwner` or `siteFullUser` for the connected Google identity; a GitHub App installation on the repository with admin permission; or a DNS TXT token.
- `property_bindings(site_id, provider, external_id, verified_at, method)` ties GSC, GA4 and repository IDs to one site. A job refuses to run against an unbound or unverified external ID.
- Alternative: trust the configuration, as the CLI does today. Acceptable for a single owner, unacceptable for agencies.

**D3 One metadata store.** Postgres, as the single source of truth for: workspaces, memberships, clients, sites, connections, property_bindings, jobs, runs, findings, recommendations, sources, content_drafts, change_sets, approvals, publications, measurements, usage_events and audit_events.
- Every tenant row carries `workspace_id`. Child tables use composite foreign keys `(workspace_id, parent_id)` so a row cannot point at another workspace's parent.
- Results are append-only with engine version and source timestamps.
- Supabase is acceptable (Postgres plus auth). The existing `templates/dashboard-supabase` schema is **not** a base, because it is single-tenant (audit F5).
- Alternatives: keep state in each customer's `seo-data` branch (no cross-site view, no audit trail, force-pushed history); a document store (weaker integrity for the ownership chain).

**D4 Credentials.** Credentials stay on the server and are never sent to the browser.
- Google: OAuth with the minimal read scopes `webmasters.readonly` and `analytics.readonly`. Store refresh tokens encrypted with envelope encryption: a data key per workspace, wrapped by a KMS or secret-manager key kept outside the database (Supabase Vault or a cloud KMS; vendor open). Refresh on use, record failures as connection health, revoke on disconnect.
- The service-account JSON stays supported (encrypted the same way).
- GitHub: App installation tokens (short-lived, per repository), never personal tokens.
- AI keys and provider keys are bring-your-own, stored encrypted, and used only inside the worker job that needs them.
- Engine change needed: `src/lib/google-auth.mjs` accepts an injected access-token provider.
- Alternative: plain DB columns protected by RLS. Rejected: a service-role leak exposes every token.

**D5 Durable jobs.** A Postgres job table, claimed with `FOR UPDATE SKIP LOCKED`.
- Columns: `lease_expires_at`, heartbeat, `attempts`, `max_attempts`, exponential backoff with jitter, a unique `idempotency_key` (for example `site:job:window`), `cancel_requested`, and a terminal status with an error.
- A reaper re-queues expired leases after a restart.
- Side-effecting steps (publish, open PR) are separate jobs keyed by change-set hash, so a retry cannot duplicate them.
- The scheduler tick is authenticated with an HMAC over timestamp and nonce, rejected outside a five-minute window, and the nonce is stored to block replay. The platform cron secret is not trusted alone.
- Alternatives: pg-boss or Graphile Worker (fine; the hosted app may have dependencies); cloud queues (another moving part); GitHub Actions as the executor (stage-1 option for repository sites only).

**D6 Access boundaries beyond RLS.**
- Every endpoint resolves user → membership → workspace and checks the role *before* any query, using a user-scoped DB client where possible.
- The service-role client is allowed only in workers. Workers take `workspace_id` from the claimed job row and assert it on every query.
- RLS stays on as a second layer.
- Required tests for the Phase 1 gate: for each endpoint and worker, a second workspace cannot read or mutate through the UI, the direct API or a forged job payload.

**D7 Publishing interface and approvals.**
- Interface: `Publisher.plan(changeSet) → diff`, `apply(changeSet, approval) → receipt`, `verify(receipt) → live state`, and optional `rollback(receipt)`.
- An approval stores the SHA-256 of the canonical change set plus destination, operation and schedule. `apply` recomputes the hash and refuses on mismatch, so any edit invalidates the approval.
- First adapter: GitHub PR, built from the existing `seo-implement` path. The receipt is PR number, head SHA, check conclusion and merge SHA.
- Auto-merge is never available in the hosted product (audit F1).
- WordPress comes second, after the gate (brief 06 via brief phase 4).

**D8 Agents vs deterministic work.** Unchanged from the engine. Code handles collection, checks, routing, approval and publishing. Models handle bounded reasoning and drafting, with turn and budget caps and a recorded cost. Roles need not be separate processes.

**D9 Cost model.**
- `usage_events(workspace_id, site_id, job_id, provider, unit, quantity, unit_cost, cost_source)`. `cost_source` is one of `provider_reported`, `price_sheet_YYYY-MM-DD` or `estimate`.
- Categories: crawl (fetches and bytes), Google API quota, SERP calls, AI tokens, storage, compute minutes and retries.
- Hard quotas per workspace; stop and report when reached.
- No prices are stated anywhere until measured. KPI: cost per active site and per completed approved action.

**D10 Migration and compatibility.** CLI and GitHub Actions users are unaffected. An importer reads a repository's `seo-data` branch into the hosted store, as read-only historical results. No destructive change to existing templates. The Supabase example stays as is.

**D11 OSS approval semantics (owner decision).** Owner to choose one:
- (a) keep `seo-automerge.yml` and `seo-release.yml` as they are, documenting that they do not meet the hosted product's approval standard;
- (b) deprecate auto-merge and make release open a PR;
- (c) keep both, and add an approver-permission check to `seo-implement.yml` (audit F2).

Recommendation: (c) now, then (b) at the next minor release.

**D12 One Google data contract (decided by the source audit, PHASE-0-AUDIT §5).** This engine's Search Console and GA4 code (`src/lib/google-auth.mjs`, `src/jobs/daily.mjs`) is the single source of truth. Marketing Mouse's derived metrics are ported into `src/analysis/` with tests; its token handling and queries are not. Reasons:
- MM fetches tokens without ownership checks (M2).
- MM uses a platform-wide connector (M4).
- MM pages less and has no tests.

**D13 Hosted UI stack and the execution split (proposed).** Use TanStack Start, React and Supabase for the hosted UI and API, because the reusable UI from both source apps is written in it. The server layer is new and follows D6; neither app's server functions are carried over (M1, N1, N2).
- Engine jobs do **not** run in Cloudflare Workers: the CLI spawns git, Go and Python, and writes files. Jobs run in a separate Node worker (a container or VM) that claims jobs from Postgres (D5).
- Alternatives: a plain Node server (fewer moving parts, but the UI would have to be rewritten), or the Workers runtime only (cannot run the engine).
- Cost: one more deployable unit.

**D14 Source code provenance.** Code copied from Marketing Mouse or News to Blog comes in only as small reviewed files, adapted to this repository's style, with tests. The owner must confirm in writing (in this file) that they own that code and relicense it under MIT, because neither repository has a licence. Lovable-generated scaffolding is acceptable once the owner confirms the platform's terms allow it.

**D15 Security issues in the source apps (owner decision, outside this repository).** M1 to M5 and N1 to N6 are live risks *if those apps are deployed*; this audit could not tell whether they are. Recommendation: the owner checks whether they are deployed and, if so, restricts them (fix N1 and N2 first, then M1 and M2) or takes them offline, before marketing them. This repository will not copy their server code, whatever is decided.

**Keel:** separate product; see PHASE-0-AUDIT §5.3. No code dependency in either direction.

## 2026-11-08 D37 Verified execution through the site's own GitHub workflow (R1-E1)
**Context:** the spec's execution chain (§3, §5): approved work must reach the website through a reviewed, verified and reversible change. The owner asked for build progress without new platforms. Sites that run SEO Autopilot already have `seo-implement.yml`. It drafts a pull request from an approved issue, edits content files only, never runs builds, and passes through `seo-check`, `seo-review` and the merge policy of D17.

**Decision:**
- The hosted SEO God never edits a website. For a site with a connected repository, the agency picks a recommendation from accepted advice ("Prepare a pull request"). A deterministic work order is drafted, which is free and needs no approval to start. The agency approves that exact text (the D35 adoption pattern).
- On approval, the scheduler opens an issue in the site's repository (labels `seo-proposal`, the change kind, `seo-hosted`) and starts `seo-implement` with that issue. The issue number is saved before the workflow starts, so a retry never opens a second issue.
- It then follows the pull request on branch `seo/issue-<n>`.
  - Merged: move to verifying and request a fresh scan.
  - Closed unmerged, or no pull request after 7 days: escalate to a person.
  - Open: wait, because the merge stays with a person or the site's policy.
- Verification compares the page's problems in the first scan after the merge with the baseline taken when the issue was opened. New high-severity problems escalate, naming the pull request to revert. Otherwise the job completes with what was fixed.
- Credentials (rule 6): the agency's own fine-grained token for that one repository (Issues and Actions read/write; Pull requests and Metadata read).
  - It is stored in Supabase Vault. Only an agency owner can set or remove it.
  - Only the service role can read it, and only for a connected site. It is never returned to a browser.
  - Repository names are validated, and `.` and `..` are refused.
- The recommendation text is quoted in the issue as data. HTML comment markers are stripped, so nothing can hide in the issue body.

**Tradeoffs:**
- Only sites whose code is in GitHub and that run SEO Autopilot's workflows can be changed. Address-only sites stay advice-only (D29).
- Verification is audit-based. It shows whether problems went away, not traffic impact; Search Console measurement (D33) covers that where connected.
- Rollback is the GitHub revert of the named pull request: a person's action, deliberately not automatic.

**Evidence:** `test/github-execution.test.mjs`, `rls16.sql`, `portal-github.test.mjs`, and the workerd end-to-end run. That run drives the whole path against the real migrations with a GitHub stand-in: drafted, approved, issue and dispatch, merged, re-scanned, "1 of 1 problems fixed", and the token appears in no job, output or log.

## 2026-11-08 D38 Notifications derived from the work; monthly work report; team page by department
**Decision:**
- Notifications are computed live from the work itself:
  - for agencies: approvals waiting, work needing a person, client requests, changes verified or stopped, integration and planning errors;
  - for client accounts: answers to their own requests.
  - Only "seen up to" is stored per person.
  - No email provider: Q7 is open, and the portal inbox is the channel.
- The monthly work report is for the agency and the site's client accounts. It lists advice accepted, changes and their verification, requests answered, and the audit at the start and end of the month. It contains nothing internal: no costs, agents, analysis or reviews. Anonymous share links keep the existing report without it.
- The team page shows the director plus the master spec's eight departments, taken from `src/god/departments.mjs` (each agent exactly once), with 30-day work per department and specialist.

**Tradeoffs:** a derived inbox cannot be dismissed item by item. It empties as the work is handled, which keeps it honest.

## 2026-11-12 D42 Live activity for the agency, read-only
The owner asked to see inside the portal what the scheduler and the AI agents are doing. One read-only function, `public.site_activity` (migration 20261112000000), feeds a "Live activity" card at the top of the SEO God page: the scheduler heartbeat, what is holding the team back (strategy approval, open questions, AI key and budget, GitHub), who is working now, each worker's 30-day record, and every job step (`job_events`) with the actor named (director, quality reviewer, cloud worker, specialist, or a person by email if they belong to the agency). It refreshes every 30 seconds and replaces only that card, so typed answers survive.
- Agency members only, like `god_console`; clients and other agencies get "not allowed", anon has no grant.
- The scheduler heartbeat is platform-wide, so only its times, pause state and an error count are returned: the Worker's error strings can name other agencies' sites.
- Tradeoff: polling (30 s) instead of Supabase Realtime. Realtime would need table-level RLS publication of `job_events` for members; polling one function is simpler, and the scheduler only moves every 15 minutes.
- "AI key present" is not visible to the database (it is a Worker secret), so the card says honestly whether any specialist has run and what it cost, not whether a key is set.

## 2026-11-12 D41 Health alerts as a GitHub issue; deploys keep the scheduler's chosen state
**Context:** the pilot is live, email (SMTP) is not configured, and the only place a failure showed was the `god_runs` table. A routine redeploy would also silently re-pause a running scheduler, because the dashboard variable is replaced by `wrangler.toml`.

**Decision:**
- `god-health` (GitHub Actions, hourly) reads the run log with the service role and keeps one issue labelled `seo-god-health` open while there is no run for 40 minutes or every one of the last 4 runs has errors; it closes the issue when healthy. It is read-only: it never pauses or unpauses.
- A missing SMTP setting is a note in the notify result, not a run error, so it does not keep the run log red.
- `deploy-seo-god` has a "run" tick box: unticked deploys paused (the default, as before); ticked deploys with `SEO_GOD_PAUSED=false`. `wrangler.toml` still says paused, and the database switch still pauses either way.
- Onboarding no longer treats any address as a local business: only the site's own local business types do; an office address leads to "do you serve customers beyond that area?" (found in the erudience.com pilot).

**Tradeoffs:** GitHub issues reach the owner through GitHub's own notifications, not the inbox; email alerts can be added once SMTP exists. One bad run does not raise an issue, so a failure is reported after at most about an hour.

## 2026-11-08 D40 Email through Supabase's SMTP; the Worker reads the scan secret from Vault
**Context:** the owner asked for email through Supabase SMTP (Q7 answered in chat, 2026-11-08).

**Decision:**
- Invitations (agency and client) go out as Supabase Auth's own invite email, using the project's Auth SMTP and its "Invite user" template. The new `notify` Edge Function asks Auth to invite each queued invitee once. The invite-only gate (D36) lets the account be created because the invite is pending.
- Daily summaries of unseen notifications are sent by `notify` through the same SMTP server. Its details are kept as Edge Function secrets (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `PORTAL_URL`).
  - At most one a day, and only when something is new.
  - Each person can turn it off.
  - Without the secrets, summaries are skipped and the run says why.
- The Cloudflare Worker calls `notify` every run, even while the SEO God is paused: invitations are portal features.
- The Worker reads the shared scan secret from Vault through a service-role-only function, so nobody copies it by hand.

**Tradeoffs:** Supabase's built-in SMTP sends only a few emails an hour and is meant for testing. A custom SMTP server in Authentication → SMTP Settings is needed for real use, and the same details then go into the function secrets.

## 2026-11-08 D39 Brand discovery is labelled; competitors are not guessed
**Decision:** discovery records the theme colour a site declares (stated) and the colours and fonts read from its own HTML styles (inferred), each with its source. Only plain hex colours and plain font names are kept, and generic font stacks are dropped. Competitors are not guessed from a site's own pages: they come from search data through the existing `gap` research job.

## 2026-11-08 D36 Invite-only sign-up in the database; pause enforced on every Worker route
**Context:** owner decision Q8 ("invite-only registration until public launch; verify owner/admin access and invite flows remain functional before changing authentication settings") and the owner's production-gates handover (a paused Worker must not execute due jobs even if Cron fires).

**Decision:**
- Sign-up is gated in the database, not by turning off Supabase Auth sign-ups.
  - Turning sign-ups off would also stop invited people, because both the agency invite (`invites`) and the client invite (`client_invites`) expect the invited person to sign up with that email.
  - Migration `20261108100000_invite_only.sql` adds a before-insert trigger on `auth.users`. It refuses an email without a pending invite.
  - A platform admin (or the service role) changes it with `set_invite_only`. It is on by default.
  - The portal turns Supabase's generic "Database error saving new user" into a plain explanation.
- The Worker's planning and job routes (`/internal/tick-site`, `/internal/run-job`) check both pause switches themselves. A pause therefore also stops work a run in progress has already dispatched, or that anyone sends with the internal token. An unreadable switch counts as paused. This costs one extra database read per invocation.

**Tradeoffs:**
- A refused sign-up returns HTTP 500 from Supabase Auth. The portal handles it, but other clients see a generic error.
- Anyone creating users through the Auth admin API must add an invite first, or open sign-up.

**Evidence:** `rls14.sql`, `portal-invite-only.test.mjs`, `cf-worker.test.mjs` (paused routes), `scripts/db-rollback-check.mjs`.

## 2026-11-08 D35 One agency approval per strategy (replaces the two-step flow of D28)
**Context:** REVIEW-QUESTIONS D1. Under D28 the strategy needed one approval to start drafting and a second to accept the draft. Drafting is deterministic and free: it reads the scan, the site's own statements and the audit, with no AI call. The master spec requires approval only before a strategy is executed.

**Decision:**
- The planner queues the strategy draft right after the scan, ungated (risk medium, priority 2, created after the scan so the scan runs first and the draft reuses it).
- The draft handler marks its result `adopt: true`. After review the worker sends such a result to the agency (`awaiting_approval`) even though starting it needed no approval.
- One `approve_job` adopts it: the scheduler writes the strategy as approved and completes the job. Nothing else executes for the site until then, as before.
- "Request changes" on ungated work (the job moves to `scoped`) makes the scheduler redo it. Gated work still waits for a new approval to start.
- Only the agency decides work that waits for it: the worker may not authorize or reject a job in `awaiting_approval`, gated or not. This is enforced twice: `src/core/job-lifecycle.mjs` and `transition_job` in migration `20261108090000_strategy_draft.sql`.

**Tradeoffs:** the agency sees a draft at once and decides once. A draft is made for every new site even if the agency never looks at it; it costs only the database writes. High-risk changes keep their own approvals (D17).

**Owner input:** confirmed by the owner in REVIEW-QUESTIONS D1 (2026-11-08): one agency approval; the draft is generated automatically after the initial scan; agency approval is required before the strategy is adopted or executed; high-risk website changes keep their own approvals.

## 2026-11-08 D34 Fixes from the independent security review
An independent review of the whole stack found three exploitable defects. All are fixed, with regression tests (`rls12.sql`, `test/security-fixes.test.mjs`).

1. **Search Console data could leak across agencies.**
   - **Problem:** the platform's one shared Google account read any domain an agency added, even one it did not own.
   - **Fix:** a site may use the shared account only after a platform admin confirms it (`set_gsc_allowed`), and never while the same domain is registered in another agency.
     - The confirmation is cleared when the address changes.
     - Members cannot set it.
     - The scan function and the Worker both check `gsc_allowed` first.
   - **Proper long-term fix:** each agency brings its own Google account (rule 6). See REVIEW-QUESTIONS X3.
2. **Budget bypass.**
   - **Problem:** agency staff could create jobs with any budget, skipping the per-site daily cap and spending the platform's AI key.
   - **Fix:**
     - Staff jobs carry at most $5.
     - A staff job with a budget needs approval.
     - Each person can create at most 100 jobs a day.
     - The per-site daily budget is now a hard ceiling on every paid run at run time, whoever created the job.
   - **Not fixed here:** fairness between agencies in the job queue (`claim_job` orders by priority across all tenants). See X3.
3. **Script injection through a site's links.**
   - **Problem:** a `javascript:` address in a site's structured data (`sameAs`, `logo`) reached a portal link.
   - **Fix:** discovery keeps only http(s) addresses, and the portal builds every link from site data through `safeHref`, which allows http(s) only.

## 2026-11-08 D33 Search Console for hosted sites measures accepted advice with the CLI's own method
**Decision:** with a Google service account (`GOOGLE_KEY_JSON`, which site owners add as a user on their property), the scheduler queues a read-only `search_console` job. It runs once an accepted piece of advice has a complete after-window (3-day lag plus 14 days).

**How it measures:**
- The job compares the page's 14 days after with the 14 days before, against the rest of the site over the same dates. It reuses `src/analysis/experiments.mjs` (`evaluate`, `controlGroup`).
- **Queries stay small:** per page under test, its daily rows, plus the site's daily totals; the control group is the totals minus the page. Downloading page × date data would be too much for the Worker's 10 ms CPU.
- It tries the domain property first, then the address prefix. If it has no access, the job goes to a person, saying the site owner must add the account.
- Verdicts feed the lessons. "Too little traffic" and "unclear" are never counted as wins.

**Tradeoffs:**
- It is still directional: the control group is the rest of the site, not matched pages.
- It covers at most 10 pages per run.
- Search Console data lags about 2 days.

## 2026-11-08 D32 Operations: each agency sees only its own sites; platform health is for platform admins
**Decision:** the portal's Operations page has two parts.
- **Every agency** sees all its own websites at a glance: approvals waiting, client requests, stuck work, spend and when each site was last planned (`agency_overview`).
- **Platform admins only** also see scheduler health: recent runs, errors and usage against the Workers Free daily limit. They get the global pause switch too (`platform_health`, `set_platform_paused`). The admin list is a table only the service role can change.

**Why:** scheduler runs and the pause switch cover every agency. Showing them to agency members would leak other tenants' activity and let any agency stop everyone.
**Tradeoffs:** a platform admin must be added once by SQL; there is no self-service admin UI.

## 2026-11-08 D31 Learning measures what an audit can show, and says so
**Decision:** the SEO God learns from three things.
1. **Accepted advice is re-checked by later scans.** Each recommendation is recorded with the problems found on its page. A problem counts as fixed only if the page was crawled again and the problem is gone. Results are judged after 3 days, and unresolved items close as "not done" after 30 days.
2. **The agency's own refusals.**
3. **Lessons per agent**, built from those two.

Lessons change planning:
- an agent whose work the agency declined twice in 30 days is paused until the refusals age out;
- advice never fixed after 3 checks drops a priority step.

The site's lessons are also passed to the agents, inside the data block. The agency sees all of it on the SEO God page.

**Why:** the master spec asks the system to improve from outcomes. The hosted path has no daily Search Console series for most sites, but every site has repeated audits.

**Tradeoffs:**
- An audit shows whether a problem went away, not whether traffic changed. The console and the lesson wording say so.
- Traffic-based verdicts (`src/analysis/experiments.mjs`, difference-in-differences with a control group) stay with the CLI path until hosted sites have Search Console data.
- Lessons are per site, not shared across agencies (tenant isolation).

## 2026-11-08 D30 Cloudflare-first execution: a stateless Worker scheduler, crawling in the Supabase scan function, CLI jobs stay in GitHub Actions (owner: PR #42)
**Decisions:**
1. **Scheduler and light work in a Cloudflare Worker.** One Worker (`cloud/worker/`) with one Cron Trigger every 15 min. Each site's planning and each job run in a new invocation of the same Worker through a self service binding. Each invocation gets its own 10 ms CPU and 50-subrequest Free allowance.
   - Measured CPU per step: 0.4-2.5 ms for planning, onboarding and agent prompts.
   - The Worker keeps no state: Supabase is the source of truth for jobs, approvals, memory, leases, retries, costs and the run log.
2. **Crawling in the existing Supabase `scan` Edge Function**, in a new job mode: one site per request, at most 40 pages.
   - A 60-page crawl and audit measured 0.8-1.6 s of CPU. That is far over the Worker's 10 ms, and a single page alone is 13-27 ms.
   - The Supabase limit is 2 s CPU per request. The function's older loop scanned several sites in one request and could exceed it, so it now scans one.
3. **The 52 CLI jobs stay in the site repositories' GitHub Actions.** Every one reads or writes the site's state files, and 6 spawn processes. In Workers, `child_process` is a non-functional stub and `/tmp` is cleared per request. Moving a job requires moving its state to Supabase first. `scripts/cf-runtime-audit.mjs` keeps the classification generated from the code.
4. **No Cloudflare Workflows for now.** The Supabase job ledger already gives durable steps, leases, retries and approval waits. Workflows Free has the same 10 ms per step and a 3,000-step daily cap.
5. **Fails safe.**
   - The Worker deploys paused (`SEO_GOD_PAUSED`), and a database switch (`set_god_paused`) pauses it with no deploy.
   - If the database cannot be read, the scheduler pauses.
   - Expired leases are recovered through the normal capped retry path.
   - Internal routes need a token, and the only public route is `/health`.
6. **One scheduler.** When Cloudflare goes live, the 10-minute pg_cron scan from D25 is unscheduled. The scan function's job mode stores the portal snapshot itself.

**Supersedes:** the part of D13 that put engine jobs in a separate Node container or VM. The hosted path now needs no VM: Worker plus the Supabase function. The CLI path keeps GitHub Actions.
**Tradeoffs:**
- The Worker holds the service-role key; tenant safety rests on the SQL functions.
- CPU inside Cloudflare is estimated from Node, not yet measured in production.
- Hosted sites get audits, strategy and advice, not file edits.
- Fan-out costs Worker requests: about 350 a day for 25 sites, against 100,000.

## 2026-11-08 D29 Hosted agent runs advise only, on the user's own key, inside the job's budget
**Decisions:**
1. Hosted agent jobs (`agent:<name>`, `src/god/agent-runner.mjs`) use the agent's own definition from `departments/`. They see only the site's compact reports, approved strategy and stated facts. They return recommendations for the agency and change nothing on a website. Edits stay with repository-connected sites and the R1-E1 apply step.
2. The call goes straight to the Messages API with the user's own `ANTHROPIC_API_KEY` (rules 5 and 6). The default model is `claude-opus-5-5` at effort `medium`; `SEO_GOD_MODEL` and `SEO_GOD_EFFORT` change it. Server-side refusal fallback (`fallbacks: "default"`) is on.
3. Budget is enforced before the call. `max_tokens` is set so the worst case fits what is left of the job's budget: input estimated at one token per three characters, priced at the most expensive model a fallback could reach. Cost is computed from the API's own usage report, per attempt when a fallback ran. A model without a known price is refused.
4. Some outcomes go to a person at once instead of being retried: no key, a budget too small, a refusal, an unreadable reply. The job's budget covers all its attempts together, and reviews that keep asking for changes stop at the attempt cap.

**Why:** the planner was choosing agents that nothing could run. Unbounded retries of paid calls were possible, both review-driven (needs_changes requeued without a cap) and per-attempt (budgets were not cumulative).
**Tradeoffs:** advice is weaker than a reviewed change, but it is safe on any site and needs no integration. Prices are the published first-party rates as of 2026-10; Bedrock, Vertex and Foundry users would need their own price table. Agent output quality is ungraded until runs on real sites with a real key.

## 2026-11-08 D28 SEO God scheduler: two agency decisions per strategy, budgets reserved before work is queued
**Decisions:**
1. A scheduler tick (`src/god/tick.mjs`) carries out decisions the agency has already recorded and never makes one. An approved job that has not run is queued. An approved strategy proposal that has run becomes the site's strategy (`status: approved` in site memory) and its job completes. So the strategy needs **two** agency decisions: "start drafting" and "accept this draft". The agency approves the exact draft that is stored on the job (`jobs.outputs`), not a regenerated one.
2. Approved changes that have run are not applied by the tick. They wait for an apply step that uses an authorized integration (R1-E1), so the content deployed is the reviewed content.
3. Each site has a daily budget (default $0: free read-only work only). The remaining budget of open jobs counts as spent when planning, so one tick cannot queue more than the day allows. Every charge is a row in `job_costs`. Work that spends more than its budget fails review and is not retried.
4. Only kinds with a runner are queued. Planned agent work without one is reported as deferred, not queued to fail.
5. Kill switch `SEO_GOD_PAUSED`; a site with status `paused` is not planned.

**Why:** the planner and worker existed but nothing ran them, approvals had no path forward, and there was no cost limit (master spec: budgets and costs per job; owner: agency-only approvals).
**Tradeoffs:** two approvals per strategy is one more click for the agency, but it means drafting work (later model calls) is never started without consent. Agent cost estimates ($0.50 per run by default) are estimates until agents are graded on real runs. The queue is global; a site over budget can still run work already queued within its reservation.

## 2026-11-08 D27 Release 1 contracts in the existing Supabase schema (owner: master spec PR #35, Q07, Q27-Q30)
**Decision:** add clients, client viewers, jobs with a database-enforced lifecycle, append-only job events, independent reviews, agency-only approvals, untrusted client submissions, private site memory, integration records and an audit log to the existing portal schema (`20261108000000_r1_contracts.sql`), with the same lifecycle mirrored in `src/core/job-lifecycle.mjs`.
**Why:** every later workstream (SEO God orchestration, onboarding, client portal, verified changes, learning) needs these records, and the owner's hardest rules (agency-only approval, submissions never execute, client results only) belong in the database so no UI or worker bug can bypass them.
**Tradeoffs:** one Postgres project for everything (no new infrastructure); gates live in SQL functions, so the engine must call them rather than write rows. Same-org rules are triggers, not CHECK constraints, so existing member updates keep working. Client accounts come only from an agency invitation; anyone else who signs up still gets an agency workspace (open sign-up stays an owner decision).
**Not decided here:** whether share links stay alongside client accounts; email provider; file upload storage and scanning.

## 2026-11-07 D26 Audit outcomes: guarded fetch for hosted scans, robots.txt, a generated registry (owner: "a working, secure and measurable system before additional features")
**Decisions:**
1. Every address a user types is fetched only through `src/hosted/safe-fetch.mjs`, checked again at every redirect hop, with DNS answers checked where the runtime can resolve. The database also refuses private addresses for address-only sites, on insert and on update.
2. Hosted scans follow robots.txt for `*`: the site's owner may not be the person who added it.
3. The registry of jobs, agents, skills, MCP tools and workflows is generated from the code (`scripts/build-registry.mjs`) and checked by a test, instead of a hand-written list that drifts.
4. No agent is merged or removed now. Overlaps (AI visibility x3, research x4, planning x2, local umbrella x5 specialists, review x3) are recorded; consolidation waits until agents are graded on real sites.
**Why:** the D25 scanner fetched any URL a site linked to, including redirects to internal addresses; docs claimed things the code and deployment did not show (departments "not implemented", agents "running").
**Tradeoffs:** DNS rebinding is reduced, not eliminated (documented in `docs/security.md`). Hosted scans read fewer pages on sites with strict robots.txt.

## 2026-11-04 D25 Websites connected by address, scanned on Supabase (owner: "a simple or straightforward way to connect any site", "triggers outside GitHub", "cheapest, free if possible")
**Decision:** a site can be added to the portal with only its address. A `scan` Edge Function in the portal's Supabase project crawls it (the product's own crawler, audit rules, platform detection and snapshot builder, copied in by `cloud/portal/build-scan.mjs`), reads what the site states about itself (`src/analysis/discover.mjs`) and stores a snapshot. pg_cron wakes it every 10 minutes; adding a site or pressing "Scan now" wakes it at once; each site is due once a day.
**Why:** it works for any website (WordPress, Shopify, Wix, hand-built) with nothing to install, uses no GitHub Actions minutes, and runs on the free Supabase plan: 144 wake-ups a day, each scanning as many due sites as fit in 100 seconds. Claude already reaches the same database through the Supabase MCP.
**Tradeoffs:** reads at most 60 pages per site per day, and only the HTML before JavaScript; no Search Console, GA4, agents or edits for address-only sites yet (they need access the owner of the site grants, which comes next). The free plan pauses a project after a week with no API traffic; the daily scans call the API, which should keep it awake, but that is not yet observed. The scanner refuses bare IPs, localhost and private suffixes.
**Alternatives:** Render cron (unchanged Node, about $1–5 a month), Cloudflare Workers ($5 a month plan for the CPU time), a VPS. Rejected for now on cost; the scan module is plain Node, so moving it is a copy.

## 2026-10-30 D24 Approvals from the portal are applied by the site's own run (owner: "do your works")
**Decision:** the portal records a decision (approve, hold, decline). The site's daily `portal --push` receives the pending decisions in the push response, applies them on GitHub with its own `GITHUB_TOKEN`, then acknowledges them. For an approval, it adds the label and comment and starts `seo-implement` by workflow dispatch.
- **Why:** the portal keeps no GitHub access, which matches D23's push model. The site's token can already label issues. GitHub does not start workflows from labels added by `GITHUB_TOKEN`, but it does honour workflow dispatch, hence the explicit dispatch.
- **Tradeoffs:**
  - Decisions apply at the next daily run (05:17 UTC), not instantly. A later option is an hourly sync step, or a GitHub App held by the portal.
  - Portal members can approve: the site owner accepts that by installing the portal token. Every change still passes the checks, and the risk policy (D17) is unchanged.
  - `seo-daily` needs `actions: write`.

## 2026-10-30 D23 Client portal on Supabase, fed by a daily push (owner: "do all of your remaining works")
**Built:** an agency signs in, connects websites, and shares a no-login link with each client. Each website's own scheduled run pushes one JSON snapshot a day (`portal` job). The portal stores the snapshots in Supabase Postgres and shows them on one static page. Source: `cloud/portal`, `src/jobs/portal.mjs`.
- **Why push, not pull.** Agencies' websites live in their own (often private) repositories. A push needs one site-scoped token per website. A pull would need the portal to hold GitHub access to every client repository. The workflow already runs daily, so a push costs one step.
- **Why Supabase.** It provides Postgres with row level security, email sign-in and Edge Functions in one service, and the owner already uses it. With RLS, isolation is enforced by the database rather than by the page. The page talks to the REST API with the publishable key, so it needs no server and no libraries, and stays a static file that any host can serve.
- **Tenancy.** Every account gets its own organisation on sign-up. Site tokens are stored as SHA-256 hashes in a schema the API does not expose, and making a new one stops the old one. Client links are random tokens that read one website's latest snapshot through one function.
- **Tradeoffs.**
  - Snapshots are whole documents (about 60 to 70 KB per site per day; the last 120 are kept), not normalised tables. That is simple and fast to show, but cross-site analytics would need extraction later.
  - Client links are bearer links: anyone holding one can view that site. That is acceptable for SEO reports, and links are revocable.
  - The portal depends on Supabase. The schema is plain Postgres plus `auth.uid()`, so moving is feasible.
- **Relationship to the Phase 0 plan (D1 to D15, still awaiting owner review).** This is the smaller alternative to the full hosted app. It runs no jobs and holds no Google credentials, and it reuses the engine unchanged, so it does not pre-empt the hosted-worker decision (D1). It overlaps briefs 05 and 07.
- **Not done:** billing, team invitations, per-agency domains, live updates.

## 2026-10-23 D22 Product name (proposed; owner decides)
- **Problem:** "SEO Autopilot" is a category, not a name. BrightEdge sells "Autopilot", and at least two other tools are listed as "SEO Autopilot". It cannot be owned, protected or found.
- **Owner brief (2026-10-23):** a simple, small, repeatable name; the domain need not be .com.
- **Shortlist (web search found no SEO product with these names; no trademark or domain check done, the sandbox cannot reach registries):** Seora (coined: SEO plus aura; ownable, says what it is), Tend (tending a site like a garden; tend.io is an analytics tool, an adjacent risk), Hone (common word, harder to own). Ranko was rejected: an AI SEO agent of that name already exists.
- **Rename plan once chosen:** a trademark search in the main markets (UKIPO, EUIPO, USPTO) and the domain first; then the repository (GitHub redirects the old URL), npm package, CLI (the `seo-autopilot` command stays as an alias), GitHub Action, Claude plugin, site and docs, in one release.

## 2026-10-23 D21 Vertical packs: a registry, not a folder per pack (owner: "a separate part so each site gets its own specialist agents")
- **Decision:** packs are defined in `departments/verticals/packs.json` (pack → agents → routing instruction). Agent files stay in `departments/verticals/agents/`. A pure `detectVerticals` (`src/analysis/verticals.mjs`) decides which packs apply, from the site profile or the site's `verticals` setting.
- **Why not one folder per pack yet:** moving agents would change every installed path, the plugin list and the department tests, with no gain for users. The registry gives the same result: each site gets and runs only its packs. Folders can come later, when a pack gains its own jobs and playbooks.
- **Install rule:** pack agents are installed only once every site in a project names its packs. Until then all of them are installed, because the profile that detects packs runs after `init`. Agents already installed are never deleted, so project rules are never lost.
- **Status:** unit tested (`test/verticals.test.mjs`); not yet run on a real site. Data jobs per pack are brief 12, steps 2 to 4.

## 2026-10-22 D20 Hosted connector for Claude and ChatGPT (owner: "start the hosted connector")
- **Decision:** the first hosted piece is a read-only remote MCP server (`cloud/connector`, a Cloudflare Worker). Claude and ChatGPT can then use a site's reports with no local install. It reads what the site's own workflows already save, which is the GitHub-App distribution mode in D1(b), and adds no database, tenancy or job runner. D1 to D15 stay proposals; this decision is limited to the connector.
- **Choices and tradeoffs:**
  - **Data source: the site repository's state branch** (`seo-data`) and its config, read with the user's own GitHub token. The cost is that reports are only as fresh as the last scheduled run. In exchange there is no copy of anyone's data on our side, and nothing to keep in step.
  - **GitHub App, not an OAuth App.** The user picks the repositories, and the only permission is *Contents: read*. An OAuth App's `repo` scope would grant write access to every repository.
  - **The connector is its own OAuth 2.1 server, with GitHub as the sign-in.** MCP clients need dynamic registration, PKCE and the metadata documents. GitHub supports none of them for this use, so the connector cannot simply be GitHub's OAuth.
    - Our own consent page names the requesting client before GitHub is asked, so a registered client cannot get a token silently. A SameSite cookie stops another site approving on the user's behalf.
    - Redirect URIs must match exactly: https, or loopback http.
  - **Storage in Workers KV:**
    - only hashes of our tokens and codes;
    - the GitHub token encrypted with AES-GCM;
    - an expiry inside every record as well as the KV TTL.

    KV is eventually consistent, so single use is near-exact, not exact. A Durable Object would fix that if it ever matters.
  - **No `run_job`.** Jobs need git, Python and Go (see D13), and a hosted runner is a separate step.
  - **Shared code.** The tools moved to `src/mcp/core.mjs`, which has no Node imports, so the local server and the Worker run the same code.
- **Who runs it:** anyone can deploy their own copy with their own GitHub App and Cloudflare account; nothing needs the maintainer's keys. A public instance for customers would be run by the product owner, with their own GitHub App.
- **Status:** 5 tests with GitHub and KV faked; bundled with `wrangler deploy --dry-run` (30 KiB); run in the local Workers runtime (`wrangler dev`), where discovery, registration, consent, the refused cross-site consent and the redirect to GitHub all behaved as designed. **Not deployed. Never used with real GitHub or a real Claude or ChatGPT client.**

## 2026-10-20 D19 Site intelligence and the MCP server (owner: "more real capabilities")
- **Decision:** add capabilities that need no paid provider. These are:
  - internal PageRank and link-graph analysis;
  - real-user Core Web Vitals history (Chrome UX Report);
  - a page change monitor;
  - a structured data checker and generator;
  - an entity check (Google Knowledge Graph, Wikidata).
  Also an MCP server, so AI assistants can use the reports and jobs.
- **Tradeoffs and rules:**
  - **Internal PageRank** measures the site's own linking, not Google's view, and the report says so.
  - **Structured data drafts** use only facts from the page, the config and the URL. Unknowns stay as `<fill: ...>` placeholders, so no fact is invented. Markup that claims what the page does not show is flagged as an error, after Google's structured data policies.
  - **The change monitor** keeps sentence fingerprints, not copies of competitors' text.
  - **The entity check** treats creating a Wikidata item as a person's decision, and only for genuinely notable businesses.
  - **The MCP server** is read-only by default:
    - files are limited to the state folder;
    - `run_job` has a fixed allowlist with no publishing, issue, merge or submit jobs;
    - `team` and `priorities` are forced to run dry;
    - paid jobs need `confirm_cost`;
    - it uses no shell, and has no dependencies (newline-delimited JSON-RPC over stdio).
- **Status:** unit and fixture tested; the MCP server was also tested through a real stdio session. The Chrome UX Report, Knowledge Graph and Wikidata APIs have not been called live.

## 2026-10-20 D18 Research suite instead of a paid SEO suite (owner request: "those features or better, real solutions")
- **Decision:** build keyword research, rank tracking, competitor gap, content optimisation, AI visibility, backlink authority and a traffic forecast into the product. Run them on the site's own data (Search Console) plus keys the user brings. No Ahrefs or Semrush subscription, and no maintainer keys.
- **Choices and tradeoffs:**
  - **Search Console first.** Positions and demand come from the site's own first-party data and are free. The cost is no data for queries the site was never shown for. A provider key (DataForSEO) fills that, labelled as an estimate.
  - **Grouping by shared results.** When live results are available, 3 or more shared top-10 URLs define a topic, the method the big suites use. Without live results, grouping falls back to same-words, and the report says which method was used.
  - **Difficulty without a link index.** Difficulty is the average Open PageRank (from the open Common Crawl graph) of the top-10 domains. It is cruder than a suite's own index, so it is labelled with its basis.
  - **Autocomplete is off by default** (`--suggest`). Google's endpoint is public but unofficial, and its terms restrict automated queries. When on, it is capped, spaced out, and used only for wording, never as volume.
  - **AI visibility uses the engines' official APIs with web search on.** That covers Perplexity, OpenAI Responses with `web_search`, Claude with `web_search_20260209` and server-side fallback, and Gemini with `google_search`. Results are compared only within the same question set, repeated runs measure variance, and raw answers are kept as evidence. Consumer apps can answer differently from the APIs; the report says so.
  - **Paid steps are opt-in per schedule.** They are switched on by `SEO_RANK_LIVE` and `SEO_AI_VISIBILITY`, and free steps always run.
  - **Forecast in Python, standard library only** (Holt-Winters with a weekly season, grid-searched). It runs in the optional engine, so the Node core stays dependency-free. The range assumes independent errors and is on the narrow side; it prompts a look, not a conclusion.
- **Not built:** paid-ads intelligence and social tools (different products), and a web-scale crawl of our own (that would need infrastructure the product does not run).
- **Status:** all mocked or fixture tested. No provider has been called live from this project yet.

## 2026-10-20 D17 Graduated autopilot (APPROVED by the owner)
The owner decided that a person should not approve every change: routine work runs and publishes on a schedule, and a person is asked only about high-risk changes. This replaces the earlier rule "a human approves what goes live".
- **Levels per kind of change** (`src/analysis/autonomy.mjs`, shown by `run autopilot`):
  - `watch` reports only;
  - `prepare` opens a PR for a person;
  - `autopilot` merges and publishes after every check;
  - `undo` does the same and then watches the live result and reverts on regression.
- **Defaults:**
  - fixes, snippets and internal links publish at `undo`;
  - refreshes, new pages and template changes publish at `autopilot`;
  - sensitive topics, site-wide indexing (robots, sitemaps, headers, redirect rules), migrations, deletions, outreach and infrastructure (workflows, dependencies, the autopilot's config and agents) stay at `prepare`, and a site cannot raise them.
- **Checks before an automatic merge**, all on the exact commit:
  - seo-check build;
  - the reviewer agent's check and pass label;
  - the policy decision, which includes sensitive-topic detection in the added text and treating any new page file as a new page whatever its label;
  - daily and weekly limits (10 changes a day, 3 new pages a week by default, to stay clear of scaled-content patterns);
  - a merge pinned to that commit.
- **Kill switch:** the repository variable `SEO_AUTOPILOT_PAUSED=true`, or `autopilot.paused` in the config, stops implementing, merging and releasing.
- **Fixes to the gaps found in the Phase 0 audit:**
  - F1: auto-merge accepted a reviewer label left from an earlier commit and had no policy; now the reviewer check must pass on the same commit, and the merge is pinned.
  - F2: the implementer did not check who added `approved`; now only write, maintain or admin can trigger it.
  - F3: release pushed to the default branch with no pause; it is now behind the kill switch and only dates pages already merged.
- **Still to build (D17 roadmap):**
  - running the agents automatically on a schedule: DONE for proposal issues (`seo-autopilot` workflow, which calls implement, check, review and merge in one run, because changes made with the workflow token do not trigger other workflows). DONE for work orders from `team` too: with `SEO_AUTOPILOT=true` the weekly `team` step opens one `seo-work-order` issue per page for ready, page-scoped orders of the snippet optimiser, internal linker or refresher (never sensitive pages, site-wide orders, advise mode, or kinds the policy keeps for a person; at most 5 a week), and the implementer follows that agent's file;
  - a monthly workflow: DONE (`seo-monthly`, `monthly` job: autopilot ledger, rollbacks, 28-day traffic, audit findings vs last month, experiments);
  - post-publish monitoring with automatic revert for `undo` changes: DONE (`seo-watch`, `watch` job: reverts through a pull request when a changed page errors, the change added a noindex, or clicks fell clearly more than the rest of the site over 14 days; indexing status is not judged because no per-change snapshot exists);
  - the AI reviewer as a required check in more repositories (it needs the site owner's Claude key).
- **Risks:** Google's spam policies on scaled content, and wrong facts on sensitive topics. They are mitigated by the pace limits, the facts guard, the reviewer, and the human-only classes. Default behaviour for existing installs is unchanged until they set `SEO_AUTOMERGE=true`. Breaking change for those who already use auto-merge without the reviewer: they must now set `SEO_REQUIRE_REVIEW=false` explicitly, or enable the reviewer.

## 2026-10-18 D16 Departments, work orders and validation (PROPOSED, owner to confirm)
Proposal: group agents into departments, each a folder. The departments are command, research, technical, content, authority, ai-search, verticals and quality. Each has a charter, one owner per problem type and shared skills. The router produces dependency-ordered work orders with file/URL locks so independent work can run in parallel, and nothing reaches approval until its validators pass.

The full design is in `docs/architecture/DEPARTMENTS.md`, with evidence in `docs/research/AGENT-AUDIT-2026-10-18.md`.

- **Rationale:** today ownership overlaps and sequencing rules are prompt-only. Several SEO areas also have agents without any data behind them.
- **Tradeoffs:** moving files touches every loader (init/upgrade, Python runtime, site build, tests), and existing installs must be upgraded. New agents add maintenance, so each must come with a data source and eval cases.
- **Smaller alternative:** keep the flat folder and add a `departments.json` registry. That gives the same ownership and routing benefits with no file moves, but it doesn't give the folder layout the owner asked for.
- **Naming:** keep "SEO Autopilot" and call the organisation "the Search Desk" (recommended), or rename after a trademark check.

## 2026-10-18 Business model: open core, service first (proposed, owner to confirm)
Keep the engine MIT; sell hosting, multi-client operations, approvals, scheduled runs, reporting and support; start with a done-for-you service through Erudience to validate demand. Alternatives and risks: `docs/strategy.md`. Consistent with the agency-first hypothesis in `SEO-PRODUCT-BUILD-BRIEF.md`, which also says prices are unvalidated.

## 2026-10-18 Roadmap relationship to the product brief
`SEO-PRODUCT-BUILD-BRIEF.md` is the owner's plan for the hosted product and takes precedence where they overlap. Roadmap briefs 05 (dashboard), 06 (CMS connectors) and 07 (hosted cloud) are superseded by its phases 1 to 4 and must be planned through its Phase 0 reuse audit first. Briefs 01, 02, 03, 04, 08 and 09 do not depend on that decision and can proceed. Note the product brief's rule: platform detection is not a working publishing integration; start with one GitHub-backed publishing path.

## 2026-10-12 to 2026-10-17 Engine decisions (already implemented)
- Dependency-free Node core; Go and Python engines optional.
- Agents are Markdown definitions; the `team` job routes deterministically from reports; a human approves what goes live.
- Site profile decides edit vs advise mode; agents never edit when the source is not in the repository.
- Users bring their own Google and AI accounts; no maintainer keys.
