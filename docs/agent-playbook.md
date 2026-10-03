# Agent chain (propose, review, approve, publish)

Runs per site from `sites.json`. Nothing is edited, committed or pushed before the owner says yes.

1. **Reporter**: `node daily.mjs <siteId>` then read `reports/<id>/daily-summary.md`.
2. **Researcher** (seo-keyword-researcher): for near-miss queries, produce a brief (one primary keyword per page).
3. **Writer** (seo-content-writer): draft the page or title change in the site repo's content schema. Never invent clients, statistics, prices or guarantees.
4. **Reviewer** (seo-copy-editor, seo-technical-auditor): tighten copy, check canonical, sitemap, links.
5. **Proposal**: write `reports/<id>/proposals-YYYY-MM-DD.md` (max 3: what, data point, files, risk). STOP and ask for approval.
6. **After approval**: in the site's `repoPath` run its build and link check, commit, push, then verify the live URL.
7. **Index nudge**: `node indexnow.mjs <siteId>` (Bing and others). For Google, list 10 URLs for manual Request indexing.

Rules: one change set per day, reversible with `git revert`; keys never printed or committed; work on one site at a time and only sites listed in `sites.json`.
