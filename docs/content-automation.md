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
3. **Draft.** The `seo-implement` workflow (needs the Claude GitHub app and `CLAUDE_CODE_OAUTH_TOKEN`) writes the page on a branch `seo/issue-N` and opens a **pull request**. It runs your build and checks. It is told to cite real sources, never copy them, and never invent numbers, prices, clients or quotes. It cannot push to your main branch.
4. **You review and merge.** The page enters your content as `queued: true` (not live).
5. **Schedule.** `schedule` (daily, in `seo-release.yml`) gives queued pages a `publishAt` date, up to 3 a day (max 4), after any dates already taken. A page marked `hold: true` is never scheduled.
6. **Publish.** Your site hides pages whose `publishAt` is in the future when it builds. On the day, `release` sees the page is due but not live and rebuilds the site (deploy hook, or an empty commit). The page goes live and joins the sitemap.

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
