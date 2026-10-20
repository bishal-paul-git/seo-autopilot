# Implementation status

Last updated: 2026-10-20 (UTC).
- Branch `claude/hopeful-euler-662mu5`, based on `main` at `f205108` (v2.14.0 plus docs). Its work is **committed locally but not pushed**: the session's GitHub access returns 403 for every write. There is no PR yet.
- Source repos audited (static review):
  - marketingmouse `e115eac`
  - feed-to-site-magic `f72276c`
  - keel `92195e1`
  - erudience-flow-engine `a644824`
- Environment: Linux cloud container, Node 22.22.0, Go 1.24.7, Python 3.13.16. Earlier entries came from the owner's Windows 11 machine.

## Goal and phase
One sellable SEO product for small agencies and site owners (`SEO-PRODUCT-BUILD-BRIEF.md`).
- **Current milestone: Phase 0 (baseline and reuse audit). Written up, awaiting owner review.**
  - `PHASE-0-AUDIT.md`: SEO Autopilot audit, plus the source-repository audits in §5.
  - `DECISIONS.md`: proposed D1 to D15.
  - Headline: neither Marketing Mouse nor News to Blog can be the hosted base. Both have unauthenticated or cross-tenant server paths, no tests, plaintext credentials and no licence. Their UI and integration logic are reusable; their server layer is not.
- No hosted code may be written until the owner approves Phase 0.

Architecture today: dependency-free Node core (`src/jobs`, `src/analysis`, `src/audit`), optional Go crawler (`engines/go`) and Python agent runtime (`engines/python`), 27 agents (`agents/`), 26 playbooks (`knowledge/`), GitHub Actions templates (`templates/workflows`), static site (`site/`). The data flow from onboarding to measurement is mapped in `PHASE-0-AUDIT.md` section 3.

## Implemented
| Capability | Where |
|---|---|
| 29 jobs, CLI, local UI, static dashboard | `src/jobs/index.mjs`, `bin/`, `src/ui/`, `src/jobs/dashboard.mjs` |
| Approval-gated drafting via issues, labels and PRs | `templates/workflows/seo-implement.yml`, `seo-review.yml`, `seo-check.yml` |
| Site profile, agent routing | `src/analysis/site-profile.mjs`, `src/analysis/agent-router.mjs` |
| Python runtime for strategist and researcher | `engines/python/seo_engine` |
| `citations` providers (Brave, SerpAPI, DataForSEO) | `src/lib/serp.mjs` |
| **New this session:** deterministic agent-eval graders and grading script | `src/analysis/evals.mjs`, `scripts/evals.mjs`, `test/evals/cases.json`, `docs/evals.md` |
| **New this session (brief 01, items 4 and 5):** consent and conversion recipes (code executed in tests), `conversions` job | `knowledge/consent-banner-recipe.md`, `knowledge/conversion-tracking-recipe.md`, `src/lib/ga4.mjs`, `src/jobs/conversions.mjs` |
| **New this session (brief 01, item 3):** `facts` job (claims need a verified fact or a source; strict mode for builds) | `src/analysis/facts.mjs`, `src/jobs/facts.mjs` |
| **New this session (brief 01, item 2):** `redirects` job: check, generate (Apache, nginx, Netlify, Vercel) and smoke | `src/analysis/redirects.mjs`, `src/jobs/redirects.mjs` |
| **New this session (brief 01, item 1):** heading outline in both crawlers, five heading rules, `quality` job (top query vs title, H1 and description; headings per section), router duplicate fix | `src/audit/extract.mjs`, `engines/go/extract.go`, `src/audit/rules.mjs`, `src/analysis/quality.mjs`, `src/jobs/quality.mjs`, `src/analysis/agent-router.mjs` |
| Not implemented: hosted app, tenancy, billing, CMS connectors, npm package, Marketplace Action, plugin | n/a |

## Verified (evidence, not just source)
| Capability | Evidence | Kind |
|---|---|---|
| Node core | `npm test` 206/206 pass on this branch; 197/197 on a clean clone of `8d7b62c` | unit, fixture and mocked tests |
| Go crawler | `go test ./...` ok | unit |
| Python runtime | 23 tests ok | unit with stub SDK |
| Eval graders | 9 tests: graders pass good samples and fail bad ones | unit on hand-written samples. **No agent evaluated** |
| Heading rules and `quality` job | 12 unit tests; Go/Node parity test. Compared with Erudience's own scripts on a local Erudience build (127 pages): section averages identical; same 7 long H1s; matcher agrees on 320 of 321 decisions. Top-query check run on Erudience's real Search Console rows | unit, plus a real-site comparison **on a local build, not the live site** |
| Search Console, GA4, PageSpeed | used daily by Erudience per earlier STATUS; **not re-checked this session** (Erudience repo not accessible) | real integration, prior evidence only |
| `render` job | 7 tests, including end to end with real Chromium. On Erudience's build (127 pages): 10 pages with stale prerendered prose (examples confirmed by hand, including `/privacy`), which Erudience's own check misses | unit and headless, on a local build |
| Recipes and `conversions` | 6 tests: the recipe code runs in a fake browser, and the product's consent check recognises it; GA4 calls mocked | unit only. **GA4 Admin API key events never called live** |
| `facts` job | 8 tests. On Erudience's real content it finds 4 unverified claims (2 prices, 2 percentages) that Erudience's own check passes through a loophole; 0 false positives after the fixes | unit, plus a real-content comparison |
| `redirects` job | 11 tests, including smoke and check against local HTTP servers. On Erudience's real redirect files: Apache rules identical to Erudience's generator (105 of 105); same 2 problem targets flagged | unit, plus a real-data comparison. **Live smoke against a real host not run** |
| `citations` providers | mocked only; **never run live** | mock |

## Deployed
**v2.14.0 is fully released (checked 2026-10-18 through the GitHub API): Release published, and `v2.14.0`, `v2` and `v2-stable` all point at `f10f3b3`.**

Done:
- PR https://github.com/bishal-paul-git/seo-autopilot/pull/8 is merged into `main` (`f10f3b3`); `npm test` 258 of 258 on `main`; Go and Python pass; `ci` and `pages` succeeded at 16:36 UTC.
- The owner published the GitHub Release `v2.14.0` from the web UI. The tag points at `f10f3b3`, and it is the latest release.
- The owner merged https://github.com/bishal-paul-git/seo-autopilot/pull/9 (docs) and https://github.com/bishal-paul-git/erudience-flow-engine/pull/78 (consent fix).

**Not done:**
- The owner moved `v2` and `v2-stable` to v2.14.0 from a local terminal; Erudience picks it up on its next scheduled run (not yet observed).
- The consent fix on erudience.com has not been checked live; the deploy state is unknown.

No npm package, no hosted service.

## This session's changes
- Documentation:
  - `docs/implementation/PHASE-0-AUDIT.md` (new): baseline, data-flow map, ten findings, reuse matrix, access blockers.
  - `DECISIONS.md`: proposed D1 to D11.
  - This file and `CHANGELOG.md` in this folder.
  - `docs/evals.md` (new).
- Code:
  - `src/analysis/evals.mjs`, `scripts/evals.mjs`, `test/evals.test.mjs`, `test/evals/cases.json`.
  - Root `CHANGELOG.md` gets an `## Unreleased` entry.
  - No dependency, migration, config or workflow changes.

## Checks run this session
| Command | Result |
|---|---|
| clean clone of `8d7b62c`: `npm test` | pass, 197 |
| `go test ./...` (engines/go) | pass |
| `python3 -m unittest discover -s tests` (engines/python) | pass, 23 |
| `npm test` on this branch | pass, 206 |
| `node scripts/evals.mjs <dir>` with one good and one bad sample | graded both correctly, exit 1 as designed |
| `node scripts/build-site.mjs` | ran clean. It regenerates `site/agents/index.html` with a paragraph already in `agents/README.md` since v2.13.0 (pre-existing drift, not committed here; regenerate at the next release) |
| Live provider calls, Erudience runs | **not run** |

## Known issues, risks, missing access
- **Security issues in the source apps (outside this repository):**
  - News to Blog: the autopilot tick has no authentication (N1); AI endpoints are unauthenticated (N2); users can raise their own plan and budget (N3).
  - Marketing Mouse: server functions use the service-role client with no auth (M1); Google tokens are fetched without ownership checks (M2).
  - Whether either app is deployed is **unknown**. Owner decision D15.
- **Erudience prerender drift:** 10 pages' prerendered HTML says sentences the live page does not, including the privacy page. Needs Erudience to regenerate its static content; reported, not changed.
- **Erudience consent withdrawal bug:** after "Cookie settings" and then Reject, analytics kept running until the next full page load.
  - Fixed in a draft PR: https://github.com/bishal-paul-git/erudience-flow-engine/pull/78 (commit `162906d`).
  - The bug was reproduced and the fix verified in headless Chromium on a local build.
  - **Not deployed.** Needs the owner's merge, then a check on the live site.
- Access was resolved during this session: all four source repositories were readable after the owner granted access.
- **Provider keys needed for brief 03:** a Brave Search API key, a SerpAPI key or a DataForSEO login. The owner sets them locally or as repository secrets; never paste them into chat or commit them.
- Audit findings F1 to F10 (`PHASE-0-AUDIT.md` section 4). Highest: auto-merge publishes an unseen draft (F1); the approval actor is not checked (F2); release writes to the default branch (F3); live backlink submission exists, opt-in (F4); the Supabase template is single-tenant with a replayable token (F5); large-site Search Console truncation (F6).
- Owner decisions pending:
  - Approve or amend D1 to D15, especially:
    - D13: hosted UI on TanStack Start, with engine jobs in a separate Node worker.
    - D14: confirm you own and relicense the source-app code, which has no licence.
    - D15: whether the source apps are live.
  - D11 (auto-merge and release semantics).
  - F4 (keep the backlink submitter?).
  - Where hosted code lives (D1 proposes `cloud/` in this repository).
  - Business model (`docs/strategy.md`).

## Usage and cost
No paid API calls were made this session. Hosted cost model is proposed in D9; no figures exist yet.

## Departments (D16, approved by the owner 2026-10-18)
- **Step 1, done (local, not pushed):**
  - 27 agents moved to `departments/<dept>/agents/`, across 8 departments with charters.
  - `src/core/agents.mjs` lists them, and `init`, `upgrade`, the site build, tests and `.claude-plugin/plugin.json` use it.
  - Installed projects are unchanged (flat `seo-autopilot/agents/`).
  - Checks: `npm test` 260/260; Python 23 OK; `init` in a temp repo gave 27 agents with the right `department:` lines; `upgrade --diff` reported up to date.
  - Not checked: Claude Code actually loading the plugin's explicit `agents` list (only the JSON shape is tested).
  - Not changed: `.github/workflows/pages.yml` still filters on `agents/**`, because this session cannot push workflow files. The site still rebuilds because `site/**` changes with every release.
- **Step 2, done (local, not pushed):**
  - New `seo-internal-linker` (28 agents).
  - Orphan, deep and anchor findings and `links.json` go to it; heading findings go to the snippet optimizer.
  - Each agent's Inputs now name every report the router sends (test-enforced).
  - Fixed the router dropping a second reason's instruction.
  - Single owners for markup and robots changes.
  - Checks: `npm test` 262/262; Python 23 OK.
- **Step 3, done (local, not pushed):**
  - `src/analysis/work-orders.mjs`: orders, dependencies, page locks, waves, validators and the approval gate.
  - Router steps now carry every target page; site-wide rules count as the whole site.
  - `team` writes `work-orders.json`, plus a waves section in `agent-plan.md`.
  - New `work` job (status file `work-status.json` acts as the lock).
  - `seo-check` template runs `facts` on changed content.
  - Checks:
    - `npm test` 272/272;
    - a simulated PR branch with a new page claiming "47%" was flagged by the new check step;
    - `init` substitutes `{{SPEC}}` in `seo-check.yml`.
  - Not done:
    - Nothing runs agents from the work orders automatically. A person or the coordinator uses `run work`.
    - The fact-checker *agent* is not in the PR pipeline; the deterministic `facts` check is. Adding the agent would need a Claude login in `seo-check`, which runs with no secrets by design.
- **Step 5, first agent done (local, not pushed):**
  - `inbound` job (`src/analysis/inbound.mjs`, `src/jobs/inbound.mjs`), `seo-backlink-auditor` (29 agents), router rules, weekly step, config `site.inbound.dir`, playbook section.
  - Checks: `npm test` 280/280, including 6 inbound tests on sample CSVs.
  - **Not verified on a real Search Console export:** column names are matched flexibly but were not checked against a real download. Next: the owner exports Links from Search Console for Erudience and we run it.
- **Step 5, second agent done (local, not pushed):**
  - `logs` job (`src/analysis/logs.mjs`, `src/jobs/logs.mjs`), `seo-log-analyst` (30 agents), router rule, `noindex` in compact audit pages, `.gitignore` line from `init`, playbook section.
  - Checks: `npm test` 288/288 (6 logs tests, including that no IP reaches a report); Python OK; `go test` ok.
  - Not checked:
    - real access logs;
    - `--verify` DNS against real crawler addresses (no network in tests).
- **Skills layer done (local, not pushed):**
  - `departments/skills/` with `answer-first-copy` and `digital-pr`; `listSkills()`; `init`/`upgrade` copy skills.
  - 7 agents reference skills; a two-way consistency test; skills section in the org chart.
  - Checks: `npm test` 289/289.
- **D17 graduated autopilot, first part done (local, not pushed), 2026-10-20:**
  - Autonomy policy and `autopilot` job.
  - `seo-automerge`: review on the same commit, policy decision, pinned merge, kill switch.
  - `seo-implement`: approver must have write access; PR labelled with the kind of change.
  - `seo-release`: kill switch.
  - Rule #1 changed in `CLAUDE.md`.
  - Checks:
    - `npm test` 298/298, including 7 autonomy tests and the new workflow assertions;
    - Python OK;
    - all workflow templates parse as YAML;
    - `bash -n` on the changed scripts.
  - **Not tested on GitHub:** the workflows have not run on a real repository; `gh` and GitHub APIs are not exercised by the tests.
  - Part 2: the scheduled `seo-autopilot` workflow. It picks one allowed proposal issue twice a day, then drafts, checks (no secrets), reviews and merges it through the existing workflows, now callable.
    - Checks: `npm test` 303/303; YAML parse; `bash -n` on all changed run scripts; `init` installs it with placeholders filled.
    - **Not run on GitHub.** Reusable-workflow calls, check-run names ("job / build") and permissions are untested live.
  - Parts 3 to 5 (2026-10-20):
    - `seo-watch` + `watch` job: reverts an `undo`-level change through a pull request when a changed page errors, the change added a noindex, or clicks fell clearly more than the rest of the site over 14 days. Indexing status is not judged.
    - `seo-monthly` + `monthly` job: autopilot ledger, rollbacks, 28-day traffic vs the 28 before, audit findings vs last month, experiments; one issue a month.
    - Work orders drive agents: `team` opens `seo-work-order` issues for ready snippet, link and refresh orders the policy allows; the loop drafts them.
    - Checks: `npm test` 323/323; YAML parse; `bash -n`; `init` installs 12 workflows.
    - **Not run on GitHub**, and the watch thresholds are untested on real traffic.
  - D17 roadmap is code-complete except the AI reviewer as a required check in more repositories (needs each site owner's Claude key).
- **Next, step 4:** add sources and "last reviewed" dates to every playbook, from `docs/research/REFERENCES.md`, with a test. It is blocked on verifying the links: page fetches are blocked in this session's network policy.

## Next milestone
**Push this branch and run the autopilot on one real site** (blocked: this session's GitHub writes return 403; the owner pushes from their PC per RESTORE.md). Acceptance: on a test repository with `SEO_AUTOPILOT=true` and `SEO_REVIEW=true`, one proposal goes from issue to merged PR with every check green, one deliberate bad change is reverted by `seo-watch`, and `seo-monthly` opens its issue. Then: **owner review of Phase 0.** Acceptance criterion: the owner approves or amends D1 to D15 and answers D11, D14 and D15. Phase 1 (hosted foundation) starts only after that.

Exact next actions, independent of the review:
1. Brief 01:
   - Items 1 to 7 are done (brief 01 complete, not yet released):
     - heading and meta audits;
     - redirect tooling;
     - facts guard;
     - consent recipe;
     - conversion recipe and the `conversions` job;
     - links job;
     - render job.
   - Remaining:
     - the release;
     - the Erudience PR.
   - Then the recipe items (4 and 5), item 6 (links job) and item 7 (static-content rule).
   - Release, then open the Erudience PR that swaps its scripts for the product jobs.
2. Brief 03, once keys exist: live `citations` with one provider and sanitised fixtures.
3. Brief 04, next part: record real agent outputs for the four cases and add cases per agent.
4. Small fixes: F2, F6, F7.

Resume prompt (autopilot): "Read CLAUDE.md and docs/implementation/STATUS.md. Branch claude/hopeful-euler-662mu5 holds D16 and D17 (not yet pushed or run on GitHub). Push it, open a draft PR, then test seo-autopilot, seo-watch and seo-monthly on a test repository and fix what breaks." Older resume prompt: "Read CLAUDE.md, docs/implementation/STATUS.md, PHASE-0-AUDIT.md and DECISIONS.md. If the owner has approved Phase 0, start Phase 1 per SEO-PRODUCT-BUILD-BRIEF.md and D1-D15; otherwise continue brief 01 (Erudience tooling port) on a feature branch."
