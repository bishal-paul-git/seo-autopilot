# Roadmap: what is built, what is left

Each file below is a self-contained brief for a new Claude Code session. Open a session in this repository, tell it to read `CLAUDE.md` and then the brief, and let it work. Briefs are ordered by value; "foundation" ones should come first because the rest build on them. Keep `npm test` green and follow the release procedure in `CLAUDE.md`.

## Read this first: the owner's product brief
`SEO-PRODUCT-BUILD-BRIEF.md` (repository root) is the owner's plan for the sellable, agency-focused product, including reuse of Marketing Mouse and News to Blog, with phases and acceptance gates. It takes precedence over briefs 05, 06 and 07 below, which overlap its phases 1 to 4 and must be planned through its Phase 0 reuse audit. Briefs 01, 02, 03, 04, 08 and 09 are independent of that audit. Progress files: `../implementation/STATUS.md` (start here), `CHANGELOG.md`, `DECISIONS.md`.

## Current inventory (verified 2026-10-25)

Main v2.20.0 contains 57 jobs, 38 agent definitions in eight departments, 30 knowledge documents and seven shared skills. Counts do not establish live integrations or agent execution. See `../implementation/STATUS.md` and the live-system trace for verified/deployed distinctions. Existing hosted interface work must extend its actual source once traced.

## Historical baseline (v2.13.0)
Jobs: `audit`, `analyze`, `priorities`, `experiments`, `speed`, `geo`, `deepdive`, `refresh`, `agent`, `profile`, `team`, `consent`, `ymyl`, `pace`, `citations`, plus the daily/weekly workflow jobs (`daily`, `news`, `research`, `propose`, `digest`, `indexing-queue`, `indexnow`, `backlinks`, `mentions`, `release`, `schedule`, `dashboard`). 27 agents, 26 playbooks, Go crawler, Python agent runtime for the strategist and researcher, edit vs advise mode through the site profile, agent routing, landing site with agents and playbooks pages, release automation.

## Briefs

| # | Brief | Type | Why |
|---|---|---|---|
| 01 | [Port proven site tooling into the product](01-port-site-tooling.md) | foundation | Real, proven tools that lived only in one site's repository: heading and meta audits, redirect map and smoke test, consent and conversion recipes, facts guard |
| 02 | [Run all 27 agents unattended and safely](02-agent-runtime-all-agents.md) | foundation | Only two agents run outside Claude Code; the rest need a safe runtime with budgets and approvals |
| 03 | [Live-test and harden the data providers](03-live-providers-and-data.md) | foundation | `citations` has never run against real APIs; add rank tracking, Bing, CrUX, GA4 conversions |
| 04 | [Agent evaluations and safety tests](04-agent-evals-and-safety.md) | foundation | Trust is the product: prove agents do not invent facts, follow injected instructions or overstep |
| 05 | [Dashboard v2: portfolio, plan and approvals](05-dashboard-v2.md) | product | Multi-site view, agent plan, approvals inbox, reports |
| 06 | [CMS connectors (WordPress first)](06-cms-connectors.md) | product | Reach non-repository sites by applying approved changes through platform APIs |
| 07 | [Hosted cloud (SaaS) MVP](07-hosted-cloud-mvp.md) | business | GitHub App, accounts, billing, scheduled runs, no setup for the user |
| 08 | [Distribution and launch](08-distribution-and-launch.md) | business | npm, GitHub Action and Marketplace, docs and demo site, case study, waitlist |
| 09 | [Quality of life and gaps](09-gaps-and-polish.md) | polish | Known loose ends and small features |
| 10 | [Page planner and funnels](10-page-planner-and-funnels.md) | product | From a business goal to a keyword map, page plan and conversion funnel, with facts the owner must supply |
| 11 | [Ideas and findings backlog](11-ideas-and-findings.md) | backlog | Bugs and ideas found in real use, not yet briefs |
| 12 | [Vertical packs (local, e-commerce, more)](12-vertical-packs.md) | product | Each site gets the specialist agents and data jobs for its kind of business, detected automatically |
| 13 | [Going live: open source launch, then hosted product](13-go-live.md) | business | The checklist from today's release to a paid product, and what only the owner can do |
| 14 | [More free data: Search Console in full, Keyword Planner, open data](14-free-data-sources.md) | data | Free sources with the user's own accounts: Sitemaps API, Discover and News performance, Keyword Planner volumes, Wikipedia, Stack Exchange, Common Crawl |

Strategy and the reasoning for this order: [../strategy.md](../strategy.md). How projects connect and feed back: [../connected-projects.md](../connected-projects.md).

## How to start a session
Paste: "Work in the seo-autopilot repository. Read CLAUDE.md, then docs/roadmap/NN-name.md, and do that brief end to end: build it, test it, update docs and CHANGELOG, bump the version, and release following CLAUDE.md. Report what you verified and what you could not."
