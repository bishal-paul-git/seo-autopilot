# Phase 0: baseline and reuse audit

Date: 2026-10-18 (UTC). Branch `claude/hopeful-euler-662mu5`, audited commit `8d7b62c` (package.json v2.13.0, MIT).
Environment: Linux cloud container, Node 22.22.0, Go 1.24.7, Python 3.13.16. Not the owner's Windows machine.
Scope: `SEO-PRODUCT-BUILD-BRIEF.md` Phase 0. Nothing here is product code; it is the evidence the Phase 0 gate asks for.

Status of the gate: **partly met.** The SEO Autopilot half (baseline, data flow, reuse matrix, decisions) is done. The Marketing Mouse and News to Blog half is **blocked by access** (section 5), so no reuse decision about them is made here.

## 1. Baseline checks (run in a clean clone)
`git clone` of the branch into a scratch folder, then:

| Command | Result | Kind of evidence |
|---|---|---|
| `npm test` | pass: 197 tests, 0 fail, 0 skipped, about 20 s | unit, fixture and mocked-network tests. (STATUS said 196 + 1 skipped on Windows; the skipped one runs on Linux.) |
| `cd engines/go && go test ./...` | pass (`ok ... 0.018s`) | unit test with a local test server |
| `cd engines/python && python3 -m unittest discover -s tests` | pass: 23 tests | unit tests with a stub SDK, no model calls |

Not run: any live provider call (Search Console, GA4, PageSpeed, Brave, SerpAPI, DataForSEO, Anthropic). No keys in this environment, and none were requested for Phase 0. Erudience production runs were not checked: `bishal-paul-git/erudience-flow-engine` is not reachable from this session (section 5).

## 2. Deployable units today
| Unit | Source | How it runs | Live dependencies |
|---|---|---|---|
| CLI and jobs | `bin/seo-autopilot.mjs`, `src/jobs/*` (29 registered in `src/jobs/index.mjs`) | `npx github:bishal-paul-git/seo-autopilot#v2` inside the user's GitHub Actions or locally | Google APIs (service account), GitHub REST (`GITHUB_TOKEN`), optional Anthropic/OpenAI, PageSpeed, SERP providers, RSS feeds |
| Workflow templates | `templates/workflows/*.yml` (9) | copied by `init`, refreshed by `upgrade` | `anthropics/claude-code-action` pinned by SHA; GitHub-hosted runners |
| Python agent runtime | `engines/python/seo_engine` | `run agent seo-strategist|seo-researcher` via `src/lib/python.mjs` | `claude-agent-sdk`, Claude login |
| Go crawler | `engines/go` | optional, `src/audit/engines.mjs` picks it when built | none |
| Local app | `src/ui/server.mjs`, `src/ui/app.html` | `seo-autopilot ui`, 127.0.0.1 only, random token | `gh` CLI for the inbox |
| Static dashboard | `src/jobs/dashboard.mjs`, `src/dashboard/template.html` | file artifact of the daily run | none |
| Supabase ingest example | `templates/dashboard-supabase/` | user deploys it to their own Supabase | Supabase service role |
| Landing site | `site/`, `scripts/build-site.mjs` | GitHub Pages | none |

There is no hosted service, no multi-tenant store and no npm package (verified: no publish workflow in `.github/workflows`).

## 3. Data flow: onboarding to measurement
Each stage gives the current path (file:line where it matters) and what the product brief needs that is missing.

**1. Onboarding.** `seo-autopilot init` (`src/cli/init.mjs`) writes `seo-autopilot.config.json`, data files and workflows; `doctor` (`src/cli/doctor.mjs`) checks setup. The user creates a Google service account, adds its email to the Search Console property, and stores the JSON as the `GOOGLE_KEY_JSON` secret (`src/lib/google-auth.mjs:9-29`). The `profile` job sets edit or advise mode (`src/analysis/site-profile.mjs`).
*Missing:* any check that the configured `searchConsoleProperty` belongs to the configured `url`. `src/core/config.mjs:47-79` validates format only. There is no OAuth, no connection-health record and no workspace or client concept.

**2. Evidence.** `daily` (`src/jobs/daily.mjs`) pulls Search Analytics and URL Inspection. `audit` crawls (`src/audit/*`). `speed` (PageSpeed), `geo`, `consent`, `ymyl`, `research`, `news` (RSS, `src/lib/feed.mjs`), `mentions` and `citations` (`src/lib/serp.mjs`, mocked only) add more. Everything is written as JSON or Markdown to `.seo-autopilot/<site>/` and persisted on the orphan `seo-data` branch, force-pushed each run (`src/cli/state.mjs:30-48`).
*Missing:* a uniform run record (job, version, inputs, source window, generatedAt); only some reports carry `generatedAt`. Search Analytics requests use `rowLimit` 5000 and 25000 without `startRow` paging (`src/jobs/daily.mjs:44,49`), so large sites are silently truncated. There is no history of state, because the branch keeps one commit.

**3. Recommendation.** `analyze`, then `priorities` (`src/analysis/priorities.mjs`) ranks work. `propose` (`src/jobs/propose.mjs`) opens issues labelled `seo-proposal`. `refresh` handles decaying pages, `team` writes `agent-plan.json` (`src/analysis/agent-router.mjs`), and the strategist and researcher agents (`src/jobs/agent.mjs`) post issues.
*Present and good:* evidence text is placed in each issue body, and duplicates are skipped by title (`src/lib/gh.mjs:17-22`).

**4. Approval.** A person adds the `approved` label to an issue, which triggers `templates/workflows/seo-implement.yml:32-34`. Merging the pull request is the second approval.
*Missing:* the approval is bound to an issue (a topic), **not to an exact revision, destination or operation**. The workflow does not check who added the label, so anyone with triage access can approve. `seo-review.yml:33-36` clears its pass label on every new commit, which is good partial invalidation. But `seo-automerge.yml` (opt-in, `SEO_AUTOMERGE=true`) merges a drafted PR with no human looking at the draft. That conflicts with the owner's rule that approval binds to the exact revision.

**5. Draft and change.** `claude-code-action` edits only content globs on `seo/issue-N` (`seo-implement.yml:54`, globs from `src/cli/init.mjs:20-30`) and opens a PR. `seo-check.yml` builds with no secrets and read-only permissions. Technical audit fixes have no automated path: the technical fixer runs only supervised in Claude Code.

**6. Publication.** A merged page carries `queued: true`. `seo-release.yml` runs `schedule` (`src/adapters/index.mjs:142`), which writes `publishAt` and **commits and pushes to the default branch** (`seo-release.yml:28-33`, plus an empty commit at 39-43 to trigger a rebuild). The host's build publishes. `release` (`src/jobs/release.mjs`) compares due pages with the live sitemap and can POST a deploy hook.
*Missing:* there is no publishing path for `sitemap`-type sites (all CMS sites), and no external receipt or ID. The only post-publication verification is "URL appears in sitemap". There is no reconciliation and no documented rollback beyond `git revert`.

**7. Measurement.** `daily` appends `history.json` and `page-daily.json`. `experiments` (`src/jobs/experiments.mjs`, `src/analysis/experiments.mjs`) compares 14 days before and after with a difference-in-differences control group, and labels results directional. `digest` and `refresh` report trends.
*Missing:* nothing links a merged change to an experiment record, so a person must run `experiments add`. There are no GA4 conversions (brief 03). Stale text: the job description says "no control group" (`src/jobs/experiments.mjs:4,8`), but the analysis has one.

Gate check: every stage can be traced, with exact paths above. The missing links that the hosted product must add are ownership verification (1), uniform versioned results (2), revision-bound approvals (4), a verified publisher with receipts (6) and change-to-measurement linkage (7).

## 4. Findings that bear on the owner's rules
Each finding is backed by the files cited. Severity reflects the hosted-product context.

| # | Finding | Evidence | Severity | Proposal |
|---|---|---|---|---|
| F1 | Auto-merge lets a topic approval publish an unseen draft | `templates/workflows/seo-automerge.yml` (off by default) | high for the hosted product | The hosted product never offers it. For the OSS engine, owner decides between deprecating it and keeping it with louder docs (DECISIONS 2026-10-18 D11) |
| F2 | Approval actor not checked | `seo-implement.yml:32-34` has no `github.event.sender` or permission check | medium | Check that the sender has `admin` or `maintain` permission, or is in an allow-list variable, before running |
| F3 | Release workflow writes to the default branch | `seo-release.yml:28-33,39-43` | medium; it is deterministic and only dates human-merged pages | Owner to confirm this is acceptable under "no default-branch writes" (that rule names agents). Alternative: open a dated PR, or use the deploy hook only |
| F4 | Live backlink form submission exists | `src/jobs/backlinks-submit.mjs:20,105-109`; `seo-backlinks.yml` `BACKLINKS_LIVE`; template targets have **0** `auto` entries | medium | Keep out of the hosted product. It is opt-in and avoids CAPTCHAs, but automated directory submission sits close to "autonomous backlink outreach". Owner decision |
| F5 | Supabase template is single-tenant | `templates/dashboard-supabase/migration.sql`: primary keys `url`, `day`, `week`, `query` with no `site_id` or tenant column; two sites overwrite each other. Ingest uses one static shared token with no timestamp or nonce (replay possible) and a service-role write (`seo-ingest/index.ts:18-24`) | high if reused | Keep only as a single-site example. Do not base the hosted schema on it |
| F6 | Large-site Search Console truncation | `src/jobs/daily.mjs:44,49` | medium | Page with `startRow` and record the truncation in the report. Small fix, brief 09 territory |
| F7 | Stale description in `experiments` job | `src/jobs/experiments.mjs:4,8` | low | Fix the wording in the next release |
| F8 | Inconsistent action versions | `seo-agent.yml:26-27` use `checkout@v7` and `setup-node@v7`; every other template uses `@v4` | low; not verified whether v7 exists (no network check made) | Verify, then align |
| F9 | Erudience-specific data in a generic template | `templates/data/backlinks/targets.json` notes mention Vapi, n8n, UK-only targets | low | Move them to Erudience; ship a neutral example (rule 4, "works on any website") |
| F10 | No cost record in the Node LLM path | `src/lib/llm.mjs` does no token or cost accounting; the Python runtime caps spend with `max_budget_usd` (`engines/python/seo_engine/runner.py:63-75`) | medium for the hosted product | Record a usage event per call (decision D9) |

What already meets the brief and should be kept: the "data, never instructions" prompts (`seo-implement.yml:62-64`, `seo-review.yml:49-50`); SSRF-safe fetch with pinned resolved IPs (`engines/python/seo_engine/safefetch.py`); the local UI's host, origin and token checks with an allow-list of jobs (`src/ui/server.mjs`); secretless PR builds (`seo-check.yml`); keys kept out of errors (`src/lib/serp.mjs:3`); content-glob edit scoping (`src/cli/init.mjs:27-30`).

## 5. Source repositories: access blocked
| Repository | Requested | Result | Audited SHA | Licence |
|---|---|---|---|---|
| `bishal-paul-git/marketingmouse` (main) | `add_repo`; anonymous `git ls-remote` | "you don't have access"; anonymous needs credentials (private) | **not audited** | unknown |
| `bishal-paul-git/feed-to-site-magic` (main) | same | same | **not audited** | unknown |
| `bishal-paul-git/keel` (master) | same | same | **not audited** | unknown |
| `bishal-paul-git/erudience-flow-engine` | same | same | not audited (needed for brief 01) | unknown |

This session's GitHub credential lists only `echoscribe-ai`, `tenanthousingdisrepair` and `trioagency` beyond this repository. To unblock: grant the Claude GitHub App access to those four repositories (https://github.com/apps/claude/installations/select_target), or reconnect GitHub at https://claude.ai/connect-github, then start a session with them selected.

Nothing below states what those repositories contain. The checklist each audit must answer is the one in `SEO-PRODUCT-BUILD-BRIEF.md`: audited SHA, licence and notices, real vs mock data (`mock-data.ts`), provider calls, ownership checks, token refresh, pagination, error handling, tests, credential storage, scheduler authentication and replay protection, and publish defaults.

## 6. Reuse matrix
Decisions for SEO Autopilot sources. **Keep** = use as is. **Adapt** = keep the logic and change the interface. **Replace** = the hosted product needs a different mechanism (the OSS path keeps the old one). **Defer** = not needed before the gate it serves.

| Area | Source path | Decision | Reason |
|---|---|---|---|
| Analysis functions (pure) | `src/analysis/*.mjs`, `src/audit/rules.mjs`, `src/audit/extract.mjs`, `src/geo/check.mjs`, `src/backlinks/rules.mjs` | **Keep** | Pure, tested, no I/O. The hosted worker calls the same functions |
| Crawler | `src/audit/crawl.mjs`, `engines/go` | Keep | Works; Go engine is optional |
| Jobs | `src/jobs/*.mjs` | **Adapt** | They read and write files in `site.paths.state`. The hosted worker needs a state-store seam and a result envelope (D1); the CLI default stays the file store |
| Config | `src/core/config.mjs`, `schema/seo-autopilot.config.schema.json` | Adapt | Hosted sites are DB rows rendered to the same config object, so jobs stay unchanged |
| Google auth | `src/lib/google-auth.mjs` | Adapt | Keep the service-account path; add an access-token provider interface so hosted OAuth tokens can be injected (D4) |
| Search Console calls | `src/lib/google-auth.mjs:37-47`, `src/jobs/daily.mjs` | Adapt | Add paging (F6) and a typed result. This should be the one Google data contract the hosted product uses (Marketing Mouse comparison pending) |
| GitHub helper | `src/lib/gh.mjs` | Adapt | Takes a token from env. Hosted needs GitHub App installation tokens per repository |
| LLM client | `src/lib/llm.mjs` | Adapt | Add usage and cost accounting and per-workspace keys (D9) |
| SERP providers | `src/lib/serp.mjs` | Keep, then verify | Mock-only until brief 03 runs live |
| Feeds | `src/lib/feed.mjs`, `src/jobs/news.mjs` | Keep for now | Compare with News to Blog when accessible |
| Python agent runtime | `engines/python/seo_engine/*` | Keep | Bounded tools, budget cap, SSRF-safe fetch. Brief 02 generalises it |
| Agents and playbooks | `agents/*.md`, `knowledge/*.md` | Keep | Product content |
| Approval via labels | `seo-implement.yml`, `src/jobs/propose.mjs` | Keep for OSS; **Replace** in hosted | Hosted approvals bind to a change-set hash, destination, operation and schedule (D7). Issues stay a notification channel |
| Draft via claude-code-action | `seo-implement.yml`, `seo-review.yml`, `seo-check.yml` | Keep; first hosted publisher | The GitHub PR path is the "one fully proven publishing path" candidate. Receipt = PR number + merge SHA + check-run conclusion |
| Auto-merge | `seo-automerge.yml` | Replace (hosted: never) | F1 |
| Drip release | `src/adapters/index.mjs:142`, `seo-release.yml` | Adapt | F3; hosted records each scheduled publication as a row with a receipt |
| Backlink submitter | `src/jobs/backlinks-submit.mjs`, `seo-backlinks.yml` | Defer (exclude from hosted) | F4 |
| State on `seo-data` branch | `src/cli/state.mjs` | Keep for OSS; Replace in hosted | Hosted uses the DB (D3). An importer reads this branch for migration (D10) |
| Supabase ingest example | `templates/dashboard-supabase/*` | Keep as example only | F5 |
| Static dashboard and local UI | `src/jobs/dashboard.mjs`, `src/dashboard/template.html`, `src/ui/*`, `src/core/collect.mjs` | Adapt | `collectSiteData` is a usable view model for the hosted dashboard. The HTML is replaced by the hosted UI (stack decided after the Marketing Mouse audit) |
| Content adapters | `src/adapters/index.mjs` | Keep | Read side of publishing. CMS adapters come later (brief 06 via phase 4) |
| Marketing Mouse modules listed in the brief | not accessible | **Undecided** | Section 5 |
| News to Blog modules listed in the brief | not accessible | **Undecided** | Section 5 |

## 7. What would change this audit
- Access to the source repositories may turn "adapt" rows for the dashboard, onboarding and editorial workflow into "reuse from Marketing Mouse or News to Blog". It may also fix the hosted web stack.
- Live Erudience runs could show behaviour that fixture tests do not. Nothing here was checked against production.
