# Content automation and scheduling

**Short answer to "is it creating pages without me knowing?" No.** The autopilot suggests; you approve; it drafts into a pull request; you merge; it schedules; the site publishes on the scheduled day. Every step that changes your site needs a human action.

```
 evidence                      you                       Claude                      you                  automation
 --------                      ---                       ------                      ---                  ----------
 Search Console queries  ->  "Topic: ..." issue  ->  add label "approved"  ->  drafts a page on a   ->  merge the pull   ->  "queued" page gets a
 news / regulator feeds       (with the data)                                     branch + opens a PR     request            publishAt date (3 a day)
                                                                                  (build + checks run)                         -> site rebuilds that day
```

## Step by step

1. **Find topics (no writing).** `research` (weekly) and `news` (daily) open issues titled `Topic: ...` with the evidence: real impressions from Search Console, or the feed item and source. At most 2 a week from research and 1 a day from news. Duplicates are skipped, and topics your site already covers are skipped.
2. **You decide.** Close an issue to decline. Add the label `approved` to accept. Nothing else happens until you do.
3. **Draft.** The `seo-implement` workflow (needs the Claude GitHub app and `CLAUDE_CODE_OAUTH_TOKEN`) writes the page on a branch `seo/issue-N` and opens a **pull request**. It is told to cite real sources, never copy them, and never invent numbers, prices, clients or quotes. It cannot push to your main branch.
   The agent can only edit your content paths, and cannot run build or test commands (a build runs project code, and the agent reads text from the public internet). Your build runs separately, in `seo-check.yml`, with no secrets and read-only permissions, on the pull request it opened. Make that check *required* in branch protection.
4. **You review and merge.** The page enters your content as `queued: true` (not live).
5. **Schedule.** `schedule` (daily, in `seo-release.yml`) gives queued pages a `publishAt` date, up to 3 a day (max 4), after any dates already taken. A page marked `hold: true` is never scheduled.
6. **Publish.** Your site hides pages whose `publishAt` is in the future when it builds. On the day, `release` sees the page is due but not live and rebuilds the site (deploy hook, or an empty commit). The page goes live and joins the sitemap.

## One-approval mode (optional)

By default you approve the topic and then merge the drafted pull request. To skip the merge step, set the repository variable `SEO_AUTOMERGE` to `true` (Settings > Secrets and variables > Actions > Variables). The `seo-automerge` workflow then merges a draft only after `seo-check` passes, only for `seo/*` branches in your own repository, and only when every changed file is inside your content folders. Merged pages are still marked queued, so nothing goes live until the scheduler releases it. Remove the variable to go back to merging by hand.

Note: pull requests opened with the default `GITHUB_TOKEN` do not trigger other workflows. The drafting action opens its pull requests through the Claude GitHub app, so `seo-check` runs normally.

## The agent team

Each agent is a Markdown file with a mission, the playbooks it reads first, a method, a quality bar, a "never" list and an output format. They live in `departments/<department>/agents/` (copied flat into your project's data folder by `init` and `seo-autopilot knowledge`). See `departments/README.md` for the org chart and the full flow, and copy any of them into `.claude/agents/` to use them in Claude Code.

## Reviewer agent (optional)

`seo-review.yml` runs a second Claude pass on every drafted pull request (`seo/*` branches in your repository). It only reads and comments. It checks for invented facts and unsupported numbers, missing sources, a weak opening and any file outside your content folders, then adds the label `seo-review-passed` or explains what to fix. Turn it on with the repository variable `SEO_REVIEW = true`. To make auto-merge wait for it, also set `SEO_REQUIRE_REVIEW = true`.

## Refresh proposals

When a page of yours loses a large share of impressions, the weekly `refresh` job opens a proposal (at most two per run) to update that page in place. You approve it like any other proposal. The issue states what the data shows and what it does not: a drop can be seasonal or a better page can have taken the ranking.

## Content-loss guard (in `seo-check`)

A refresh must not quietly throw away what a page already had. Before your install and build run, `seo-check` runs `seo-autopilot run content-guard` on every `seo/*` pull request. The tool runs from a folder outside your checkout (the runner's temp folder) and reads your repository only through git, so nothing from the pull request runs or is read as settings first: not its `.npmrc`, not its `package.json`, not its `node_modules`. For every changed page it compares the version on your main branch with the pull request's version and **fails the check** when the page:

- lost more than 15% of its words (`contentGuard.maxWordDropPercent`; compared exactly, so 15.04% fails at 15%);
- lost a heading (H1 to H6). A heading reworded into a similar one is a warning, since rewriting a heading is normal editing; a heading deleted with an unrelated one added (a section removed, "More" put in its place) is a removal;
- lost an internal link, an image (in the text, in an image tag or component, or in the front matter), or structured data (a JSON-LD block or one of its `@type`s);
- changed a page setting: `draft`, `published`, `status`, `noindex`, `robots`, `canonical`, `permalink`, `slug`, `url`, `redirect`, `sitemap`, `expiryDate`, `unlisted`, `hidden`, `private`, `_build` and similar keys in the front matter (YAML or TOML) or at the top of a JSON page object, and `<meta name="robots">` or `<link rel="canonical">` in an HTML page. Setting a page to draft, noindex or a canonical on another site keeps every word but takes the page out of search;
- was removed: its file deleted, or its entry removed from a JSON page list.

Text that readers cannot see does not count as kept: HTML comments, MDX `{/* */}`, Hugo `{{/* */}}`, Liquid `{% comment %}` and Nunjucks `{# #}` comments, and elements that are hidden (the `hidden` attribute, `display: none` or `visibility: hidden`, and classes like `hidden`, `d-none`, `sr-only` unless a wider-screen class shows them again). Wrapping the old text in a comment or a hidden block fails like deleting it.

It reads Markdown and MDX (with front matter), HTML, and JSON files holding a list of page objects (nested sections, headings, links, images and `schema` objects included). File names are read from git as they are, so Arabic and other non-ASCII file names are checked like any other. Words are counted in any script, so Arabic (with or without vowel marks), accented Latin and other alphabets count like English; Chinese and Japanese characters count one each. A new page has nothing to lose, so it only gets warnings: no text, no H1 (or front-matter title), no internal link. The check's summary shows one row per page: words, headings, internal links, images and structured data before and after, and what was removed or changed.

Every input that decides what is checked comes from the **base branch's** `seo-autopilot.config.json`: the word limit, your site's address (which links are internal), the data and state folders that are skipped, and the unpublish field. A pull request cannot loosen its own check by editing the config.

**Reverts opened by `seo-watch`.** A `seo/revert-<n>` branch is trusted (it may restore older content or unpublish a page) only when all of these hold: the pull request's author and the account that last added its `seo-revert` label are both the workflow's bot (`github-actions[bot]`); pull request #n was merged from a `seo/*` branch; and the change is exactly what `seo-watch` makes, either the exact undo of #n (the same files, each back to its version before #n's merge, squash or rebase merge) or exactly the unpublish of the pages #n added (the unpublish field and `hold: true` set, nothing else). Anything else on such a branch is checked like any change. A branch name alone proves nothing: anyone who can push can name a branch `seo/revert-5`. If the check cannot read the pull request, #n or the label events (a private repository where its read-only token has no pull-request access), the revert is not trusted and a person reviews it.

**Human-only override.** When the loss is intended (pruning, merging two pages, taking a page out of search), a person other than the pull request's author adds the label `allow-content-shrink` and re-runs the check. The check confirms from the pull request's events that the label is still there, that a person (a User account, not a bot, not the author) added it last, and that they added it **after the latest commit**. A push after the label needs the label removed and added again, so an approval never carries over to content the person did not see. (The commit time comes from git; a pushed commit can carry a made-up date, so the person approving should look at the final diff.) If it cannot read the events (a private repository where the check's read-only token has no pull-request access), the override is not applied; a person with admin rights can still merge past the check. The autopilot, the agents and the workflows never add this label.

## Watch and revert after merging (`seo-watch`)

Every refresh and every new page merged from a `seo/*` branch, by you or by the autopilot, is watched for 28 days (`watch.days`) after a 3-day lag. The list of watched changes is kept with the other saved reports on the `seo-data` branch (`watch-content.json`).

- **A refresh** is reverted when its page answers an error on two check days in a row (one failed fetch can be a network error, a firewall or a short outage), the change added a noindex the page carries on two check days in a row, or, once 14 days of Search Console data exist after the lag, the page lost clearly more clicks than the rest of the site (at least 40% worse than the untouched pages over the same dates, or 50% when there are too few untouched pages to compare, and at least 10 clicks lost from at least 100 impressions before). The revert restores the previous content: `seo-autopilot run watch --git-revert` reverts a merge commit against its first parent, a rebase merge as the whole range of its commits, and a squash merge as one commit.
- **A new page** has no "before", so it is judged by the pages it competes with: the existing pages whose keyword or title share most of its topic words. When those lose clearly more clicks than the rest of the site and the new page did not win the clicks back, it is **unpublished**: its draft field is set (`draft: true` by default; `content.unpublish` changes it) plus `hold: true`, so the scheduler never dates it again. The file, its text, its slug and its URL stay; nothing is deleted. A new page that is not live (an error status or a noindex, because it is not published yet or already off the site) is never unpublished, and its window starts on its publish date (`publishAt`), or the day it is first seen live, not on the merge date.

Each revert is a pull request on `seo/revert-<n>`, labelled `seo-revert`, built by `seo-check`, with a comment on the original pull request saying why (that comment is the alert: everyone subscribed to the pull request is notified). **These reverts always wait for a person to merge.** Only the autopilot's own "undo"-level changes are merged back automatically, as before. Turn the content watch off with `"watch": { "content": false }`. It needs `content.type` `json` or `markdown` (a sitemap site has no files to map or unpublish).

For the unpublish to take a page off the site, your build must leave out pages with the unpublish field set, the same way it leaves out queued and future pages (below). Not every stack does this by default: many static site generators publish `draft: true` pages in some build modes, and a site that renders straight from a CMS may ignore the field entirely. Set `content.unpublish` to the field your site actually uses (for example `{ "field": "published", "value": false }` for Jekyll). Two days after an unpublish pull request is merged, `seo-watch` fetches the page again: if it still answers 200 without a noindex, the entry is marked `revert-failed` and an issue is opened, so a person takes the page off by hand. The watch never assumes the unpublish worked.

The kill switch `SEO_AUTOPILOT_PAUSED = true` stops all of this, reverts included: `seo-watch` does not run at all (no check, no revert pull request, no unpublish, no merge), and the job itself refuses to run while paused. Reverts wait for a person to merge anyway, so a paused repository loses nothing it could not do by hand. The guard in `seo-check` keeps running while paused: it only blocks merges.

## What the automation never does

- Never creates a page on its own, never publishes unreviewed text, never edits your existing pages without an approved issue and a pull request.
- Never schedules a page you did not merge. Never touches `hold: true` pages.
- Never puts numbers or claims into a draft that you cannot trace to a source (this is also enforced by your own validator, if you have one).

## Making your site respect `publishAt`

This is the only code change on your side. At build time, drop items whose date is in the future or that are still queued:

```js
// JSON-driven site (example)
const today = new Date().toISOString().slice(0, 10);
const live = (item) => !item.queued && !item.draft && !(item.publishAt && item.publishAt.slice(0, 10) > today);
const pages = allPages.filter(live);
```

For Markdown, filter on front matter the same way (`queued: true`, `draft: true`, `publishAt: 2026-10-20`). `draft: true` is what `seo-watch` sets to unpublish a harmful new page; if your site already uses another field (Jekyll's `published: false`), set `content.unpublish` to it. Generate your sitemap from the filtered list, so unreleased pages are not announced. If your content is rendered on the server per request instead of at build time, the same filter works at request time and no rebuild is needed.

## Configuration

```json
"content": {
  "type": "json",
  "include": ["src/content/guides.json"],
  "routes": [{ "match": "guides.json", "urlPattern": "/blog/{slug}" }]
},
"schedule": { "perDay": 3 },
"release": { "deployHookEnv": "DEPLOY_HOOK_URL" }
```

`urlPattern` lets `release` know each page's public URL so it can check whether it is live. Manual run: `npx seo-autopilot run schedule --dry` shows the plan without editing anything.

## Pace

Three a day is a sensible ceiling for a small site, and the scheduler caps at four. A slow, steady drip looks like a site being worked on, and it lets you watch how the first batch is treated before the rest go out. It does not stop search engines finding live pages; it paces announcement.
