# Getting started

About 15 minutes. You need: a website in a GitHub repository, a sitemap at `/sitemap.xml`, and a Google account that owns the site in Search Console.

## 1. Scaffold

In the root of your website's repository:

```bash
npx github:bishal-paul-git/seo-autopilot#v2 init --url https://example.com/ --name "Example"
```

Options (all optional):

| Flag | Meaning |
|---|---|
| `--id` | short id, default derived from the domain |
| `--property` | Search Console property, for a Domain property use `sc-domain:example.com` |
| `--content json` + `--include "content/**/*.json"` | pages are JSON files |
| `--content markdown` + `--dir content/blog` | pages are Markdown files with front matter |
| `--spec` | which version the workflows call, default `github:bishal-paul-git/seo-autopilot#v2` |
| `--no-workflows` | skip the GitHub workflows |

It creates `seo-autopilot.config.json`, the folder `seo-autopilot/` (feeds, keyword config, backlink profile and targets) and four workflows in `.github/workflows/`. Existing files are never overwritten unless you add `--force`.

## 2. Connect Google

Follow [google-setup.md](google-setup.md). The result is one secret, `GOOGLE_KEY_JSON`, and the service account added to your Search Console property.

## 3. Check it

```bash
GOOGLE_KEY_FILE=/path/outside/the/repo/key.json npx github:bishal-paul-git/seo-autopilot#v2 doctor
```

`doctor` checks the sitemap, your content adapter, Search Console access, IndexNow, feeds and the backlink profile, and tells you exactly what to fix.

## 4. Make it yours

- `seo-autopilot/topics.json`: the keywords that make a news item relevant to **your** industry.
- `seo-autopilot/feeds.json`: RSS/Atom feeds to watch (regulators, platforms, news). Only add feeds you have opened and checked.
- `seo-autopilot/backlinks/profile.json`: true, public facts only.

## 5. Turn it on

Commit and push. In GitHub: **Actions > seo-daily > Run workflow**. Open the run, then download the `seo-dashboard` artifact.

Optional extras:

- **Dashboard and database:** [dashboard.md](dashboard.md).
- **Drafting pages after you approve them:** install the Claude GitHub app and add the secret `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`).
- **Scheduled publishing:** [content-automation.md](content-automation.md).
- **AI judging and wording:** add `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`).
- **Backlinks:** [backlinks.md](backlinks.md). They stay in dry-run mode until you set `BACKLINKS_LIVE=true`.

## Several sites in one repo

Add more objects to `sites` in `seo-autopilot.config.json`. Each site needs its own Search Console property and its own `id`. Jobs run for every site; use `--site <id>` for one.
