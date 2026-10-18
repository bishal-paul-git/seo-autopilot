# Implementation status

Last updated: 2026-10-18 (UTC).
- Branch `claude/hopeful-euler-662mu5`, audited base commit `8d7b62c` (v2.13.0 plus docs). Pull request: see CHANGELOG entry.
- Environment: Linux cloud container, Node 22.22.0, Go 1.24.7, Python 3.13.16. Earlier entries came from the owner's Windows 11 machine.

## Goal and phase
One sellable SEO product for small agencies and site owners (`SEO-PRODUCT-BUILD-BRIEF.md`).
- **Current milestone: Phase 0 (baseline and reuse audit). Partly done, awaiting owner review.** The SEO Autopilot half is written in `PHASE-0-AUDIT.md`, with proposed architecture decisions D1 to D11 in `DECISIONS.md`. The Marketing Mouse and News to Blog half is **blocked: no access**.
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
| Not implemented: hosted app, tenancy, billing, CMS connectors, npm package, Marketplace Action, plugin | n/a |

## Verified (evidence, not just source)
| Capability | Evidence | Kind |
|---|---|---|
| Node core | `npm test` 206/206 pass on this branch; 197/197 on a clean clone of `8d7b62c` | unit, fixture and mocked tests |
| Go crawler | `go test ./...` ok | unit |
| Python runtime | 23 tests ok | unit with stub SDK |
| Eval graders | 9 tests: graders pass good samples and fail bad ones | unit on hand-written samples. **No agent evaluated** |
| Search Console, GA4, PageSpeed | used daily by Erudience per earlier STATUS; **not re-checked this session** (Erudience repo not accessible) | real integration, prior evidence only |
| `citations` providers | mocked only; **never run live** | mock |

## Deployed
Tag `v2.13.0` (plus moving tags `v2`, `v2-stable`) and the GitHub Pages site, unchanged this session. **Nothing from this session is released or deployed.** No npm package, no hosted service.

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
- **Access blocked:** `marketingmouse`, `feed-to-site-magic`, `keel` and `erudience-flow-engine` are not readable with this session's GitHub credential. This blocks the reuse half of Phase 0 and all of brief 01. Fix: grant the Claude GitHub App access to them, then start a session with them selected.
- **Provider keys needed for brief 03:** a Brave Search API key, a SerpAPI key or a DataForSEO login. The owner sets them locally or as repository secrets; never paste them into chat or commit them.
- Audit findings F1 to F10 (`PHASE-0-AUDIT.md` section 4). Highest: auto-merge publishes an unseen draft (F1); the approval actor is not checked (F2); release writes to the default branch (F3); live backlink submission exists, opt-in (F4); the Supabase template is single-tenant with a replayable token (F5); large-site Search Console truncation (F6).
- Owner decisions pending:
  - Approve or amend D1 to D11.
  - D11 (auto-merge and release semantics).
  - F4 (keep the backlink submitter?).
  - Where hosted code lives (D1 proposes `cloud/` in this repository).
  - Business model (`docs/strategy.md`).

## Usage and cost
No paid API calls were made this session. Hosted cost model is proposed in D9; no figures exist yet.

## Next milestone
**Phase 0 completion.** Acceptance criteria:
- Source repositories audited, with SHAs, licences and the brief's checklist.
- Reuse matrix rows for their modules.
- The owner approves or amends D1 to D11.

Exact next actions:
1. The owner grants repository access and answers the pending decisions above.
2. Audit Marketing Mouse and News to Blog and add their rows to `PHASE-0-AUDIT.md`.
3. In parallel:
   - brief 03, once keys exist (live `citations` with one provider, sanitised fixtures);
   - brief 04 next part (record real agent outputs for the four cases, add cases per agent);
   - small fixes F2, F6, F7.

Resume prompt: "Read CLAUDE.md, docs/implementation/STATUS.md and PHASE-0-AUDIT.md. If the source repos are now accessible, audit them per SEO-PRODUCT-BUILD-BRIEF.md and complete the reuse matrix; otherwise continue brief 04 or 03. Do not start the hosted app until the owner approves the decisions in DECISIONS.md."
