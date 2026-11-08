# Open pull requests outside the Release 1 stack: audit (S4, 2026-11-08)

This audit is read-only. Nothing was closed, merged or pushed to these branches. It compares each branch with `main` (`e982f64`) and with the consolidated Release 1 head (`claude/release-1`, PR #51). Recommendations are for the owner to decide.

| PR | Branch | Last commit | Relation to #51 | Merge check | Recommendation |
|---|---|---|---|---|---|
| #35 master spec (docs) | `docs/seo-god-agency-master-plan-20261108` | 2026-11-08 | **included** in #51 | n/a | Close as superseded once #51 merges, or merge first (docs only). |
| #42 Cloudflare plan (docs) | `docs/cloudflare-execution-plan-20261108` | 2026-11-08 | **included** in #51 | n/a | Same as #35. |
| #33–#34, #36–#41, #43–#49 (stack) | `claude/*` | 2026-11-08 | **included** in #51 | n/a | Close as superseded by #51 when it merges. Keep them open until then for traceability. |
| #50 one approval per strategy (D35) | `claude/strategy-draft` | 2026-11-08 | stacked on #49; **not** in #51 | CI green | Waiting for the owner to confirm D1. If confirmed, merge it into `claude/release-1`; otherwise close. |
| #24 Dependabot `actions/setup-node` 4 → 7 | `dependabot/github_actions/actions/setup-node-7` | 2026-10-25 | independent | merges cleanly | **Still useful.** It changes only the root `action.yml` (the GitHub Action users install), which is still on `@v4`; the repo's own workflows already use `@v7`. Merge after checking that the Action's own test passes on v7. |
| #31 Portal Style A, Portfolio, client access (v2.23.0) | `claude/portal-style-a` | 2026-11-03 | branched before the Release 1 portal changes | **conflicts** with #51 (`cloud/portal/app/index.html`, README, scan files) | Open owner choice (Q5). Recommendation unchanged: decide after the Release 1 portal works. Then either re-apply the look on top of #51 as a new PR, or close. Don't merge as it is. |
| #23 Work evidence and system trace; SaaS redesign plan | `feat/work-evidence-and-system-trace` | 2026-10-25 | independent, old base `ac21a31` | **conflicts** with `main` (25 files, including `CLAUDE.md`, STATUS, CHANGELOG) | Mostly superseded: the SaaS redesign plan was replaced by the master spec (#35) and Release 1. The unique code is `src/core/work-state.mjs` + `src/jobs/work.mjs` + `test/work-state.test.mjs` (work evidence bound to site and plan), which is not on `main`. Recommend: the owner decides whether that work-evidence job is still wanted. If yes, port those three files in a small new PR. Either way, close #23 rather than rebase it. |

## Notes
- None of these PRs blocks Release 1. #51 merges cleanly into `main` on its own.
- Closing a PR is reversible (it can be reopened), but it's still the owner's call. Nothing was closed automatically.
