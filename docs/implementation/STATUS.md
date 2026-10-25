# Implementation status

Last updated: 2026-10-25, Asia/Dhaka. Branch: `feat/work-evidence-and-system-trace`. Audited base: `ac21a311753e8d7c6a39f3b48036203810f3f862` (main, v2.20.0). Environment: Linux, Node 24.22.1, Python 3.12.14; Go unavailable.

Goal: a complete commercial agentic SEO platform, extending the existing engine and interface. Current milestone: reconcile the live system and make work evidence reliable. The [historical status](STATUS-ARCHIVE-2026-10-23.md) preserves earlier sessions; do not use its old counts/releases as current status.

Architecture: dependency-free Node CLI (`src/jobs`, `src/analysis`, `src/audit`), optional Go/Python engines, eight departments with **38 agent definitions**, **57 jobs**, **30 knowledge documents**, **seven shared skills**. Local UI (`src/ui`), generated dashboard (`src/dashboard`), static product site (`site`), remote read-only connector (`cloud/connector`). The live Hostinger interface is a separate existing artifact; its source/deployment revision is not yet identified. Full [keep/improve/missing map and screen trace](LIVE-SYSTEM-TRACE-2026-10-25.md).

## Implemented

| Capability | Source / limits |
|---|---|
| Existing collection, diagnosis, research, routing, drafting, checking, D17 autonomy, monitoring | Existing jobs, analysis and workflow templates retained; integrations vary in verification |
| Work identity, dependency invalidation, attempt/failure history, explicit capped retries | `src/core/work-state.mjs`, `src/jobs/team.mjs`, `src/jobs/work.mjs`; local file state, not a hosted queue |
| Local exclusive work transactions and atomic JSON replacement | Same module; crashed locks fail closed; not distributed coordination |
| Work evidence in existing UI and reports | `src/core/collect.mjs`, `src/ui/app.html`, `src/dashboard/template.html`; operator-recorded checks, outputs/costs; no publication receipts |
| New functional regressions | `test/work-state.test.mjs`; local temporary projects, no customer data |

## Verified

| Check | Evidence / result |
|---|---|
| Base main / branches / releases / PRs / CI | Refreshed via GitHub and git; main `ac21a31`, latest release v2.20.0, three existing branches, no open PRs at start; CI run 39988360211 success on base |
| Live browser and served HTML | Dashboard/team open without login; all site data bundled; client route hides navigation only; no analytics API calls in served artifact |
| Hostinger serving platform | HTTP 200; `platform: hostinger`, `panel: hpanel`; last-modified 2026-10-24 17:12:02 UTC. Account/upload method/Git revision unknown |
| Focused existing tests | `node --test test/work-orders.test.mjs test/ui.test.mjs test/core.test.mjs`: 25 passed initially; combined focused suite later passed 32/32 |
| New work regressions | `node --test test/work-state.test.mjs`: 7 passed after final changes, including separate-process contention and generated dashboard script rendering |
| Full Node suite | Initial `npm test`: 469 total, 467 passed, 1 failed (existing browser render test: installed Playwright has no Chromium), 1 skipped (Go unavailable). Browser download failed with invalid/truncated archive; tests were not weakened |
| Final full suite attempt | 470 total, 468 passed, 1 failed (same untouched missing-Chromium render test), 1 skipped (Go). Latest identity/cost refinements then rechecked by all 7 new regressions |
| Available-suite verification | `node --test --test-skip-pattern='render job end to end:' test/*.test.mjs`: 468 passed, 0 failed, 1 skipped (Go); the missing-browser test was explicitly excluded, not fixed |
| Static site / whitespace | `node scripts/build-site.mjs` passed; regenerated existing demo/roadmap pages. `git diff --check` passed |
| Python | `python3 -m unittest discover -s tests` in engines/python: 27 run, OK, 1 skipped |
| Go | `go test ./...`: not run; command unavailable |
| Live external providers / live agent execution | Not exercised this session; no site credentials injected. Browser snapshot is not verification of Google connections |

## Deployed

| Surface | Actual evidence |
|---|---|
| Engine release and product Pages | v2.20.0 on base `ac21a31`; release/Pages workflows succeeded (prior to this session) |
| seo.erudience.com | Existing Hostinger-served HTML, dated 24 October; source SHA unknown |
| This branch | Not merged, released or deployed. No Hostinger writes, customer-site changes, outreach or purchases |
| Hosted connector / tenancy / billing / hosted execution | No new deployment evidence. Code is not proof of a running customer platform |

## Changes, compatibility and cost

No dependencies, config schema, database migrations or publication-policy changes. `work-status.json` is now version 2: old results without site/work identity are archived and reset rather than trusted. Changed running work blocks replanning; see [migration and lock recovery](../work-tracking.md). Retry limit is three attempts per definition. Actual costs are optional operator entries; unknown remains unknown. No paid calls made. Budget enforcement, executor receipts, distributed leases and a complete publication/measurement cycle remain missing.

## Blockers and next actions

1. Automatic approval review blocked inspection of a separate private customer repository that may contain the dashboard generator. Obtain approval for its dashboard/deployment files before inspecting them. No workaround was attempted.
2. Hostinger account tools are unavailable. Serving platform confirmed from HTTP, but account, build command, output directory, refresh/upload mechanism and deployed Git SHA remain unknown. Identify and reproduce the actual live generator before changing it.
3. The current client route is presentation only: the HTML includes all bundled sites. Secure data delivery and customer/project access checks are required before customer use; no private reports copied into this public engine.
4. Reuse `collectSiteData().work` in the actual interface once traced. Show source timestamps; separate planned assignments from completed runs. Do not import an alternative interface or change branding.
5. Verify authorised providers individually; then complete one real opportunity → work order → validated change → policy-governed publication → measurement. No customer website changed just to demonstrate a cycle.

Resume: “Read CLAUDE.md, STATUS.md, LIVE-SYSTEM-TRACE-2026-10-25.md and work-tracking.md. Refresh main/PRs, preserve this branch and Claude work. Resolve dashboard-source access/deployment trace; reuse the existing interface and work contract. Keep fixture/local, live and deployed evidence separate.”
