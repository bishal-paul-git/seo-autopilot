# seo-autopilot

An open-source SEO autopilot for any website. It watches Google Search Console, checks which pages are indexed, researches keywords from your real search data, reads the news in your field, writes a weekly digest, drafts new pages **only after you approve them**, drips approved pages out on a schedule, and helps with backlinks in a careful, capped way. It runs on GitHub Actions, so no computer has to stay on, and everything it knows is kept in your own repository.

It is a command line tool (Node 20+, no dependencies) plus ready-made GitHub workflows. MIT licensed.

```bash
# in your website's repository
npx github:bishal-paul-git/seo-autopilot#v2 init --url https://example.com/
```

That creates a config file, a few editable data files and the GitHub workflows. Then follow [docs/getting-started.md](docs/getting-started.md) (about 15 minutes, most of it Google's own screens).

## What it does

| | Job | When | What you get |
|---|---|---|---|
| Measure | `daily` | every day | Search Console totals, URL Inspection of the next 60 sitemap URLs, near-miss queries, no-click pages |
| Index | `indexnow` | every day | up to 10 URLs sent to Bing, Yandex and others |
| Index | `indexing-queue` | weekly | an issue with the 10 pages to **Request indexing** for by hand, each with a direct Search Console link |
| Research | `research` | weekly | keyword backlog from real queries (near-miss, question, rising, uncovered), up to 2 topic proposals |
| Trends | `news` | every day | ranks items from your RSS/Atom feeds, proposes at most one topic a day |
| Analyse | `digest` | weekly | week-on-week search changes, index status, pipeline, backlinks, GA4 sessions, next actions |
| Fix | `propose` | every day | issues for weak titles and undiscovered pages |
| Write | `seo-implement` workflow | when you add the label `approved` | Claude drafts the change on a branch and opens a pull request |
| Publish | `schedule` + `release` | daily | approved pages get release dates, N a day, and the site is rebuilt when each is due |
| Links | `backlinks`, `backlinks-queue`, `mentions` | daily / weekly | capped, careful submissions; a hand-done checklist; unlinked brand mentions with a drafted request |
| See | `dashboard` | every day | one HTML file with charts, index status, the schedule, keywords and backlinks |

## The one rule: nothing is published without a human step

- The autopilot **never creates a page by itself**. It opens an issue ("Topic: …") with the evidence. You add the label `approved`.
- Only then does the implementer draft the page, on a branch, as a **pull request**. Nothing is live until you **merge** it.
- A merged page is marked *queued*. The scheduler dates it (default 3 a day), and the site goes live with it on that day.
- Hard rules baked into every prompt: no invented numbers, clients, quotes, prices or results; cite real sources; keep a human in the loop.

Read [docs/content-automation.md](docs/content-automation.md) for the full picture.

## Honest limits

- **Google indexing cannot be automated.** The Indexing API is only for job and livestream pages. The tool prepares the list; you press the button (about 10 a day).
- IndexNow reaches Bing, Yandex, Seznam and Naver, not Google.
- There is **no keyword-volume data**. Research uses your own Search Console impressions. AI "ideas" are flagged as unverified.
- **Backlinks cannot be fully automated.** Most free directories need an account or show a CAPTCHA, and this tool never solves CAPTCHAs, never creates accounts, never pays and never swaps links. See [docs/backlinks.md](docs/backlinks.md).
- Nothing here guarantees rankings or indexing.

## Install options

1. **Per project (recommended):** `npx github:bishal-paul-git/seo-autopilot#v2 init --url …` inside each website repo. The generated workflows call the same version tag, so you get fixes by moving the tag, or pin a version like `#v2.0.0`.
2. **Several sites from one repo:** add more entries to `sites` in the config; jobs run for each site.
3. **As a Claude Code plugin:** `/plugin marketplace add bishal-paul-git/seo-autopilot`, then ask Claude to "set up SEO for this site". It follows the same steps.

## Commands

```
seo-autopilot init --url https://example.com/   scaffold config, data files and workflows
seo-autopilot doctor                             check the setup and say what to fix
seo-autopilot run <job> [--site id] [--dry]      run one job
seo-autopilot state restore|save                 load or save memory on the "seo-data" branch
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Connect Google: Search Console and Analytics](docs/google-setup.md)
- [Content automation and scheduling](docs/content-automation.md)
- [Dashboard](docs/dashboard.md)
- [Backlinks](docs/backlinks.md)
- [Configuration reference](docs/configuration.md)
- [Jobs and secrets](docs/jobs.md)
- [IndexNow](docs/indexnow.md)
- [FAQ](docs/faq.md)

## Status

Version 2 is used in production on [erudience.com](https://erudience.com). Contributions and bug reports are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).
