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
| Index | `indexing-queue` | weekly | an issue with the 10 pages to **Request indexing** for by hand, each with the full URL to paste into Search Console |
| Research | `research` | weekly | keyword backlog from real queries (near-miss, question, rising, uncovered), up to 2 topic proposals |
| Trends | `news` | every day | ranks items from your RSS/Atom feeds, proposes at most one topic a day |
| Analyse | `digest` | weekly | week-on-week search changes, index status, pipeline, backlinks, GA4 sessions, next actions |
| Fix | `propose` | every day | issues for weak titles and undiscovered pages |
| Write | `seo-implement` workflow | when you add the label `approved` | Claude drafts the change on a branch and opens a pull request |
| Publish | `schedule` + `release` | daily | approved pages get release dates, N a day, and the site is rebuilt when each is due |
| Links | `backlinks`, `backlinks-queue`, `mentions` | daily / weekly | capped, careful submissions; a hand-done checklist; unlinked brand mentions with a drafted request |
| See | `dashboard` | every day | one HTML file with charts, index status, the schedule, keywords and backlinks |
| Manage | `ui` (local app) | on demand | one app on your computer for every project: dashboard, approvals from GitHub, sync, dry runs |
| Keywords | `keywords` | weekly, or on request | keyword explorer: topics, intent, demand, difficulty, gaps no page owns, questions |
| Rankings | `rank` | every day | tracked positions from Search Console, movers, visibility; with `--serp`, search features and share of voice |
| Competitors | `gap`, `changes` | weekly | queries competitors win and you do not; what they changed on their winning pages |
| Content | `optimize` | on request | a page or draft scored against the top results: terms, sections, questions, length, readability |
| AI search | `ai-visibility` | monthly (opt-in) | how ChatGPT, Claude, Gemini and Perplexity mention and cite you |
| Authority | `authority`, `entity` | weekly / monthly | referring domains with authority, link intersect; Knowledge Graph and Wikidata check |
| Site | `linkgraph`, `vitals`, `schema` | daily / weekly | internal PageRank and orphans; real-user Core Web Vitals; structured data checks and drafts |
| Trend | `forecast` | monthly | whether traffic is inside its normal range (Python) |
| Autopilot | `seo-autopilot`, `seo-watch`, `monthly` | twice a day / daily / monthly | routine changes drafted, checked and merged within limits; watched and undone if they hurt; a monthly report |
| Assistants | `seo-autopilot mcp` | on demand | Claude, ChatGPT or any MCP client reads the reports and runs analysis jobs |

All of the research and site tools run on your own Search Console data first. Each key you add (most are free) switches on more: see [docs/research-suite.md](docs/research-suite.md).

## The one rule: checks approve routine work, a person approves risky work

- **By default nothing publishes without you.** The tool opens an issue ("Topic: …") with the evidence. When you add the label `approved`, the implementer drafts the change on a branch as a **pull request**. Nothing is live until it is merged.
- **Autopilot is opt-in** (repository variable `SEO_AUTOPILOT=true`, decision D17). Routine changes are merged automatically, but only after every automated check (build, facts, reviewer) has passed on that exact commit. Routine means fixes, titles and descriptions, internal links, refreshes, and a few new pages a week. The pace limits apply, and the `seo-watch` job undoes a change that makes things worse.
- **Always a person:** sensitive topics (health, money, legal), site-wide indexing changes, migrations, deletions, outreach, and changes to workflows or dependencies. `SEO_AUTOPILOT_PAUSED=true` stops everything.
- A merged page is marked *queued*. The scheduler dates it (default 3 a day), and the site goes live with it on that day.
- Hard rules baked into every prompt: no invented numbers, clients, quotes, prices or results; cite real sources.

Read [docs/content-automation.md](docs/content-automation.md) for the full picture.

## Honest limits

- **Google indexing cannot be automated.** The Indexing API is only for job and livestream pages. The tool prepares the list; you press the button (about 10 a day).
- IndexNow reaches Bing, Yandex, Seznam and Naver, not Google.
- **Keyword volumes are not included by default.** Research uses your own Search Console impressions. Estimated volumes and competitors' rankings need your own DataForSEO key, and are labelled as estimates. AI "ideas" are flagged as unverified.
- **The paid-provider integrations (DataForSEO, SERP providers, AI engines) and the free Google APIs have been tested with recorded responses, not yet against the live services.** Check a report against the provider's own dashboard the first time you use a key.
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
seo-autopilot ui [--open]                        local app to manage every project on this computer
seo-autopilot mcp [--project folder]             MCP server for Claude, ChatGPT and other AI assistants
seo-autopilot projects add|list|remove [folder]  choose which website folders the app shows
seo-autopilot state restore|save                 load or save memory on the "seo-data" branch
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Connect Google: Search Console and Analytics](docs/google-setup.md)
- [Content automation and scheduling](docs/content-automation.md)
- [Dashboard](docs/dashboard.md)
- [The local app](docs/ui.md)
- [The expert layer: audit, insights, priorities, experiments](docs/expert.md)
- [Research suite and site intelligence: keywords, rank, gap, optimiser, AI visibility, authority, link graph, vitals, schema, entity](docs/research-suite.md)
- [Use it from Claude or ChatGPT (MCP)](docs/mcp.md)
- [Backlinks](docs/backlinks.md)
- [Configuration reference](docs/configuration.md)
- [Jobs and secrets](docs/jobs.md)
- [Measurement and compliance: consent, sensitive topics, pace, citations](docs/measurement-and-compliance.md)
- [The agents](docs/agents.md)
- [Python and Go engines](docs/engines.md)
- [Upgrading](docs/upgrading.md)
- [Troubleshooting](docs/troubleshooting.md)
- [IndexNow](docs/indexnow.md)
- [FAQ](docs/faq.md)

## Landing page

The product site lives in [`site/`](site/) (with a sample-data demo of the dashboard) and deploys to GitHub Pages from `.github/workflows/pages.yml` once Pages is switched on for the repository.

## Status

Version 2 is used in production on the maintainers' own sites. Contributions and bug reports are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).
