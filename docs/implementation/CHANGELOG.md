# Implementation log

Dated session entries; history is preserved. Product release notes are in the root `CHANGELOG.md`.

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
