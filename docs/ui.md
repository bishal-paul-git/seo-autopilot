# The local app

One page on your computer to see and manage **every website you run** with seo-autopilot.

```bash
npx github:bishal-paul-git/seo-autopilot#v2 projects add ~/sites/my-website   # a folder that has seo-autopilot.config.json
npx github:bishal-paul-git/seo-autopilot#v2 ui --open
```

It prints a private link such as `http://127.0.0.1:4747/?token=...` and (with `--open`) opens it. Press Ctrl+C to stop. Use `--port` to change the port. `projects list` and `projects remove <folder>` manage the list; the app can also add and remove folders.

## What you can do

| Tab | What it shows |
|---|---|
| Overview | clicks, impressions, position, indexed pages, scheduled pages, and charts over time |
| Index status | how many pages are in each Google state, and the pages to request indexing for, each with a Search Console link |
| Content | pages that went live this week, the schedule, approved-but-undated and on-hold pages |
| Keywords | the keyword and topic backlog |
| Backlinks | targets and their status |
| Approvals (GitHub) | the open `seo-topic`, `seo-proposal`, `seo-indexing`, `seo-backlink` and `seo-digest` issues, with links to approve on GitHub |
| Digest and news | the latest weekly digest and the news list |
| Run and sync | **Sync from GitHub** pulls the latest saved data from the `seo-data` branch; buttons run jobs here |
| Settings | the path to your Google key file; remove a project from the app |

## How data gets there

The cloud workflows save their memory on the `seo-data` branch of each repository. **Sync** fetches that branch into the project's state folder (and unstages it, so it can never be committed by accident). The app then reads those files. Nothing is copied anywhere else.

The Approvals tab uses the GitHub CLI (`gh`) that you already have signed in. Without it the tab says so and the rest still works.

## What it will and will not do

- It listens on **127.0.0.1 only** and refuses any request that does not carry the random token printed at start-up, or that comes from another web page or host name (this blocks DNS-rebinding and cross-site requests).
- It can start only a fixed list of jobs: `dashboard`, `indexing-queue`, `schedule`, `release` and `indexnow` (the last four as dry runs), `daily`, `research`, `digest`, `news`, `propose`, `mentions` and `backlinks-queue`. **It never submits backlinks, never publishes and never runs anything with `--live`.** Real publishing, drafting and submissions happen only in GitHub Actions, behind your approvals.
- It stores two small files in `~/.seo-autopilot` (override with `SEO_AUTOPILOT_HOME`): the list of project folders and the *path* of your Google key file. It never stores or copies the key.
- Jobs that read Google (`daily`, `research`, `digest`) need the key file path under Settings. Jobs that would open GitHub issues only print what they would do here, because the app does not hold a GitHub token.

## Teams

It is a local tool by design: each person runs it on their own computer against the same repositories. The cloud workflows keep everyone's data in sync through the `seo-data` branch.
