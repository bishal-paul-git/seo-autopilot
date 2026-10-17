# Implementation status

Last updated: 2026-10-18 (Europe/London), branch `main`, audited base commit `8cdf874` (v2.13.0). Environment: Windows 11, Node 22.14; Go and Python engines present but not re-run today.

## Goal and phase
One sellable SEO product for small agencies and site owners (see `SEO-PRODUCT-BUILD-BRIEF.md`). Current phase: the open-source engine and agent team are built and in production use on Erudience; the hosted product (brief phases 1 to 6) is **not started**. Roadmap briefs: `docs/roadmap/`. Strategy: `docs/strategy.md`.

Architecture in short: dependency-free Node core (`src/jobs`, `src/analysis`, `src/audit`), optional Go crawler (`engines/go`) and Python agent runtime (`engines/python`), 27 agent definitions (`agents/`), 26 playbooks (`knowledge/`), GitHub Actions templates (`templates/workflows`), static landing site (`site/`).

## Capabilities
| Capability | Implemented | Verified | Deployed |
|---|---|---|---|
| Jobs: audit, analyze, priorities, experiments, speed, geo, deepdive, refresh, profile, team, consent, ymyl, pace, digest, indexing queue, IndexNow, dashboard, release/schedule | yes | unit and end-to-end tests with fixtures; most run on Erudience's real data | v2.13.0 tag and GitHub Release; used by Erudience weekly and daily workflows |
| Site profile and edit/advise mode | yes | unit tests; tried on 12 live sites (several false positives fixed; `gohugo.io` still Unknown, `ghost.org` reads as Hugo) | v2.13.0 |
| Agent routing (`team`) | yes | unit tests; run on Erudience | v2.13.0 |
| 27 agent definitions, 26 playbooks | yes | structure and reference tests; 8 agents run once each on Erudience (report only) | v2.13.0 |
| Agents running unattended | only drafter, refresher, editor (GitHub Actions) and strategist, researcher (Python runtime) | partly | partly |
| `citations` (Brave, SerpAPI, DataForSEO) | yes | **mocked responses only**; never run against the real APIs | v2.13.0 |
| Hosted app, multi-tenant, billing, CMS connectors | no | n/a | no |
| npm package, GitHub Marketplace Action, plugin | no | n/a | no |

## This session's changes
Code and content (releases v2.10.0 to v2.13.0, see `CHANGELOG.md`): 21 new agents, 10 new playbooks, `profile`, `team`, `consent`, `ymyl`, `pace`, `citations` jobs, init and weekly workflow updates. Documentation only (this commit): `CLAUDE.md` merge, `docs/strategy.md`, `docs/roadmap/*`, `docs/implementation/*`.

## Checks
| Command | Result | Notes |
|---|---|---|
| `npm test` (Node) | pass: 196 pass, 0 fail, 1 skipped (pre-existing) | run 2026-10-18; mocked and fixture tests |
| Python engine tests (`python -m unittest discover -s tests` in `engines/python`) | pass, 23 tests | last run at v2.11.0, not re-run today |
| Go crawler tests | not run today | CI runs them |
| CI on tags v2.10.0 to v2.13.0 | pass (release, ci, pages) | GitHub Actions |
| Real external integrations (Search Console, GA4, PageSpeed) | exercised daily through Erudience's workflows | `citations` providers: not run live |

## Deployment
Tag `v2.13.0` (and moving tags `v2`, `v2-stable`) published; GitHub Pages site built by CI. Nothing published to npm. Erudience consumes `github:bishal-paul-git/seo-autopilot#v2`. No hosted service exists.

## Known issues and gaps
See `docs/roadmap/09-gaps-and-polish.md`. Highest: `citations` untested live; thin-content and `ymyl` false alarms; stale request-indexing lists; only some agents runnable unattended; agent output quality only spot-checked.

Owner decisions pending: business model (recommendation in `docs/strategy.md`), whether to follow the agency-first plan in `SEO-PRODUCT-BUILD-BRIEF.md`, provider keys for citations, named reviewers for sensitive Erudience guides.

## Next milestone
Phase 0 of the product brief: baseline and reuse audit of Marketing Mouse and News to Blog (not started). In parallel, roadmap briefs 01 (port Erudience tooling) and 03 (live provider tests) are independent of it.

Resume prompt: "Read CLAUDE.md, docs/implementation/STATUS.md and SEO-PRODUCT-BUILD-BRIEF.md. Do Phase 0 (reuse audit and architecture decisions) and record it in DECISIONS.md."
