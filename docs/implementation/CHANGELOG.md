# Implementation log

Dated session entries; history is preserved. Product release notes are in the root `CHANGELOG.md`.

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
