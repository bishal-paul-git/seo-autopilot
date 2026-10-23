# Implementation log

Dated session entries; history is preserved. Product release notes are in the root `CHANGELOG.md`.

## 2026-10-23 (brief 14 step 1: gsc job)
- **Research (docs):**
  - the GitHub topic `seo-free` (5 small tools; nothing to reuse);
  - Wizible (a competitor built on Search Console; third-party listings only, the site did not resolve from the sandbox);
  - Google Ads Keyword Planner access rules.

  Logged as `docs/roadmap/14-free-data-sources.md`.
- **Code (branch `claude/hopeful-euler-662mu5`):**
  - new: `src/analysis/gsc.mjs`, `src/jobs/gsc.mjs` (registered; MCP allowlist), `test/gsc.test.mjs` (6 tests);
  - changed: router (sitemap findings → seo-indexing-monitor; Discover and News drops → seo-strategist), `team` reads `gsc.json`, the weekly template gets a `gsc` step, the seo-indexing-monitor's Inputs, `docs/jobs.md`.
- **Checks:** `npm test` 438/438. **Not run against a live Search Console property.**

## 2026-10-23 (v2.18.0 released)
- **Deployment (release):**
  - Merged https://github.com/bishal-paul-git/seo-autopilot/pull/17 (`b601534`).
  - The tag-release workflow tagged `v2.18.0` and moved `v2` and `v2-stable` to `b601534` (checked with `git ls-remote`). The release was published by github-actions at 01:26 UTC.
  - npm was skipped: no `NPM_TOKEN`.

## 2026-10-23 (PR #16 merged; packs step 3: shop job; v2.18.0 prepared)
- **Integration:** PR https://github.com/bishal-paul-git/seo-autopilot/pull/16 merged (`a47c055`).
- **Code (branch `claude/hopeful-euler-662mu5`):**
  - new: `src/analysis/shop.mjs`, `src/jobs/shop.mjs` (registered; MCP allowlist), `test/shop.test.mjs` (6 tests);
  - changed: router (`shop.json` → seo-ecommerce, low-only findings not routed), `team` reads `shop.json`, the weekly template gets a `shop` step;
  - the seo-ecommerce agent's Inputs name `shop.json`; `docs/jobs.md` updated;
  - version 2.18.0 (CHANGELOG, `package.json`, `plugin.json`).
- **Known limit, documented in code:** the price check accepts any price shown on the page, so a stale markup price equal to a shown "was" price is not caught.
- **Checks:** `npm test` 431/431. The local and shop jobs have run only against fake sites.

## 2026-10-23 (PR #15 merged; vertical packs step 2: local job)
- **Integration:** PR https://github.com/bishal-paul-git/seo-autopilot/pull/15 merged (`48bfeb7`).
- **Code (branch `claude/hopeful-euler-662mu5`):**
  - new: `src/analysis/local.mjs`, `src/jobs/local.mjs` (registered; MCP allowlist), `test/local.test.mjs` (8 tests);
  - changed: router (`local.json` → citation auditor, local content writer), `team` passes `local.json`, the weekly template gets a `local` step;
  - config: new optional `business` setting, with schema;
  - three local agents' Inputs now name `local.json`; docs updated.
- **Bug caught by tests before commit:** stripping a country code with a regex ate digits (`+44 20…` lost the 2). Phones are now compared by their last 9 digits.
- **Checks:** `npm test` 424/424. The job has run only against a fake site; **no real local business site has been checked yet**.

## 2026-10-23 (v2.17.0 released; vertical packs step 1)
- **Deployment (release):**
  - Merged https://github.com/bishal-paul-git/seo-autopilot/pull/14 (`ae26980`).
  - The tag-release workflow tagged `v2.17.0` and moved `v2` and `v2-stable` to `ae26980` (checked with `git ls-remote`).
  - The GitHub Release v2.17.0 was published by github-actions at 01:08 UTC.
  - The npm publish step was skipped: there is no `NPM_TOKEN` secret yet.
- **Code (branch `claude/hopeful-euler-662mu5`):**
  - vertical packs step 1: `departments/verticals/packs.json`, `src/analysis/verticals.mjs`, router, install filter (`init`, `upgrade`), `doctor`, the `verticals` config setting and schema;
  - `test/verticals.test.mjs` (6 tests);
  - docs: configuration, the verticals charter, brief 12 status, DECISIONS D21, CHANGELOG Unreleased.
- **Checks:** `npm test` 415/415.

## 2026-10-23 (Stage A: open-source launch readiness, v2.17.0 prepared)
- **Code and CI:**
  - `action.yml` (one-line GitHub Action);
  - npm publish step in `tag-release.yml` (only with an `NPM_TOKEN` secret; the token reaches only that step);
  - `package.json` files trimmed (no `__pycache__`, `docs/implementation`, `docs/research`, `docs/roadmap` or `docs/launch`; `NOTICE` added);
  - `scripts/build-site.mjs`: computed counts and Start, FAQ, Compare and Roadmap pages;
  - 2 new tests in `test/agents.test.mjs`: plugin version and landing-page counts, and the Action's input safety.
- **Docs and community:**
  - `docs/compare.md`, an updated `docs/faq.md`, and a rewritten README front door;
  - `NOTICE`, `TRADEMARK.md`, DCO in `CONTRIBUTING.md`, and the waitlist issue form;
  - `docs/launch/` (checklist, post drafts, case-study template);
  - plugin and marketplace metadata.
- **Checks:**
  - `npm test` 409/409; Python tests OK; all workflow, action and issue-form YAML parses.
  - Fresh install: `npm pack`, then the tarball installed into new Next.js, Hugo and plain-HTML repositories. `init` created 12 workflows, 38 agents, 7 skills and 29 playbooks in each, and detected Next.js in edit mode. `doctor` ran; its only failure was the unreachable sitemap (example.org; no network from the sandbox).
  - The Action script was exercised locally: an invalid job name was refused.
- **Mistake caught:** a local Action test ran `init` inside the product repository, because `init` has no `--cwd` flag. The stray files were untracked and removed before commit, and `.gitignore` was restored.
- **Not done (owner):** npm token, Marketplace listing, Discussions and labels, demo video, live provider keys, connector deployment.

## 2026-10-22 (PR #13 merged)
- **Integration:**
  - Merged https://github.com/bishal-paul-git/seo-autopilot/pull/13 (`3b8881a`): the hosted connector, and the KV binding for Cloudflare account 8566.
  - The PR also fixes `main`. `54595d8` (local SEO agents, pushed straight to `main`) had broken 4 agent tests. The fix sets the count to 38, lists the new agents in the plugin, adds the site-profile line to 4 agents, and adds 2 playbooks to the index. It also removes two unsourced percentages.
- **Checks:** `npm test` 407/407 locally; CI green on Node 20 and 22.
- **Deployment:** none. The connector is still to be deployed by the owner; steps are in STATUS.

## 2026-10-22 (Erudience upgrade; hosted connector started)
- **Erudience (site repository, deployment action):**
  - Opened, then squash-merged at the owner's request, https://github.com/bishal-paul-git/erudience-flow-engine/pull/91 (`ce934ba`): the seo-autopilot 2.16 upgrade.
  - Workflows were taken from the templates, and the site's ingest URL, IndexNow key name, report folder and implementer rules were put back. `seo-implement` gained `workflow_call`, which the new `seo-autopilot` workflow needs.
  - Checks: the YAML parses, `doctor` loads the config (92 pages), and the Hostinger preview built. PR checks were skipped because they run only on `seo/*` branches.
  - No scheduled run with 2.16 has been observed yet.
- **Code (branch `claude/hopeful-euler-662mu5`, not merged):**
  - `src/mcp/core.mjs` (new): protocol and read tools over a store. `src/mcp/server.mjs` now uses it, with a file store; the exported API is unchanged. Also fixed the "ready" log line, which was unreachable.
  - `cloud/connector/` (new): `src/worker.mjs` (OAuth 2.1 and `/mcp`), `src/github.mjs` (state-branch store), `src/crypto.mjs`, `wrangler.toml`, `README.md`.
  - `test/connector.test.mjs` (new, 5 tests).
- **Docs:** `docs/mcp.md` (hosted section), DECISIONS D20, root `CHANGELOG.md` Unreleased.
- **Checks:**
  - `npm test` 402/402.
  - `npx wrangler@4.45.0 deploy --dry-run`: bundled, 30.25 KiB.
  - `wrangler dev`, then curl: the discovery endpoints answered; `/mcp` returned 401 with `WWW-Authenticate`; registration returned 201; the consent page set its cookie; a POST without the cookie got 400; a POST with it got 302 to GitHub; a made-up code got `invalid_grant`.
  - **Not run:** real GitHub sign-in, real Claude or ChatGPT clients, any deployment.

## 2026-10-22 (release v2.16.0)
- **Code/CI:** added `.github/workflows/tag-release.yml` (`de4c8e8`): a manual workflow that checks the version against `package.json`, runs `npm test`, tags `main`, moves `v2` (and `v2-stable` if ticked) and creates the GitHub Release from `CHANGELOG.md`. Added because tag pushes from this session are refused (403).
- **Integration:** merged PR #12 (`1d94490`) and Dependabot #6 and #7; committed v2.16.0 (`ffb993b`).
- **Deployment (release):** tag-release run 39817957254 succeeded. `v2.16.0`, `v2` and `v2-stable` point at `de4c8e8` (`git ls-remote`). GitHub Release v2.16.0 published by github-actions. No site upgraded or run yet.
- **Checks:** `npm test` 397/397 locally and inside the workflow run.

## 2026-10-22 (pushed; draft PR #12)
- **Integration only:**
  - GitHub write access was restored.
  - Merged the old remote branch: its two docs commits were already in `main` via #9, so I kept this branch's version of STATUS and CHANGELOG.
  - Merged `origin/main` (v2.15.0, #11); the only conflicts were in the two changelogs, and I kept both sides.
  - Pushed, and opened draft PR https://github.com/bishal-paul-git/seo-autopilot/pull/12.
- **Checks:** `npm test` 397/397; Python tests OK; workflow YAML parses.
- **Deployment:** none (nothing released).

## 2026-10-22 (refinements)
- **Code:** `doctor` now reports the optional research keys and the autopilot, live-rank and AI-visibility switches.
- **Docs:**
  - `README.md` gains rows for the research suite, site intelligence, autopilot and MCP.
  - Its "one rule" section is rewritten for D17, and the honest limits now say provider integrations are mock-tested only.
  - `site/` regenerated (agents page lists 33 agents).
- **Checks:** `npm test` 388/388; `doctor` run in a fresh `init` project; `node scripts/build-site.mjs` ran clean.
- **Not pushed** (GitHub writes still refused).

## 2026-10-20 (D19 site intelligence and MCP server)
- **Code:**
  - `src/mcp/server.mjs` and the `mcp` CLI command; `mcpServers` in `.claude-plugin/plugin.json`.
  - Analysis modules: `src/analysis/linkgraph.mjs`, `vitals.mjs`, `changes.mjs`, `schema.mjs`, `entity.mjs`.
  - Jobs: `linkgraph`, `vitals`, `changes`, `schema`, `entity`.
  - Intent labels on rank rows.
  - Router rules and team inputs; `research.logo` and `research.sameAs` config; workflow steps.
- **Docs:** `docs/mcp.md`, the site intelligence section in `docs/research-suite.md`, `docs/jobs.md` rows, D19, and inputs for 6 agents.
- **Checks:**
  - `npm test`: 388 pass, including a real stdio MCP session.
  - All workflow YAML parses.
  - The Chrome UX Report, Knowledge Graph and Wikidata APIs are mocked; **no live call** was made.
- **Not pushed** (GitHub writes refused).

## 2026-10-20 (D18 research suite)
- **Code:**
  - `src/analysis/text.mjs`, `keywords.mjs`, `rank.mjs`, `gap.mjs`, `optimize.mjs`, `ai-visibility.mjs` and `authority.mjs`.
  - `src/lib/research-sources.mjs` (Bing, DataForSEO, Open PageRank, autocomplete) and `src/lib/ai-engines.mjs` (Perplexity, OpenAI, Anthropic, Gemini).
  - Search features added to `src/lib/serp.mjs`, and paging (`extra`) to the Search Console helper.
  - Jobs: `keywords`, `rank`, `gap`, `optimize`, `ai-visibility`, `authority` and `forecast`.
  - Python `engines/python/seo_engine/forecast.py` and a `forecast` CLI command.
  - Router rules and the `team` inputs; the forecast line in the monthly report.
  - Config `research` validation and schema; `templates/data/tracked-queries.json`.
  - Workflow steps in `seo-daily`, `seo-weekly` and `seo-monthly`.
- **Bug found by a test and fixed:** re-fetched Search Console days were added to the saved history instead of replacing it (`mergeSeries`).
- **Docs:** `docs/research-suite.md`, rows in `docs/jobs.md`, D18 in `DECISIONS.md`, inputs for 13 agents.
- **Checks:**
  - `npm test`: 364 pass.
  - `python3 -m unittest discover -s tests` (engines/python): 27 pass.
  - The forecast CLI was run end to end on synthetic data.
  - All workflow YAML parses.
  - Every provider is mocked. **No live provider call was made.**

## 2026-10-20 (agents and skills from the owner's research notes)
- **Content (product):** 3 agents (`departments/research/agents/seo-serp-analyst.md`, `seo-topic-mapper.md`, `departments/ai-search/agents/seo-ai-visibility-tracker.md`) and 5 skills (`departments/skills/question-mining`, `search-intent-labelling`, `traffic-potential`, `broken-link-reclamation`, `ai-answer-testing`); skill references added to 6 existing agents; charters, org chart, `.claude-plugin/plugin.json`, `docs/agents.md`, `CLAUDE.md` counts.
- **Source:** the owner's three research notes (Ahrefs vs Semrush; two architecture blueprints). The GitHub repositories they name could not be opened from this session (403), so no code or licence was checked and nothing was copied.
- **Checks:** `npm test` 326/326 (agent structure, skill two-way references, plugin list). Agents not evaluated on real outputs.

## 2026-10-20 (D17 parts 3 to 5: watch and undo, monthly report, work orders drive agents)
- **Code:**
  - Watch and undo: `src/analysis/watch.mjs`, `src/jobs/watch.mjs`, `templates/workflows/seo-watch.yml`; automerge labels `undo`-level merges `seo-watch`.
  - Monthly: `src/analysis/monthly.mjs`, `src/jobs/monthly.mjs`, `templates/workflows/seo-monthly.yml`.
  - Work orders: `workOrderIssues()` and `AUTOPILOT_AGENTS` in `src/analysis/work-orders.mjs`; `team` opens the issues when `SEO_AUTOPILOT=true`; `seo-weekly` passes the switch; `seo-implement` accepts `seo-work-order` and reads `agent:<name>` (three content agents only), with snippet and link rules.
  - Tests: `test/watch.test.mjs` (5), `test/monthly.test.mjs` (5), one new work-order test, three new workflow assertions.
- **Docs:** root `CHANGELOG.md`, `docs/jobs.md` (watch, monthly, team), D17 roadmap in `DECISIONS.md`, this file, `STATUS.md`.
- **Checks:** `npm test` 323/323; every workflow template parses as YAML; `bash -n` on every run script; `init` into an empty repository installs all 12 workflows with placeholders filled.
- **Not run on GitHub.** Not pushed (GitHub writes refused). No deployment.

## 2026-10-20 (D17: graduated autopilot, part 2: the autopilot loop)
- **Code:**
  - `pickWork()` in `src/analysis/autonomy.mjs`, and `run autopilot --pick`.
  - New `templates/workflows/seo-autopilot.yml`.
  - `workflow_call` inputs added to `seo-implement` (issue), `seo-check` (ref, base), `seo-review` (pr) and `seo-automerge` (branch).
  - Automerge finds the head commit itself when called, and matches check runs named either "build" or "<job> / build".
  - Tests: 2 new autonomy tests; a workflow test that the called build check never receives secrets; local reusable workflows allowed in the pinning rule.
- **Checks:** `npm test` 303/303; YAML parse; `bash -n`; `init` installs the workflow with placeholders filled.
- **Not run on GitHub.** Not pushed (GitHub writes refused).

## 2026-10-20 (D17: graduated autopilot, part 1)
- **Owner decision:** routine changes publish without a person after automated checks. Recorded as D17; `CLAUDE.md` rule #1 rewritten.
- **Code:**
  - New `src/analysis/autonomy.mjs` and `src/jobs/autopilot.mjs` (registered as `autopilot`).
  - Config validation and schema for `site.autopilot`.
  - `templates/workflows/seo-automerge.yml` rewritten (fixes F1).
  - `seo-implement.yml`: approver permission check (fixes F2), kill switch, PR labelled with the kind of change.
  - `seo-release.yml`: kill switch (F3).
  - Tests: `test/autonomy.test.mjs` (7) and new assertions in `test/workflows.test.mjs`.
- **Documentation:** D17 in DECISIONS; `CLAUDE.md`; `departments/README.md`; `docs/strategy.md`; `docs/jobs.md`; root `CHANGELOG.md`.
- **Checks:** `npm test` 298/298; Python OK; YAML parse of all templates; `bash -n` on the changed run scripts.
- **Not run on GitHub.** Not pushed (GitHub writes refused in this environment).

## 2026-10-19 (D16: shared skills)
- **Code:**
  - `src/core/agents.mjs` gains `listSkills()`.
  - `src/cli/init.mjs` copies skills to `<dataDir>/skills/<name>/SKILL.md`.
  - `scripts/build-site.mjs` links skill pages to GitHub.
  - Tests: two-way skills consistency (`test/agents.test.mjs`) and skills present after `init` (`test/site-profile.test.mjs`).
- **Product content:**
  - `departments/skills/answer-first-copy/SKILL.md` and `departments/skills/digital-pr/SKILL.md`.
  - "Read first" skill references in the drafter, refresher, snippet-optimizer, ai-search-agent, editor, link-builder and entity-reputation; small method wording changes pointing to the skills.
  - Org chart skills section; `CLAUDE.md` layout line.
- **Checks:** `npm test` 289/289. Not pushed (GitHub 403 again at session start).

## 2026-10-18, night (D16 step 5: log analyst)
- **Code:**
  - New `src/analysis/logs.mjs` and `src/jobs/logs.mjs` (registered as `logs`; DNS verify uses `node:dns`, gz via `node:zlib`, no dependencies).
  - New `departments/technical/agents/seo-log-analyst.md`.
  - Router rule (medium crawl findings, fix phase); `team` passes `logs.json`.
  - `src/jobs/audit.mjs` compact pages gain `noindex`.
  - `src/cli/init.mjs` adds `seo-autopilot/logs/` to `.gitignore` (idempotent, checked by running init twice).
  - Config validation and schema for `site.logs.dir`.
  - Tests: `test/logs.test.mjs` (6); agent count 30.
- **Documentation:** a "Reading your server logs" section in `knowledge/indexing-and-crawl-diagnosis.md`; `docs/jobs.md` row; org chart; Technical charter; root `CHANGELOG.md`.
- **Checks:** `npm test` 288/288; Python OK; `go test ./...` ok.
- **Not checked:** real logs, live DNS verification. Not pushed (GitHub 403).

## 2026-10-18, night (D16 step 5: backlink auditor)
- **Code:**
  - New `src/analysis/inbound.mjs` and `src/jobs/inbound.mjs` (registered as `inbound`).
  - New `departments/authority/agents/seo-backlink-auditor.md`.
  - Router rules for reclaim (fix phase) and review (grow phase), with targets.
  - `team` passes `inbound.json`.
  - Config validation and schema for `site.inbound.dir`.
  - `seo-weekly.yml` gets a `run inbound` step.
  - Tests: `test/inbound.test.mjs` (6); agent count 29; coverage test includes inbound.
- **Documentation:**
  - `knowledge/link-building-and-digital-pr.md` gets an "Auditing the links you already have" section.
  - `docs/jobs.md` row, org chart, Authority charter, root `CHANGELOG.md`.
- **Checks:** `npm test` 280/280; Python 23 OK.
- **Not checked:** a real Search Console export. Not pushed (GitHub 403).

## 2026-10-18, night (D16 step 3: work orders)
- **Code:**
  - New `src/analysis/work-orders.mjs`, `src/jobs/work.mjs` (registered as `work`) and `agentFacts()` in `src/core/agents.mjs`.
  - `src/analysis/agent-router.mjs`: steps carry all target paths; `SITE_WIDE_RULES` are whole-site.
  - `src/jobs/team.mjs` writes `work-orders.json` and validates it (throws on inconsistency).
  - `templates/workflows/seo-check.yml`: full-history checkout, plus a facts step on changed `.json`/`.md`/`.mdx` files outside `seo-autopilot/`, made pipefail-safe.
  - Tests: `test/work-orders.test.mjs` (9).
- **Documentation:** `docs/jobs.md` rows for `team` and `work`; root `CHANGELOG.md`.
- **Checks:**
  - `npm test` 272/272;
  - a manual simulation of the facts step on a temp repo flagged "47%";
  - `init` SPEC substitution.
- Not pushed (GitHub 403).

## 2026-10-18, night (D16 step 2: ownership and inputs)
- **Code:**
  - New `departments/content/agents/seo-internal-linker.md`.
  - `src/analysis/agent-router.mjs`:
    - orphan, deep and generic-anchor findings and `links.json` go to the internal-linker;
    - heading rules go to the snippet-optimizer;
    - merged steps keep every instruction;
    - entity prompt briefs the schema engineer.
  - Inputs updated in snippet-optimizer (also the heading method step), compliance-auditor, technical-fixer, ai-search-agent, strategist and redirect-guardian. Ownership lines added to entity-reputation and ai-search-agent.
  - Tests: router-to-Inputs coverage test; counts now 28; `test/quality.test.mjs` heading-routing test updated.
- **Checks:** `npm test` 262/262; Python 23 OK. Not pushed (GitHub 403).

## 2026-10-18, night (D16 step 1: departments)
- **Code:**
  - Agents moved with `git mv` into `departments/{command,research,technical,content,authority,ai-search,verticals,quality}/agents/`, plus a `department:` front-matter line.
  - New `src/core/agents.mjs`. Updated `src/cli/init.mjs`, `scripts/build-site.mjs` (site grouped by department; `../docs` links go to GitHub), `test/agents.test.mjs` (department, uniqueness, charter and plugin-list tests), the Python test fixtures, `package.json` files and `.claude-plugin/plugin.json` (explicit agents list).
- **Documentation:**
  - `departments/README.md` (org chart) and 8 charters.
  - `CLAUDE.md` layout lines, `docs/agents.md`, `docs/content-automation.md`, and the root `CHANGELOG.md` Unreleased entry.
  - Earlier the same evening: `docs/research/AGENT-AUDIT-2026-10-18.md`, `docs/research/REFERENCES.md` (108 links, all search-result-only because page fetches were blocked), `docs/architecture/DEPARTMENTS.md` and D16.
- **Checks:** `npm test` 260/260; `python3 -m unittest discover -s tests` 23 OK; `init` and `upgrade --diff` in a temp repo.
- **Not pushed:** GitHub writes return 403 in this session.

## 2026-10-18, evening (release finished by the owner)
- **Deployment actions (by the owner, in the GitHub web UI):**
  - Published the Release `v2.14.0` (tag at `f10f3b3`).
  - Merged seo-autopilot#9 and erudience-flow-engine#78.
- **Verified by this session:** latest release `v2.14.0`. Later, after the owner moved them from a terminal: `v2.14.0`, `v2` and `v2-stable` all at `f10f3b3` (GitHub API reads).
- **Failed (session access):**
  - Merging, marking ready, pushing workflow files and creating refs all returned 403.
  - A proposed manual-run release workflow was therefore not pushed.
- **Documentation:** STATUS updated.

## 2026-10-20 (v2.15.0 prepared on branch `feat/refinements-pace-thin-lang`)
- **Code changes:** `src/analysis/scope.mjs` (thinIgnore/retired path patterns, trailing-slash check, small language filter), `applyDates` in `src/adapters/index.mjs` and `run pace --apply`, `metaChanges` and `run experiments log-git <ref>`, wiring in `audit`, `daily`, `digest`, `indexing-queue`, `research`; config validation and schema for `thinIgnore`, `retired`, `language`.
- **Documentation:** root `CHANGELOG.md` 2.15.0, `docs/configuration.md`, roadmap brief 09 statuses.
- **Checks:** `npm test`: 265 pass, 0 fail (new `test/scope.test.mjs`, 9 offline tests). Not run: live Search Console, a real `pace --apply` on a production content repository, `log-git` against a real history. These need a real site checkout.
- **Deployment:** not released yet. v2.14.0 tags are also still unpushed (see the entry below), so the release must push `v2.15.0`, `v2` and `v2-stable` together once this branch is merged.

## 2026-10-18, later (release v2.14.0, partial)
- **Deployment actions:**
  - Version bumped to 2.14.0; `CHANGELOG.md` section added; site regenerated (commit `e7668d9`).
  - Gate passed: `npm test` 258 of 258, `go vet`/`go test`, Python unittest.
  - PR #8 marked ready and merged into `main` with a merge commit (`f10f3b3`); tests re-run on `main`: 258 of 258.
- **Failed:**
  - Pushing tags `v2.14.0`, `v2` and `v2-stable` was refused by the session's git proxy; there is no API tool to create tags.
  - The release is therefore incomplete: no GitHub Release, and the moving tags remain on v2.13.0.
  - Commands for the owner are in STATUS.

## 2026-10-18, later (Erudience consent fix)
- **Code:**
  - Repository: erudience-flow-engine, branch `claude/hopeful-euler-662mu5`, commit `162906d`, draft PR https://github.com/bishal-paul-git/erudience-flow-engine/pull/78.
  - Change: `src/lib/consent.ts`. `setConsent("denied")` now reloads whenever measurement code is on the page (`#ga-script`, `[data-custom-head]`, `#custom-body-code`) instead of checking the stored choice, which "Cookie settings" had already cleared.
- **Evidence** (headless Chromium, local production build, real GA replaced by its marker element because Supabase is unreachable):
  - Before: Accept, then Cookie settings, then Reject gave no reload and left the tag on the page.
  - After: the page reloads and the tag is gone.
  - First-visit Reject: no reload.
  - eslint passes.
  - tsc: the same 4 pre-existing errors in `DynamicWorkflowPage.tsx` with and without the change.
- **Deployment:** none. The owner merges; the live site is checked afterwards.

## 2026-10-18, later (brief 01, item 7: render job)
- **Code:**
  - `src/analysis/render.mjs` (pure) and the `src/jobs/render.mjs` job (Playwright optional).
  - `blockText()` and `mainScope()` in `src/audit/extract.mjs`.
  - Router: a technical-fixer step; team wiring; opt-in weekly step (`SEO_RENDER`); `docs/jobs.md`.
  - Tests: `test/render.test.mjs` (7). One is an end-to-end run with real headless Chromium against a local server: a one-at-a-time FAQ and a stale sentence.
- **Tests:** `npm test` 258 of 258. In this container the end-to-end render test ran (Playwright found). In CI it skips when Playwright is not installed.
- **Real-world check** (Erudience local build, all 127 pages, real Chromium):
  - The first version flagged 126 pages, almost all false alarms. Four fixes, in order:
    1. Blocks were run together in the delivered text, so headings, breadcrumbs and paragraphs became one "sentence".
    2. `innerText` drops hidden content.
    3. FAQ answers only enter the DOM when opened: a custom accordion with no ARIA.
    4. A one-at-a-time accordion closes the previous answer.
  - The fixes: one line per block; full DOM text; open `<details>`, ARIA disclosures and question-style buttons; merge text after every click.
  - Final result:
    - 10 pages with prerendered prose the live page does not show.
    - 89 pages with label or heading wording differences only (low).
    - 10 pages where most text appears only after JavaScript.
    - 0 load errors.
  - Confirmed examples of real drift:
    - `/about`: the origin story is worded differently.
    - `/privacy`: the prerendered "why, and the choices you have" vs the live "why we collect it, and the choices you have. We aim to collect only what we need."
    - `/ai-readiness-checklist`: the questions are revealed step by step by the tool. This is a known limit: the check cannot step through tools.
  - Erudience's own `check-static-content.mjs` passes on the same build, so it misses the drift above.
- **Limits:**
  - The local build may lack Supabase-backed content (network blocked).
  - Nothing was checked against the live erudience.com.
- **Deployment:** none.

## 2026-10-18, later (brief 01, item 6: links job)
- **Code:**
  - `relatedLinks()` in `src/audit/links.mjs`.
  - The `src/jobs/links.mjs` job.
  - `audit.json` pages gain `links` (internal, deduplicated).
  - Router: a refresher step; team wiring; weekly step; UI allow-list; `docs/jobs.md`.
  - Tests: `test/links.test.mjs` (3).
- **Tests:** `npm test` 250 of 250.
- **Real-world check** (Erudience local build, 127 pages):
  - At the default threshold (2 or fewer inbound), 0 suggestions; only 1 page qualifies.
  - At 6 or fewer, the first version produced navigation noise: home, about and services pages suggested as link sources, on words like "one".
  - Fixed by ignoring links on half or more of the pages and words in half or more of the titles.
  - After the fix: 60 suggestions for 22 pages, mostly blog to blog on shared topics. A few remain weak; the report presents them as suggestions only.
- **Deployment:** none.

## 2026-10-18, later (brief 01, items 4 and 5: consent and conversion recipes, conversions job)
- **Code and content:**
  - New playbooks: `knowledge/consent-banner-recipe.md` and `knowledge/conversion-tracking-recipe.md`, listed in the playbooks index. They are top-level files, not a `knowledge/recipes/` folder, because the site builder reads `knowledge/` flat.
  - Conversions code: `src/lib/ga4.mjs`, `src/analysis/conversions.mjs`, `src/jobs/conversions.mjs`.
  - Wiring: config `conversions.events` (schema and validation), a weekly workflow step, `docs/jobs.md`.
  - Tests: `test/recipes.test.mjs` (6).
- **Tests:** `npm test` 246 of 246.
- **Finding (Erudience production code, static reading of `src/lib/consent.ts`, `components/layout/Footer.tsx` and `components/ScriptInjector.tsx`):**
  - Withdrawing consent through "Cookie settings" does not reload the page. `reopenConsent()` removes the stored choice, so `setConsent("denied")` sees no previous "granted".
  - `ScriptInjector` only acts when consent is granted, so GA, Clarity and custom code keep running for the rest of the session.
  - Not reproduced in a browser.
  - Reported as a separate suggested task; no Erudience change made.
- **Not verified:** the GA4 Admin API key-events call against a real property (no Google key in this environment).
- **Deployment:** none.

## 2026-10-18, later (brief 01, item 3: facts guard)
- **Code:**
  - `src/analysis/facts.mjs` (pure) and the `src/jobs/facts.mjs` job.
  - `contentFiles()` exported from `src/adapters/index.mjs`.
  - `site.facts` in the schema and validation.
  - Router: a fact-checker step; team wiring; weekly workflow step; fact-checker agent text; `docs/jobs.md`.
  - Tests: `test/facts.test.mjs` (8).
- **Tests:** `npm test` 239 of 239.
- **Real-world check** (Erudience `a644824`, scratch copy):
  - Erudience's `validate-content.mjs` reports 0 errors.
  - Product `checkFacts` over the same 13 collections: 4 unverified (2 prices in `products[1].pricingNote`, and "85%" twice in `products[2]`), 13 verified.
  - The 4 are genuine gaps. The old rule passes any number in a string that contains any verified fact: `ctx.includes(m[0])` is always true.
  - False positives found on the way ("used by", "our clients", and sentence context cut at decimal points) were fixed before commit.
  - The real job was also run with Erudience's own config plus `facts.file` set to `src/content/verified-facts.json`. That config edit was made in the scratch copy only. It gave the same 4 claims.
- **For the Erudience PR:**
  - Set `facts.file` to `src/content/verified-facts.json`, and include the products and services content files.
  - The 4 claims need the owner to confirm the prices and the 85% wording, or remove them. Not done here: that is a content decision for the owner.
- **Deployment:** none.

## 2026-10-18, later (brief 01, item 2: redirect tooling)
- **Code:**
  - `src/analysis/redirects.mjs` (pure) and `src/jobs/redirects.mjs`, plus the `redirects` CLI command.
  - `site.redirects` in the schema and validation; `paths.redirects` in the config.
  - Router input and team wiring; weekly workflow step; redirect guardian agent text; `docs/jobs.md`.
  - Tests: `test/redirects.test.mjs` (11), including smoke and check jobs against local HTTP servers.
- **Tests:** `npm test` 230 of 230.
- **Real-world check** (Erudience `a644824`, local build, scripts in the scratchpad):
  - Erudience's own `check-redirects.mjs` reports ok with 2 waiting targets.
  - The product's check on the converted map flags the same 2.
  - A raw conversion without filtering shows Erudience's `retired-urls.txt` lists 10 live pages and 87 already-redirected URLs. Erudience's generator filters these silently; the product reports them.
  - Generated Apache 301 rules: 105 in both, identical.
  - Exact 410 lists: both empty. Every retired URL is live, redirected or inside a retired section.
- **Not done:**
  - A live smoke test against erudience.com (network blocked).
  - An Apache or nginx run of the generated rules (no web server in the container).
  - Erudience's committed `public/.htaccess` differs by 2 lines from a fresh generation. The likely reason is that the local build lacked Supabase-backed pages, so those 2 targets were "waiting" locally. Not verified.
- **Deployment:** none.

## 2026-10-18, later (brief 01, item 1: heading and meta audits)
- **Code:**
  - `headingOutline` in `src/audit/extract.mjs`, mirrored in `engines/go/extract.go` and `engines/go/main.go`.
  - Five rules in `src/audit/rules.mjs`, with recipes in `knowledge/audit-fix-recipes.md`.
  - `src/analysis/quality.mjs` and the `src/jobs/quality.mjs` job (registry, UI allow-list, weekly workflow step).
  - Router: a refresher group, a quality input, and the duplicate-agent fix.
  - `audit.json` pages gain three fields.
  - Tests: `test/quality.test.mjs` (12 tests); the Go parity test now compares headings.
- **Tests:** `npm test` 218 of 218; `go vet` and `go test` ok; Python 23 ok.
- **Real-world check** (scripts in the session scratchpad, not committed):
  - Erudience `a644824` was built locally with `vite build`, giving 127 prerendered pages.
  - That build was served on localhost and crawled with the product audit, using both the Node and Go engines.
  - On the same `dist/`, Erudience's own `audit-headings.mjs` and `audit-meta.mjs` were run for comparison.
  - Results:
    - Section averages identical for all 17 sections.
    - `h1-long`: the same 7 pages.
    - Generic H2s: Erudience flags "What we do" and "Industries"; the product flags neither, by design. "What we do" was then added to the product's list.
    - The page with fewer than 2 H2s (`/auth`) is not flagged by the product, because it is under 600 words (deliberate).
    - Keyword matcher: 320 of 321 decisions agree with Erudience's script.
  - The top-query check was run on Erudience's real Search Console rows from its `seo-data` branch (window 2026-09-19 to 2026-10-16, 278 rows), fetched into the scratchpad only: 8 pages had a query with 20+ impressions, and 4 were flagged.
- **Limits:**
  - The live erudience.com was unreachable (environment proxy 403), so the check used a local build, not production.
  - Erudience's `npm ci` fails because its lockfile is out of sync with `package.json`; `npm install` was used in the scratch copy.
  - No Erudience PR was opened yet.
- **Deployment:** none.

## 2026-10-18 (cloud session, branch `claude/hopeful-euler-662mu5`)
- **Documentation:**
  - Phase 0 audit of SEO Autopilot in `PHASE-0-AUDIT.md`: baseline, data flow from onboarding to measurement, findings F1 to F10, reuse matrix.
  - Proposed architecture decisions D1 to D11 in `DECISIONS.md`.
  - `docs/evals.md`; STATUS rewritten.
- **Code (brief 04, first part):** deterministic graders `src/analysis/evals.mjs`, script `scripts/evals.mjs`, cases `test/evals/cases.json`, tests `test/evals.test.mjs`. Root `CHANGELOG.md` has an `## Unreleased` entry; no version bump.
- **Tests:**
  - Clean clone of `8d7b62c`: `npm test` 197 pass; Go ok; Python 23 ok.
  - This branch: `npm test` 206 pass.
  - No live provider calls.
- **Access:** at first, marketingmouse, feed-to-site-magic, keel and erudience-flow-engine were not accessible and the push was refused with a 403. After the owner granted access, the push succeeded (draft PR https://github.com/bishal-paul-git/seo-autopilot/pull/8) and all four repositories were cloned.
- **Documentation:** source audits added as PHASE-0-AUDIT §5, findings M1-M8 and N1-N8, with reuse-matrix rows. Decisions D12-D15 added. Audited SHAs: marketingmouse `e115eac`, feed-to-site-magic `f72276c`, keel `92195e1`, erudience-flow-engine `a644824`. These are static reviews; nothing in those repositories was run or changed.
- **Deployment:** none.

## 2026-10-18
- Documentation only: merged the owner's `CLAUDE.md` handoff with the product guide; added `docs/strategy.md` and `docs/roadmap/` (nine session briefs); added these status files. Tests: `npm test` 196 pass, 1 skipped. Deployment: none.

## 2026-10-14 to 2026-10-17
- Code: v2.10.0 (12 agents, 4 playbooks), v2.11.0 (site profile, agent routing, 9 agents, 6 playbooks), v2.12.0 (init and weekly workflow give any project the whole team), v2.13.0 (consent, ymyl, pace, citations jobs). Each released by tag after `npm test`; CI, release and pages workflows succeeded.
- Verification beyond tests: profile detection tried on 12 live sites; consent check run against live Erudience (found its new banner after a heuristic fix); ymyl and pace run on Erudience data; 8 agents run on Erudience in report-only mode.
- Not verified: `citations` against real provider APIs.
- Deployment actions: tags and GitHub Releases only; Erudience workflow files updated by its own PRs.
