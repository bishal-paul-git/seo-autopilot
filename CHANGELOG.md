# Changelog

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
