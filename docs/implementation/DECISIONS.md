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
