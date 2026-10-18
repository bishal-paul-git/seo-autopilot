# Implementation status

Last updated: 2026-10-18 (UTC).
- Branch `claude/hopeful-euler-662mu5`, audited base commit `8d7b62c` (v2.13.0 plus docs). Draft PR: https://github.com/bishal-paul-git/seo-autopilot/pull/8.
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
**v2.14.0 is half released (2026-10-18).**

Done:
- PR https://github.com/bishal-paul-git/seo-autopilot/pull/8 is merged into `main`. Merge commit `f10f3b3`, `package.json` 2.14.0, `CHANGELOG.md` has a `## 2.14.0` section, `site/` is regenerated.
- `npm test` passes 258 of 258 on `main`; Go and Python pass.

**Not done:** the tags.
- The session's git proxy refused `git push origin v2.14.0` and `git push -f origin v2 v2-stable` ("remote end hung up"), and the available GitHub tools cannot create tags.
- So there is no GitHub Release for 2.14.0 yet.
- `v2` and `v2-stable` still point at v2.13.0 (`8cdf874`). Erudience, which installs `#v2`, still runs 2.13.0.
- On `main` (`f10f3b3`), the `ci` and `pages` workflows both succeeded at 2026-10-18 16:36 UTC, so the landing site is published from v2.14.0.

To finish, from a machine with push rights:
```
git fetch origin && git checkout main && git pull
git tag v2.14.0 f10f3b3 && git tag -f v2 f10f3b3 && git tag -f v2-stable f10f3b3
git push origin v2.14.0 && git push -f origin v2 v2-stable
```

Consider leaving `v2-stable` for `promote-stable.yml` a few days later. That workflow treats `v2-stable` as a delayed tag; CLAUDE.md says to force it with `v2`.

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

## Next milestone
**Owner review of Phase 0.** Acceptance criterion: the owner approves or amends D1 to D15 and answers D11, D14 and D15. Phase 1 (hosted foundation) starts only after that.

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

Resume prompt: "Read CLAUDE.md, docs/implementation/STATUS.md, PHASE-0-AUDIT.md and DECISIONS.md. If the owner has approved Phase 0, start Phase 1 per SEO-PRODUCT-BUILD-BRIEF.md and D1-D15; otherwise continue brief 01 (Erudience tooling port) on a feature branch."
