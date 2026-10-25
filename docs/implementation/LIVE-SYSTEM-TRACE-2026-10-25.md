# Live system trace — 25 October 2026

Scope: the existing `https://seo.erudience.com/` interface and this engine, audited at `ac21a311753e8d7c6a39f3b48036203810f3f862`. No customer reports, credentials or customer website changes belong in this public repository.

## What is established

- Engine main remains `ac21a31`, release `v2.20.0`. Branches refreshed: `main`, `claude/hopeful-euler-662mu5` (`6614981`), `feat/refinements-pace-thin-lang` (`7acfcae`). No open PRs at audit start. CI [39988360211](https://github.com/bishal-paul-git/seo-autopilot/actions/runs/39988360211) passed on main; the Pages and tag-release runs also succeeded. These do not prove live provider operation or deployment to Hostinger.
- Source inventory: **57 registered jobs, 38 agent definitions, eight departments, 30 knowledge documents, seven shared skills**. Counted from `src/jobs/index.mjs`, `src/core/agents.mjs` and `knowledge/`.
- Browser opened the live interface without a login prompt. The served HTML contains the complete multi-site `DATA` object and `DEPTS` registry. There are no `fetch`/XHR requests in this file. Analytics screens render bundled snapshots; generating or loading the page does not refresh Google data.
- Served artifact SHA-256: `2bbbcca91d94f0747a49956e758e64b43d50bae564e89e359666b83ee3dfa142`. This identifies the downloaded bytes, not a Git revision.
- HTTP response: `platform: hostinger`, `panel: hpanel`, 200, content length 188252, last-modified `2026-10-24T17:12:02Z`. This confirms the serving platform, **not** the account, upload mechanism or deployed Git SHA.
- The live UI is different from `src/dashboard/template.html` and `src/ui/app.html`. An inspected older private dashboard artifact also differs. An inspected site-specific `scripts/seo-dashboard.mjs` builds a different single-site report, not this live multi-site shell. Do not replace the live interface with any of these.
- No Hostinger hosting MCP server is connected here. Account-side deployment configuration could not be checked. Automatic approval review blocked inspection of a separate private customer repository; no workaround was attempted. Current source repository, generator path, build command, output directory, upload method, refresh schedule and deployed revision remain **unverified**.

## Screen and control map (functions in the served artifact, not identified repository paths)

| Existing screen | Render function / bundled fields | Backend / refresh evidence |
|---|---|---|
| Websites | `pHome`, `DATA.sites` | Embedded snapshot; no API |
| Overview | `pOverview`, `period`, `history`, `keywords`, `priorities`, `proposals`, `pages`, `audit` | Embedded snapshot; metrics not independently re-fetched |
| Traffic | `pTraffic`, `history`, `period`, `sourcesBlock` | Embedded snapshot; Analytics empty state is hardcoded |
| Keywords | `pKeywords`, `keywords`, `targets` | Filtering and tabs operate in browser memory |
| Pages | `pPages`, `pages` | Filters operate in browser memory |
| Locations | `pLocations`, page/location data | Snapshot presentation, no local SEO executor |
| Coming next | `pPlan`, `proposals`, `targets`, `priorities` | Displays a plan; does not create or execute work |
| Weekly report | `pReport`, `digest` | Previously generated Markdown rendered into HTML |
| SEO team | `pTeam`, `DEPTS`, `plan`, `runs` | Highlight combines planned assignments and run records; cannot establish completed agent work |
| Client link | `shell`, clipboard, `#/c/...` | Copies a presentation route; no authentication or server permission change |

The client route hides navigation while the complete multi-site dataset remains in the downloaded HTML. `noindex` (where present) and hidden navigation are not access control. No endpoint/tenant isolation can be verified for this static artifact. Do not add private data to it or describe client links as restricted access.

## Keep / improve / missing

| Keep | Improve | Missing / unverified |
|---|---|---|
| Current live layout, routes and customer vocabulary | Identify and version its actual generator before editing | Source/deployment provenance and account-side deployment access |
| Existing deterministic router, work orders and D17 policy | Bind status/checks to site, exact work and dependencies; retain attempts/failures | Signed executor receipts and revision-bound work validation |
| CLI, Actions, optional engines and local UI | Show saved-source dates, queued vs executed work, unknown costs | Authenticated hosted customer/project isolation |
| Existing snapshot reporting | Correct “live now”, plan-as-work and Analytics claims in the actual source | Durable hosted runner, connection verification and notification delivery |
| Graduated automation with human-only action classes | Keep actual publication policy separate from operator status | A fully observed live opportunity → publication → measurement cycle |

## Implemented in this branch

`src/core/work-state.mjs` extends the existing work system. Identity covers the site, work definition and dependency definitions; unchanged work retains status, changed work loses stale checks, and removed/changed records are archived (last 200). Legacy state without identity starts pending. Replanning cannot replace running work. Local `team`/`work` mutations share an exclusive lock and atomic JSON replacement. Retries retain attempt records and stop after three attempts per definition. Pause blocks starts/retries. Optional output references and reported attempt costs are recorded; missing spend remains unknown.

`collectSiteData` now exposes this evidence, the existing local UI has a Work tab, and the existing generated dashboard includes a Work section. No new interface or agent framework. These are **local engine surfaces**, not changes to the unidentified Hostinger source. Status/checks/costs are operator-recorded, not independently verified execution receipts. Publication and monitoring deliberately say “not recorded”. No budget enforcement or distributed locking is claimed.

## Next acceptance gate

With approval for the blocked repository's dashboard/deployment files, locate the generator by matching the served shell, then verify a reproducible build and artifact hash, Hostinger destination and deployed revision. Fix access boundaries before extending a multi-customer hosted dashboard. Reuse `collectSiteData().work` as the reporting contract; retain the current shell. Provider access must be checked separately with each authorised site's credentials. A passing schedule or fixture test alone does not verify those connections.
