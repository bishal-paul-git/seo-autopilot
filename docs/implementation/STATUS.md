# Implementation status

Last updated: 2026-10-23 16:30 UTC (v2.20.0 prepared).
- **v2.20.0 prepared (branch `claude/hopeful-euler-662mu5`):** the `listings` job (Business Profile and Merchant Center, packs step 4) and YouTube results in `keywords` (PR #21, `c70b7aa`). v2.19.0 is released (`e3f700a`: `gsc`, Keyword Planner, Wikipedia and Stack Exchange). `npm test` 463/463. Every new source is tested with recorded-style responses only; none has made a live call. Product rename proposed (D22), waiting for the owner's choice.
- **Now:** v2.18.0 released (https://github.com/bishal-paul-git/seo-autopilot/releases/tag/v2.18.0; `v2.18.0`, `v2` and `v2-stable` at `b601534`). It includes specialist packs steps 1 to 3: detection, routing and install (D21), and the `local` and `shop` jobs. Not done: connector deployment, npm publish (no `NPM_TOKEN`), real-site runs of `local` and `shop`. Next build: packs step 4 (Google Business Profile, Merchant Center) and more packs (brief 12).
- Erudience was upgraded to 2.16 by https://github.com/bishal-paul-git/erudience-flow-engine/pull/91 (merged, `ce934ba`). No scheduled run with 2.16 has been observed yet.
- Cloudflare: the owner's account is `8566…5c39`. KV namespace `OAUTH_KV` (`27fd7750abf34014a04036e6f36b827c`) exists there and is bound in `cloud/connector/wrangler.toml`. An unused KV namespace, `seo-autopilot-connector-OAUTH_KV`, sits in account `0342…476d` and can be deleted. A Pages project, `seo-autopilot-gls`, publishes a static copy of the repository and is not the connector. This session could not deploy: the injected Cloudflare token never reached it, and Claude in Chrome is not available in cloud sessions.
- Branch `claude/hopeful-euler-662mu5`, **pushed 2026-10-22** and merged with `main` at `57c533c` (v2.15.0). Draft PR: https://github.com/bishal-paul-git/seo-autopilot/pull/12. `npm test` 397/397 on the merged head.
- **Release 2026-10-22:** PR #12 merged into `main` (`1d94490`), plus Dependabot #6 and #7. `v2.16.0` committed on `main` (`ffb993b`, `npm test` 397/397). This session's proxy refuses tag writes (git and API both 403), so a new `tag-release` workflow (`.github/workflows/tag-release.yml`, `de4c8e8`) was added and run from GitHub (run 39817957254, success): it ran `npm test`, then tagged `v2.16.0` and moved `v2` and `v2-stable`, all at `de4c8e8` (checked with `git ls-remote`), and published the [GitHub Release v2.16.0](https://github.com/bishal-paul-git/seo-autopilot/releases/tag/v2.16.0). Future releases: Actions > tag-release > Run workflow. Installed sites still need `seo-autopilot upgrade --apply` to get the new workflows; none has been upgraded or run on a real site yet.
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
| **Hosted connector (D20):** remote MCP server for Claude and ChatGPT; OAuth 2.1 with GitHub sign-in; reads the `seo-data` branch through a GitHub App (Contents: read) | `cloud/connector/`, `src/mcp/core.mjs` |
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
| Hosted connector | `test/connector.test.mjs` (5 tests, GitHub and KV faked); `wrangler deploy --dry-run` bundles it; under `wrangler dev`, curl checks of discovery, registration, consent, the refused cross-site consent and the redirect to GitHub. **Never used with real GitHub, Claude or ChatGPT** | unit, plus the local Workers runtime |
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

- Erudience: PR #91 merged into `main` (`ce934ba`, 2026-10-22 17:17 UTC). The 2.16 workflows take effect on the next scheduled run, which has **not been observed yet**.
- Hosted connector: **not deployed**. Deploying it needs the owner's GitHub App, Cloudflare KV namespace and secrets (`cloud/connector/README.md`).

No npm package. No hosted service is running.

## This session's changes
- **Erudience (site repository):** the 2.16 upgrade, PR #91, merged. Details in `CHANGELOG.md` in this folder.
- **Code (this branch):**
  - `src/mcp/core.mjs` (new): the shared protocol and read tools. `src/mcp/server.mjs` now runs on it, with a file store; its API is unchanged.
  - `cloud/connector/` (new): Worker, GitHub state-branch store, crypto helpers, `wrangler.toml`, README.
  - `test/connector.test.mjs` (new).
  - No dependency, migration, config-schema or workflow changes. `cloud/` is outside the npm `files` list.
- **Docs:** `docs/mcp.md`, DECISIONS D20, the root `CHANGELOG.md` (Unreleased), and the CHANGELOG in this folder.

## Checks run this session
| Command | Result |
|---|---|
| `npm test` | pass, 402 of 402 (397 before, plus 5 connector tests) |
| `npx wrangler@4.45.0 deploy --dry-run` (cloud/connector) | bundled, 30.25 KiB, no dependencies |
| `wrangler dev`, then curl | discovery OK; `/mcp` returned 401 with `WWW-Authenticate`; `/register` returned 201; the consent page set its cookie; POST without the cookie returned 400, with it 302 to GitHub; a made-up code got `invalid_grant` |
| Erudience: workflow YAML parses; `seo-autopilot doctor` | OK, 92 pages. The sitemap was unreachable from this sandbox (environment limit) |
| Real GitHub sign-in, Claude or ChatGPT as clients, deployment, live jobs on Erudience | **not run** |

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
- **Hosted connector (D20):**
  - It needs the owner's GitHub App and a deployment go-ahead.
  - Known limits: KV makes single use near-exact, not exact; `/register` has no rate limit yet; there is no privacy note yet.
  - Before customers use it, the operator of a public instance holds encrypted GitHub tokens, which needs a privacy policy.
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
- **D19 site intelligence and MCP server (local, not pushed), 2026-10-20:** `mcp`, `linkgraph`, `vitals`, `changes`, `schema` and `entity`, plus intent labels on rank rows.
  - **Verified:** `npm test` 388/388, including a real stdio MCP session through the CLI.
  - **Not verified:** the CrUX, Knowledge Graph and Wikidata APIs (mocked); MCP with a real Claude Desktop or Claude Code client.
  - **Next:** connect the MCP server in Claude Code on a real site and ask for `site_overview`. Run `linkgraph` and `schema` on a real site (free, no key).
- **D18 research suite (local, not pushed), 2026-10-20:** `keywords`, `rank`, `gap`, `optimize`, `ai-visibility`, `authority` and Python `forecast`. They replace a paid SEO suite with Search Console plus the user's own keys. See `docs/research-suite.md`.
  - **Implemented:**
    - the jobs, analysis modules and provider clients;
    - router rules;
    - workflow steps (paid steps are opt-in: `SEO_RANK_LIVE`, `SEO_AI_VISIBILITY`);
    - the config block and agent inputs.
  - **Verified:**
    - `npm test` 364/364;
    - Python 27/27;
    - Go ok;
    - forecast CLI run end to end on synthetic data.
    - Every provider is mocked.
  - **Not verified:** no live call to Bing, DataForSEO, Open PageRank, autocomplete, Brave, SerpAPI, Perplexity, OpenAI, Anthropic or Gemini; no run on a real site.
  - **Next:** run `keywords`, `rank` and `optimize` on a real site with Search Console (free). Then one paid key at a time, checking each report against the provider's own dashboard.
- **Next, step 4:** add sources and "last reviewed" dates to every playbook, from `docs/research/REFERENCES.md`, with a test. It is blocked on verifying the links: page fetches are blocked in this session's network policy.

## Next milestone
**Deploy the hosted connector in Cloudflare account 8566 and use it from Claude on Erudience's reports.** Acceptance:
- Claude adds `https://<worker>/mcp`, signs in with GitHub, and `site_overview` returns Erudience's real reports;
- a repository without the app installed stays invisible;
- reconnecting after an hour works.

Then repeat in ChatGPT.

Next actions, in order:
1. **Owner, Cloudflare (account 8566):** Workers & Pages → Create → **Workers** tab → Import a repository → `seo-autopilot`, branch `main`, root directory `cloud/connector` → Deploy. Note the `….workers.dev` address.
2. **Owner, GitHub:** create the GitHub App with callback `https://<worker>/callback`, Contents read-only, webhook off, installable only on this account. Then generate a client secret. Claude can prepare a pre-filled creation link once the address is known.
3. **Owner, Cloudflare:** Worker → Settings → Variables and Secrets. Add `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `TOKEN_KEY` (32 random bytes, base64). Set `GITHUB_APP_SLUG` in `wrangler.toml`.
4. Install the app on `erudience-flow-engine`. In Claude: Settings → Connectors → Add custom connector → `https://<worker>/mcp`. Run the acceptance checks and record the evidence here.
5. **Erudience:** check that the first 2.16 `seo-daily` and `seo-weekly` runs succeed. Then add the free keys as repository secrets: `CRUX_API_KEY`, `GOOGLE_KG_API_KEY`, `OPENPAGERANK_API_KEY`, `BING_WEBMASTER_API_KEY`.
6. **Owner decision:** the local SEO playbooks from `54595d8` are written around UK housing-disrepair legal work. Keep them as a general vertical, or move the client-specific parts to that client's repository (rule: no site-specific content here).
7. Before others use the connector: a rate-limiting rule for `/register`, and a privacy note. Next build, after real use: a hosted job runner, so `run_job` works from Claude.
8. Release v2.17.0 (connector, local agents) with Actions → tag-release, once the connector has been tested live.
9. **Stage A launch (2026-10-23):** v2.17.0 is prepared, with the launch checklist in `docs/launch/README.md`. Owner items: the `NPM_TOKEN` secret, the Marketplace tick on the release, Discussions and labels, Pages domain, the demo video. The case study waits for real Erudience data.
10. **Owner, Google Ads (for Keyword Planner):** in a Google Ads manager account, Tools > API Center > request a developer token, then apply for Basic access. Add `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID` (and `GOOGLE_ADS_LOGIN_CUSTOMER_ID`) as repository secrets, plus either the OAuth trio or the service account added as an Ads user. Never paste them in chat. Then run `keywords "<seed>"` once and record the evidence here.
11. **Logged for later (owner, 2026-10-23):**
   - vertical packs, so each site gets the specialist agents and data jobs for its kind of business: `docs/roadmap/12-vertical-packs.md`;
   - going live, with an open-source launch first and then the hosted product: `docs/roadmap/13-go-live.md`.

Resume prompt: "Read CLAUDE.md and docs/implementation/STATUS.md in seo-autopilot. Continue the Next milestone: deploy cloud/connector in Cloudflare account 8566, then verify it from Claude on Erudience's reports, and record the evidence."
