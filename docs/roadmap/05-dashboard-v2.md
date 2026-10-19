# 05 Dashboard v2: portfolio, plan and approvals

**Goal:** one page where an owner or agency sees every site's health, this week's agent plan and what waits for approval.

**Context:** `src/jobs/dashboard.mjs` builds a static dashboard (`docs/dashboard.md`, `docs/ui.md`). Config supports many sites. Per-site data already exists: `priorities.json`, `audit.json`, `insights.json`, `agent-plan.json`, `consent.json`, `ymyl.json`, `pace.json`, `citations.json`, `history.json`, `site-profile.json`, `experiments.json`.

**Build**
1. Portfolio page: a row per site (traffic trend, indexed share, open high findings, plan status, pace, consent status, last run), sorted by needs attention.
2. Site page tabs: Plan (ordered agents with evidence and copy buttons), Findings, Search, Citations, Experiments, Pipeline.
3. Approvals inbox: open issues and PRs with the product's labels (`seo-proposal`, `seo-topic`, `approved`, `seo-review-passed`, `seo-agent-plan`) with one-click links, via the GitHub API with the user's token or a weekly snapshot.
4. Print-ready monthly report from `seo-reporter` output plus numbers; white-label (logo, colours, name) in config.
5. Single folder, works offline, no external requests, keyboard accessible. All untrusted text (queries, titles) escaped.
6. `run dashboard --portfolio` for all sites, plus a JSON export.

**Done when:** snapshot tests on fixture data, escaping tests, reviewed on real site data, screenshots in `site/`, docs, release.
