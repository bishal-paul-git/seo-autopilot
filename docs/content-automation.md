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

Each agent is a Markdown file with a mission, the playbooks it reads first, a method, a quality bar, a "never" list and an output format. They live in `agents/` (copied into your project's data folder by `init` and `seo-autopilot knowledge`). See `agents/README.md` for the full flow, and copy any of them into `.claude/agents/` to use them in Claude Code.

## Reviewer agent (optional)

`seo-review.yml` runs a second Claude pass on every drafted pull request (`seo/*` branches in your repository). It only reads and comments. It checks for invented facts and unsupported numbers, missing sources, a weak opening and any file outside your content folders, then adds the label `seo-review-passed` or explains what to fix. Turn it on with the repository variable `SEO_REVIEW = true`. To make auto-merge wait for it, also set `SEO_REQUIRE_REVIEW = true`.

## Refresh proposals

When a page of yours loses a large share of impressions, the weekly `refresh` job opens a proposal (at most two per run) to update that page in place. You approve it like any other proposal. The issue states what the data shows and what it does not: a drop can be seasonal or a better page can have taken the ranking.

## What the automation never does

- Never creates a page on its own, never publishes unreviewed text, never edits your existing pages without an approved issue and a pull request.
- Never schedules a page you did not merge. Never touches `hold: true` pages.
- Never puts numbers or claims into a draft that you cannot trace to a source (this is also enforced by your own validator, if you have one).

## Making your site respect `publishAt`

This is the only code change on your side. At build time, drop items whose date is in the future or that are still queued:

```js
// JSON-driven site (example)
const today = new Date().toISOString().slice(0, 10);
const live = (item) => !item.queued && !(item.publishAt && item.publishAt.slice(0, 10) > today);
const pages = allPages.filter(live);
```

For Markdown, filter on front matter the same way (`queued: true`, `publishAt: 2026-10-20`). Generate your sitemap from the filtered list, so unreleased pages are not announced. If your content is rendered on the server per request instead of at build time, the same filter works at request time and no rebuild is needed.

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
