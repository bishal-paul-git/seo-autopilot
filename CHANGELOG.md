# Changelog

## 2.16.0

Departments and shared skills, graduated autopilot (D17), research suite (D18), site intelligence and the MCP server (D19). Provider integrations are tested with recorded responses only; check each report against the provider the first time you add its key.

- **Site intelligence and the MCP server (decision D19).**
  - `seo-autopilot mcp`: an MCP server, so Claude Desktop, Claude Code and other assistants can read reports, search your queries, inspect a page and run analysis jobs. It is read-only by default, and paid jobs need confirmation. The Claude Code plugin registers it. See `docs/mcp.md`.
  - `linkgraph`: internal PageRank, click depth, orphans, leaked links, and under-linked pages with search demand, with the related pages to link from.
  - `vitals`: real-user Core Web Vitals from the Chrome UX Report, with a 25-period history and regressions (free key).
  - `changes`: weekly change monitor for your key pages and competitors' winning pages.
  - `schema`: checks JSON-LD against requirements and the visible page; drafts missing markup from page facts, with placeholders.
  - `entity`: Google Knowledge Graph and Wikidata, matched by official website, plus sameAs actions.
  - The rank tracker now shows each query's intent.
  - The router sends these findings to the internal linker, performance fixer, technical fixer, competitor analyst, schema engineer and entity agent.
  - Workflows: `linkgraph` daily; `schema`, `changes` and `vitals` weekly; `entity` monthly.
- **Research suite (decision D18): the features of a paid SEO suite, on your own data and keys.** See `docs/research-suite.md`.
  - `keywords`: keyword explorer. Covers parent topics, intent, demand with its source, difficulty, owner pages, gaps and questions. Sources: Search Console, plus Bing, DataForSEO, live results (topics grouped by shared results), Open PageRank and opt-in autocomplete.
  - `rank`: daily rank tracker from Search Console. History beyond 16 months, movers, a visibility index and buckets. `--serp` adds search features, competitors and share of voice.
  - `gap`: competitor and keyword gap (missing, weak, shared) by topic, with the competitor pages behind it and the queries only you hold.
  - `optimize`: content optimiser for a page or draft against the top results. Covers shared terms with usage ranges, sections, questions, length, readability and basics, scored out of 100 with the evidence. robots.txt is respected.
  - `ai-visibility`: asks Perplexity, ChatGPT (OpenAI), Claude and Gemini your questions with web search on, repeated runs. Mentions with aliases, citations, competitors, sources, history.
  - `authority`: referring domains with Open PageRank authority, new and lost, you vs competitors, and the link intersect.
  - `forecast` (Python, no packages): a Holt-Winters normal range for clicks, impressions and pages. The monthly report uses it.
  - Search providers now report search features. `team` recommends the SERP analyst, topic mapper, competitor analyst, AI search agent, link builder and backlink auditor from these reports.
  - Workflows: daily `rank`; weekly `keywords`, `gap`, `authority`, and `rank --serp` when `SEO_RANK_LIVE=true`; monthly `forecast`, and `ai-visibility` when `SEO_AI_VISIBILITY=true`.
  - New config block `research` and the template `tracked-queries.json`.
  - Provider calls are tested with mocked responses only.

- **Graduated autopilot (decision D17).** Routine changes now publish without a person once every automated check passes. High-risk changes still wait for one.
  - New `autopilot` job and policy (`src/analysis/autonomy.mjs`). Levels per kind of change: `watch`, `prepare`, `autopilot`, `undo`.
    - Fixes, snippets and internal links: `undo`.
    - Refreshes, new pages and template changes: `autopilot`.
    - Sensitive topics, robots and sitemap changes, migrations, deletions, outreach, and changes to workflows or dependencies: always a person.
    - Limits: 10 automatic changes a day and 3 new pages a week by default.
    - Kill switch: the repository variable `SEO_AUTOPILOT_PAUSED=true`.
  - **`seo-automerge`** is now policy-driven and safer:
    - the reviewer must have passed on the exact commit being merged (a pass label left from an earlier commit no longer counts);
    - any new page file counts as a new page whatever its label;
    - added text touching health, money or legal topics goes to a person;
    - the merge is pinned to the checked commit.
    - **Breaking:** if you use auto-merge without the reviewer, set `SEO_REQUIRE_REVIEW=false`.
  - **`seo-implement`** only accepts an `approved` label from someone with write access, and labels its pull request with the issue's kind of change.
  - **`seo-release`** respects the kill switch.
  - **New `seo-autopilot` workflow:** the autopilot loop. Twice a day it picks one open proposal issue that the policy allows, oldest first; held, approved and already-drafted issues and human-only kinds are skipped, and the limits apply.
    - It drafts the issue by calling `seo-implement`, builds it by calling `seo-check` (no secrets), reviews it by calling `seo-review`, and merges it by calling `seo-automerge` with the same gates.
    - It is opt-in with the variable `SEO_AUTOPILOT=true` and needs `SEO_REVIEW=true`. Those four workflows can now be called (`workflow_call`) as well as triggered as before.
    - Why a single workflow: changes made with the workflow's own token do not start other workflows, so a scheduled job that only added labels would trigger nothing.
  - **New `seo-watch` workflow and `watch` job: watch and undo.** Every day it checks the changes published at the `undo` level (labelled `seo-watch`) and reverts one that made things worse: a changed page now answers an error, the change added a noindex, or the page lost clearly more clicks than the rest of the site over the 14 days after the change (at least 10 clicks, judged against untouched pages). The revert is a pull request built by `seo-check` with no secrets; with the kill switch on, the merge waits for a person. Indexing status is not judged: there is no per-change snapshot of it.
  - **New `seo-monthly` workflow and `monthly` job.** On the 1st of each month: re-runs the audit, then reports what the autopilot published (by kind), what the watch rolled back, what a person merged, clicks and impressions over the last 28 days vs the 28 before, audit findings vs last month, and experiment results. Opens one `Monthly SEO report YYYY-MM` issue. It describes what happened and says it is not proof of why.
  - **Work orders drive agents.** With `SEO_AUTOPILOT=true`, the weekly `team` step turns ready work orders for the snippet optimiser, internal linker and refresher into one issue per page (labels `seo-work-order`, the kind of change, `agent:<name>`), at most 5 a week. Orders on sensitive pages, site-wide orders, sites in advise mode and kinds the policy keeps for a person are skipped. The autopilot loop drafts them like proposals; `seo-implement` reads the named agent file (only those three) and has rules for snippet and link changes. A person can still approve one by hand with `approved`.
- **Three new agents (33 in all) and five new shared skills (7 in all)**, from a review of what Ahrefs, Semrush and open-source GEO trackers offer, rebuilt on the site's own data and the product's rules (no invented volumes, bring your own keys):
  - `seo-serp-analyst` (Research): positions, search features and who holds them, share of voice across a tracked query set, from Search Console first.
  - `seo-topic-mapper` (Research): the whole site's topic map: clusters and parent topics, intent, potential, one owner page per cluster, gaps and overlaps.
  - `seo-ai-visibility-tracker` (AI search): mentions and citations in AI answers over a fixed, saved question set, with aliases, repeated runs and accuracy.
  - Skills: `question-mining`, `search-intent-labelling`, `traffic-potential`, `broken-link-reclamation`, `ai-answer-testing`. The researcher, strategist, link builder, backlink auditor, redirect guardian and AI search agent now use them.
  - All three agents report only and run on request in Claude Code; the team plan does not recommend them yet.

- **Agents are now organised into eight departments (D16, step 1).**
  - The departments are Command, Research, Technical (audit and monitor), Content, Authority (backlinks), AI search (AEO/GEO), Verticals and Quality (validators).
  - Each has a charter in `departments/<dept>/README.md`, and the org chart is `departments/README.md`.
  - Agent files moved to `departments/<dept>/agents/` and gained a `department:` front-matter line.
- **Behaviour is unchanged.**
  - Agent names are the same.
  - Installed projects still get every agent flat in `seo-autopilot/agents/`, so workflows, the Python runtime and `upgrade` work as before.
  - The Claude Code plugin now lists its agents explicitly in `.claude-plugin/plugin.json`, because plugins only find a top-level `agents/` folder by default. A test keeps the list in step.
  - The agents page on the site is grouped by department.
- **One owner per problem (D16, step 2).**
  - New **seo-internal-linker** (Content) owns orphan pages, deep pages, generic anchors and the `links` job's suggestions. These used to go to the pruner and the refresher.
  - Heading findings now go to the **seo-snippet-optimizer**, which owns titles, descriptions and the heading outline.
  - Markup changes have one owner, the schema engineer. Entity-reputation and the AI search agent brief it, and robots changes go to the technical fixer.
- **Agents now name every report the router sends them** (`consent.json`, `ymyl.json`, `quality.json`, `links.json`, `render.json`, `citations.json`, `pace.json`, `redirects-check.json`). A test enforces it.
- **Router fix:** when a second finding sent the same agent, its instruction (which names the report to read) was dropped. It is now appended, and the more urgent phase wins.
- **Work orders: order of work, page locks and the approval gate are now code (D16, step 3).**
  - `team` also writes `work-orders.json`. Each agent's work has an owner and department, the pages it touches (or the whole site), what must finish first, and the checks it must pass. The orders are grouped into waves that can run in parallel.
  - Ordering rules: blockers come before later work on the same pages, or before everything when site-wide. Two edits to the same page never overlap. The report comes last. Advisory agents never take locks.
  - Checks before approval:
    - content changes: build, `facts`, fact-checker and editor, plus the compliance auditor on sensitive pages;
    - redirects: build and `redirects`;
    - markup and templates: build and `audit`.
  - New `work` job: `--start` refuses while dependencies are unfinished or the pages are held; `--check name=pass|fail`, `--done`/`--fail`, and `--ready`, which exits 1 until every check has passed.
  - Pure logic in `src/analysis/work-orders.mjs`, with tests.
- **`seo-check` now runs the facts guard on the changed content files** of every `seo/*` pull request. It needs no secrets. It warns by default, and fails the check when `"facts": { "strict": true }` is set.
- **New `inbound` job and seo-backlink-auditor agent (Authority, D16 step 5).** They audit the links pointing at your site from a Search Console Links export (or a backlink-tool CSV) saved in `seo-autopilot/inbound-links/`. No API key is needed.
  - The report covers:
    - links into pages that now error (reclaim them with a redirect);
    - links through redirects;
    - top linking sites and pages;
    - new and lost sites since the last export;
    - sitewide or one-anchor patterns for a person to review.
  - It never contacts anyone and never writes a disavow file. The agent recommends a disavow only with a manual action or confirmed arranged links.
  - Reclaimable links route the agent in the fix phase. The weekly workflow runs `inbound` when an export is present.
  - New playbook section: "Auditing the links you already have".
  - The parser matches export columns by name and is tested on sample files shaped like the exports; **it has not yet been run on a real Search Console download.**
- **New `logs` job and seo-log-analyst agent (Technical, D16 step 5).** They show what Googlebot, Bingbot and AI crawlers really requested, from your own server or CDN access logs (plain or .gz) in `seo-autopilot/logs/`.
  - It tells the three kinds of AI crawler apart: AI search, fetches a person asked for, and training.
  - It reports crawl spent on errors, redirects and parameter URLs, sitemap pages not requested, and noindex pages crawled repeatedly.
  - `--verify` checks Googlebot and Bingbot by reverse and forward DNS and leaves fakes out.
  - **Only totals are stored, never an IP address**, and `init` now adds `seo-autopilot/logs/` to `.gitignore`. The audit also records `noindex` per page.
  - Parsing is tested on sample lines (combined and common formats, JSON lines); **not yet on a real host's logs.**
  - New playbook section: "Reading your server logs".
- **Shared skills: the third level of the department design (D16).**
  - A skill is a procedure several agents follow, kept in one place.
  - **answer-first-copy** is used by the drafter, refresher, snippet optimizer, AI search agent and editor; it consolidates the answer-first guidance they each repeated.
  - **digital-pr** is used by the link builder and entity-reputation agents. It covers first-hand data, expert comment, timely angles and reclaimed mentions, in small honest campaigns where a person sends every pitch.
  - Skills live in `departments/skills/<name>/SKILL.md`, and installs get them in `seo-autopilot/skills/`. A test checks that every agent's skills exist and that every skill lists the agents that use it.
- Design and roadmap: `docs/architecture/DEPARTMENTS.md`. Research library (links still to be verified): `docs/research/REFERENCES.md`.

## 2.15.0

Fixes for gaps found running the product on a real production site (roadmap brief 09, items 2 to 5, plus pace and experiments from brief 11).

- **`thinIgnore` (site config).** URL path patterns (`*` is a wildcard) for pages that are meant to be short: hubs, tools, funnel pages. The `thin-content` rule skips them.
- **`retired` (site config).** URL path patterns for pages removed or redirected on purpose. They are left out of the not-indexed counts, the weekly digest and the request-indexing list.
- **Honest indexing counts.** The daily report now counts only URLs that are in the sitemap today and not retired, says how many inspected URLs it left out, and writes the dashboard history from the same numbers. The request-indexing list shows each page's last inspection date.
- **Trailing-slash canonicals.** The daily report lists pages where Google chose a canonical that differs from the page only by a trailing slash.
- **`language` (site config, for example `en` or `en-GB`).** Search queries clearly in another language are no longer turned into topic proposals or near-miss candidates. Short stop-word check, silent when unsure, no dependency.
- **`run pace --apply`.** Writes the recommended `publishAt` dates for JSON and Markdown content. It never moves a page earlier, keeps line endings, and refuses a JSON file it could not rewrite without changing its formatting (that page is reported as skipped). Without `--apply` it stays report only.
- **`run experiments log-git <ref>`.** Logs an experiment for every page whose title, description or H1 was rewritten since a git ref (JSON content), dated by the last commit that touched the file, so the experiment log no longer depends on manual entries.
- Tests: `test/scope.test.mjs` (9 tests, offline). Total suite 265 passing.

## 2.14.0

- **New `render` job (brief 01, item 7, optional; ported from the idea of the reference site's `check-static-content.mjs`).** It loads sitemap pages in a headless browser and compares them with the HTML the server delivered.
  - **Findings:**
    - A prerendered sentence the page does not show (high).
    - Headings or labels that differ (low).
    - Most text appears only after JavaScript runs (medium).
    - A changed title or H1 (low).
  - **What it opens first:** `<details>`, ARIA disclosures and question-style FAQ buttons, merging the text across one-at-a-time accordions. It never clicks other buttons.
  - **Setup:** Playwright is optional and the job skips cleanly without it; `SEO_CHROMIUM_PATH` points it at a Chromium you already have. The weekly workflow step is off until `SEO_RENDER=true`.
  - **Agent plan:** high findings go to `seo-technical-fixer`.
  - `blockText()` in `src/audit/extract.mjs` gives one line per block.

- **New `links` job (brief 01, item 6, the idea behind the reference site's "Guides on this topic" blocks).** It lists internal links to add for pages with few inbound links (2 or fewer by default, weakest first). There are three reasons:
  - **mention:** the source names the target's topic without linking (from the audit).
  - **reverse:** the target links to a related page that does not link back.
  - **sibling:** the same site section and at least two shared topic words.

  How it decides:
  - Links on half the pages or more count as navigation, not as a relationship.
  - Words in half the site's titles are ignored.
  - It is report only; the agent plan sends it to `seo-refresher`.

  The audit now stores each page's internal links in `audit.json`, so `links` needs no second crawl.

  On the reference site's build it suggests nothing at the default threshold, because only 1 page has 2 or fewer inbound links. At 6 or fewer, the first version suggested hub and navigation pages ("shared topic: one"); after the navigation and site-word filters, the suggestions are topical guide-to-guide links.

- **Two recipes in the playbooks (brief 01, items 4 and 5, from the reference site's production code).**
  - `consent-banner-recipe.md`: the logic for any stack, plus plain JavaScript, React and Astro versions. The `consent` job recognises it.
  - `conversion-tracking-recipe.md`: GA4 events without personal data (`generate_lead`, `tool_complete`, `view_calendar`, `cta_click`), a `track()` helper, a click tracker for call-to-action links, and how to mark key events.
  - The tests run the recipes' code: a fake browser for the consent script, and a real import of `track()`.
  - Running the consent code found a withdrawal bug, now fixed in the recipe. "Cookie settings" clears the stored choice, so "was consent granted before?" misses a later Reject and analytics keeps running. The recipe now reloads whenever the tag is loaded and the choice is "denied". the reference site has the same bug in `src/lib/consent.ts`; it is reported separately and not fixed here.
- **New `conversions` job.**
  - **Event counts:** the events GA4 received in the last 28 days, from the Data API (the same API the digest uses).
  - **Key events:** which events are marked as key events, from the Admin API.
  - **Findings:** an expected conversion missing, a conversion not marked as a key event, a key event that received nothing, or a property with no events at all.
  - **Configuration:** `conversions.events` sets the expected events (default `generate_lead`). It has a weekly workflow step.
  - **Not yet run against real GA4:** both calls are tested with mocked responses only.

- **New `facts` job (brief 01, item 3, ported from the "no unverified facts" rule in the reference site's `validate-content.mjs`).**
  - **What it finds:** percentages, money amounts, "N+" figures, multipliers ("3x faster"), rankings ("#1"), awards, and client claims ("trusted by", "clients include", "as seen in"). Each must be in `<dataDir>/verified-facts.json` (the reference site's format) or carry a source link in the same sentence.
  - **What it reads:** json and markdown content files, or the live pages of sitemap-only sites. `--files` limits it to the files a pull request changes.
  - **When it fails:** it warns by default; `--strict` or `facts.strict` exits 1.
  - **Agent plan:** unverified claims go to `seo-fact-checker`, as a blocker in strict mode.
- **Stricter than the script it replaces.**
  - A verified fact now covers only the claim inside its own text. the reference site's check let every number in a string pass if any verified fact appeared in it, because its window test always matched.
  - On the reference site's real content, the product finds 4 unverified claims the old check passed: two plan prices and two "keep 85%" statements that differ from the verified wording.
  - "used by" and "our clients" were tried as client patterns and dropped after they matched ordinary prose on the reference site.

- **New `redirects` job (brief 01, item 2, ported from the reference site's `check-redirects.mjs`, `generate-htaccess.mjs` and `smoke-redirects.mjs`).**
  - **The map:** one data file per site, `<dataDir>/redirects.json`, made of `redirects` (old path to new path or a full URL), `gone` (retired pages, answer 410) and `goneSections` (a whole retired path prefix). the reference site's `{ "map": ... }` shape is also read.
  - **`check`:** finds self-redirects, redirects that would hide a live page, chains and loops, targets that are not live or are gone, and live pages marked gone or inside a retired section. A target that is scheduled but not live yet is a warning. It exits 1 on errors, so it can guard a build.
  - **`generate`:** prints rules for Apache, nginx, Netlify or Vercel. `--write <file>` fills a marked block and keeps the file's line endings. Redirects to pages that are not live yet are held back until the target is live. Gone pages become 410s on Apache and nginx; on Netlify and Vercel they are listed for the platform to handle.
  - **`smoke`:** asks the live site, or `--origin` for staging. Each redirect must be a 301 or 308 to its exact target, gone pages must answer 410 (a 404 gets a note), and a made-up URL must be a real 404, not a soft 404.
  - Also `seo-autopilot redirects check|generate|smoke`, a weekly workflow step, and `site.redirects` in the config schema.
  - The agent plan sends map errors and live failures to `seo-redirect-guardian`, which now starts from these reports.
- Checked on the reference site's real redirect files (107 redirects, 113 retired URLs, 6 retired sections) against a local build:
  - The product's Apache rules match the block the reference site's generator writes, 105 of 105.
  - The check flags the same 2 targets the reference site does.
  - The live smoke test was only run against a local test server, because the live site was not reachable from the test machine.

- **Heading audit rules (brief 01, item 1, ported from the reference site's `audit-headings.mjs`).** Both crawlers now record the main content's heading outline: `<main>` when present, otherwise the page without header, nav, footer and aside. New low-severity rules, each with why, fix and a recipe: `h1-long` (over 70 characters), `heading-skip` (for example H2 then H4), `h2-generic` ("Overview", "Related" and similar), `h2-repeated`, and `few-subheadings` (600 or more words with fewer than two H2s, so hubs, tools and contact pages are not flagged). The agent plan sends these to `seo-refresher`.
- **New `quality` job (ported from the reference site's `audit-meta.mjs`, made generic).** Instead of a hand-kept keyword per page, it uses each page's own top Search Console query, with brand queries left out, and reports pages whose title, H1 or description reflects it weakly. Words that appear in half of the site's titles are not counted. It also reports average H2 and H3 per site section. It runs in the weekly workflow, and pages with weak titles or descriptions go to `seo-snippet-optimizer` in the agent plan.
- **Fix:** the agent plan could list the same agent twice (for example `seo-snippet-optimizer` for audit findings and again for click-through gaps). A second reason now adds evidence to the existing step.
- `audit.json` pages now carry `description`, `h2Count` and `h3Count`.
- Checked on a local build of the reference site (127 prerendered pages, the same HTML for both tools; the live site was not reachable from the test machine):
  - Section heading averages match the reference site's own script for all 17 sections.
  - `h1-long` finds the same 7 pages.
  - The Go and Node crawlers agree.
  - On the reference site's own keyword fields, the word matcher agrees with the reference site's script on 320 of 321 decisions; the one difference is a stemming error in the old script ("order" vs "ordering").

- **Agent eval graders (brief 04, first part):** `src/analysis/evals.mjs` adds deterministic graders for saved agent output: required sections, figures that appear in none of the inputs, required and banned phrases, a "no data" answer for empty inputs, and prompt-injection resistance. Cases live in `test/evals/cases.json`; `node scripts/evals.mjs <outputs-dir>` grades a folder of recorded outputs and writes a JSON and Markdown summary. Guide: `docs/evals.md`. The tests show the graders separate good samples from bad ones. **No agent has been evaluated yet**: that needs recorded runs.

## 2.13.0

- **Four new jobs**, all in the weekly workflow (`continue-on-error`) and all feeding `team`: `consent`, `ymyl`, `pace` and `citations`. Guide: `docs/measurement-and-compliance.md`.
- `consent`: reads the delivered home page and privacy or cookie page. Flags `tracking-without-consent-tool` and `privacy-claims-consent-but-no-mechanism` (high), `consent-mode-default-not-denied` (medium), and says plainly that tags injected at runtime cannot be seen (info). The report explains the gap between real and measured traffic. A high finding puts `seo-compliance-auditor` in the `block` phase of the agent plan.
- `ymyl`: flags pages on health, medical, legal, data protection, tax, finance, safety and children topics that lack `author` or `reviewedBy` (configurable with `review.topics` and `review.requireFields`), and shows which are held. The JSON and Markdown adapters now expose `author`, `reviewedBy` and `template` on pages.
- `pace`: counts releases per day and week, flags bursts, halves the recommended pace when many recent pages are Crawled or Discovered but not indexed, and writes a recommended schedule that never moves a page earlier. Report only; `--json` prints it. New `limits.pagesPerDay` (2), `limits.pagesPerWeek` (8), `limits.perTemplatePerDay`.
- `citations`: asks a SERP provider your questions (`seo-autopilot/questions.json`, 40 at most, sequential) and records whether the site is an organic result or a cited AI source, the most cited domains, absent questions and a monthly trend (last 26 runs kept). Providers: Brave Search API, SerpAPI, DataForSEO. Without a key it prints how to enable one and exits cleanly. **The providers are tested with mocked responses only; the live calls have not been run against the real APIs.**
- `consent` also reads the site’s own same-origin scripts, so a custom banner (consent wording plus a stored granted or denied choice) counts as a consent mechanism; this is a heuristic, a third-party platform is found by name.
- Config schema, defaults and validation accept `review` and the new `limits`. `doctor` reports whether a citations provider is set.

## 2.12.0

- **Any project that connects the repo gets the whole team.** `init` copies all 27 agents and 26 playbooks, writes the weekly workflow with the new `profile` and `team` steps, and now says what it detected (platform, edit or advise mode) and suggests the content setting (for example `--content markdown --dir content`) without turning on file edits by itself. Covered by a test that connects a Next.js app, a plain HTML site and a bare repository.
- The weekly workflow profiles the site and opens an **Agent plan** issue (label `seo-agent-plan`): which agents to run this week, in order, with the finding behind each.
- `doctor` reports the site profile and tells you to run `profile` when it is missing. Existing installs get the new workflow steps with `upgrade --diff` then `upgrade --apply`.

## 2.11.0

- **Works on any kind of website.** New `profile` job detects the platform (WordPress, Shopify, Wix, Squarespace, Webflow, Framer, Ghost, Drupal, Magento, Next.js, Nuxt, Astro, Gatsby, SvelteKit, Remix, TanStack Start, Angular, Hugo, Jekyll, Eleventy, Docusaurus, VitePress, single-page apps, plain HTML), how pages render (complete HTML or JavaScript-dependent), hosting, where content, redirects, robots and sitemaps live, structured data, analytics and consent. It decides **edit mode** or **advise mode** and writes `site-profile.json`. Every agent now reads it first.
- **Agent routing.** New `team` job reads the audit, priorities, indexing, speed and AI search reports and writes `agent-plan.md`: which agents to run, in order (blockers first), with the finding behind each and a ready-to-paste instruction. Deterministic and explainable.
- **Nine new agents (twenty-seven in all):** coordinator, onboarder, competitor analyst, international, ecommerce, migration planner, entity and reputation, media optimiser, compliance auditor.
- **Six new playbooks (twenty-six in all):** working on any kind of website, international SEO, ecommerce SEO, competitor analysis, images and media, entity and reputation.
- Several sites in one config are supported with `--site <id>`; each has its own profile, plan and Project rules.

## 2.10.0

- **Twelve new agents** (eighteen in all): fact-checker, snippet optimiser, cannibalisation resolver, content pruner, schema engineer, redirect guardian, performance fixer, indexing monitor, link builder, AI search agent, local agent and reporter. Each has a mission, required reading, method, quality bar, never-list and output format. The agents README now groups the team by job. Only the original six run in the unattended workflows; the new twelve are for use in Claude Code with a person watching.
- **Four new playbooks:** indexing and crawl diagnosis, local SEO, link building and digital PR, and SEO reporting (twenty in all).
- The GitHub site's agents and playbooks pages are rebuilt from the files, as before.

## 2.9.4

- Fix: a syntax error in the 2.9.3 request-indexing change (the weekly indexing job would have crashed). Now covered by a test that runs the job. 2.9.3 should not be used.

## 2.9.3

- Fix: the request-indexing lists linked to a Search Console address that answers 404. They now open the property and show the full URL to paste into "Inspect any URL".

## 2.9.2

- Fix: `seo-automerge` now has `checks: read`, which it needs to confirm `seo-check` passed on the exact commit. Without it the lookup failed with HTTP 403 and nothing could auto-merge.

## 2.9.1

- `seo-check` falls back to `npm install` (with a warning) when `npm ci` rejects the lockfile, so a lockfile written by a different npm version no longer blocks every SEO pull request and auto-merge.

## 2.9.0

- **Python engine (`engines/python`):** `run deepdive` groups your queries into topics (TF-IDF), flags unusual days and trends with robust statistics, and lists pages losing visibility. Standard library only.
- **Agent runtime (Python, Claude Agent SDK):** `run agent seo-strategist` and `run agent seo-researcher` run tool-using agents over your saved data. Read-only tools, a safe web fetcher (public addresses only), turn and budget limits, an audit trail, and proposals that become approval issues only when you ask. New optional `seo-agent` workflow (off until `SEO_AGENT=true`).
- **Go engine (`engines/go`):** `run audit --engine go` uses a fast concurrent crawler with the same output as the built-in one; a test requires identical results.
- `doctor` reports Python, the Agent SDK and Go. CI now builds and tests both engines.

## 2.8.0

- **`upgrade` command:** reports which workflows are missing or differ from this version's templates, with `--apply` to add missing ones and refresh the playbooks and agents, `--diff` to see the differences and `--force` to replace. Your pinned version tag is kept. Agent files keep your own "Project rules" section across upgrades.
- **`doctor` checks more:** workflows, playbooks and agents present, and (through the GitHub CLI) the Google, drafting and PageSpeed secrets plus the auto-merge, review and backlink variables.
- **Tests:** the real jobs now run end to end against a fake Google and a fake website (daily, analyze, audit, geo, speed, priorities, digest, dashboard, experiments, refresh), and the workflow templates are checked for structure, pinned actions and untrusted text in shell scripts.
- **Releases:** a release workflow publishes a GitHub Release from this changelog when an exact version tag is pushed; a manual `promote-stable` workflow moves the `v2-stable` tag to a release you trust.
- **Repository:** issue and pull request templates, code of conduct, Dependabot for this repository's workflows, `.gitattributes`, a JSON schema for the config file, and new docs (upgrading, troubleshooting, agents).

## 2.7.0

- **Agent team:** six structured agents (strategist, researcher, drafter, refresher, editor, technical fixer), each with mission, required reading, method, quality bar, never-list and output format. The implementer and reviewer workflows load them.
- **Four new playbooks:** keyword research and clustering, content briefs and drafting, editorial review checklist, audit fix recipes (every audit rule has a recipe).
- `knowledge` now refreshes the agents too.

## 2.6.0

- **Experiments now use a control group:** results are adjusted against the site's untouched pages over the same dates when there are enough of them.
- Dashboard and local app: new AI search (GEO) and Speed views.

## 2.5.0

- **Technical audit:** structured-data required-property checks (Organization, LocalBusiness, Product, FAQPage, BreadcrumbList, VideoObject, Event, JobPosting and more), hreflang validity, self-reference and return links, and missing Open Graph tags.
- **Reviewer agent (`seo-review.yml`, optional):** reviews each drafted pull request against your content rules and labels it `seo-review-passed`. Auto-merge can require that label (`SEO_REQUIRE_REVIEW`).
- **`refresh` job:** proposes in-place refreshes for your pages that lost visibility; the implementer updates the existing page instead of creating a new one.

## 2.4.0

- **`geo` job (GEO/AEO):** AI-crawler access in robots.txt (search vs training bots told apart), llms.txt, answer-first structure, question headings, text in the initial HTML, Organization/sameAs, dates and authors. Medium and high findings feed the priorities list.

## 2.3.0

- **Optional one-approval mode (`seo-automerge.yml`):** merges a drafted page's pull request once `seo-check` passes, only for `seo/*` branches in your own repository where every changed file is a content file. Off until you set the repository variable `SEO_AUTOMERGE=true`.
- **`speed` job:** Core Web Vitals (lab and real-user) for your top pages via PageSpeed Insights; poor pages feed the priorities list.
- The drafting workflow accepts `ANTHROPIC_API_KEY` as well as `CLAUDE_CODE_OAUTH_TOKEN`.

## 2.2.0

Expert layer: the autopilot now reasons about your site instead of only reporting numbers.

- **Technical audit (`audit`):** crawls the live site and checks titles, descriptions, canonicals, redirects, broken links, duplicate content, structured data, hreflang, orphans and thin pages. Every finding says why it matters and how to fix it.
- **Search insights (`analyze`):** striking-distance queries, CTR underperformers against a curve learned from your own site, keyword cannibalization, decaying pages, search-intent classification, brand vs non-brand split, topic clusters and content gaps.
- **Priorities (`priorities`):** every finding scored as impact x confidence / effort into one ranked list, with evidence, a weekly issue and a dashboard tab.
- **Experiments (`experiments`):** log a change, get a 14 days before/after report (directional, no control group, stated plainly).
- **SEO playbooks (`knowledge`):** 12 expert playbooks shipped with the product and copied into your project so the drafting agent reads them.
- App and dashboard: new Priorities, Technical audit and Search insights views. Digest includes top priorities, audit summary and experiments.

## 2.1.0

- **Local management app:** `seo-autopilot ui` serves one page on 127.0.0.1 that manages every project on your computer (overview and charts, index status, request-indexing links, schedule, keywords, backlinks, GitHub approvals, digest, sync, dry runs). Token-protected, host- and origin-checked, fixed list of allowed jobs, never submits or publishes.
- `projects add|list|remove` to choose which website folders the app shows.
- Landing site in `site/` with a clearly labelled sample-data demo, plus a Pages workflow (dormant until Pages is enabled).

## 2.0.3

- `propose` no longer opens "add internal links" issues for pages Google has not crawled yet (they go to the weekly request-indexing list). Opt back in with `"proposals": { "undiscovered": true }`.

## 2.0.2

- `state restore` now unstages the restored files, so a later `git add -A && git commit` can never put saved reports into your main branch.

## 2.0.1

- Security hardening of the drafting workflow: the agent may only edit your content paths and can no longer run build/test commands; the build now runs in a separate secret-free, read-only `seo-check.yml`; `claude-code-action` pinned to a commit SHA.

## 2.0.0

A rewrite from a single-site script pack into an installable, config-driven tool.

- `init`, `doctor`, `run`, `state` commands; `npx github:bishal-paul-git/seo-autopilot#v2 init` scaffolds config, data files and workflows into any repo.
- Multi-site config, content adapters (sitemap, JSON, Markdown).
- New jobs: weekly keyword research, news watcher (RSS/Atom), weekly digest with GA4, topic proposals, weekly "request indexing" list, drip scheduling and release, unlinked-mention finder, backlink submitter with daily cap, retry and full logging, hand-done checklist.
- Self-contained HTML dashboard; optional Supabase dashboard template.
- Approval-gated drafting workflow (issue label, pull request, merge).
- Fixed a state-saving bug that nested a `reports` folder on every run.

## 0.1.0

Initial release: daily report, IndexNow, onboarding skill.
