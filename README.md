# seo-autopilot

A daily SEO loop for any website: it checks Google Search Console, inspects your pages' index status,
pings IndexNow, and hands a short list of proposed improvements to you (or to Claude Code) for approval.
No dependencies beyond Node 18. Runs on GitHub Actions, so no computer has to stay on.

## What it does
- **Daily report** (`daily.mjs`): 28-day clicks, impressions and position; inspects the next 60 sitemap URLs;
  lists not-indexed pages, near-miss queries (position 5 to 20) and pages with impressions but no clicks.
- **IndexNow** (`indexnow.mjs`): sends up to 10 URLs per site per day to Bing, Yandex, Seznam and Naver.
- **Onboarding skill** (`skill/SKILL.md`): Claude walks a new user through setup step by step, starting by
  reading the site to learn what it is about.
- **Agent playbook** (`docs/agent-playbook.md`): propose, review, approve, publish. Nothing changes without a yes.

## What it cannot do (honest limits)
- **Google indexing cannot be automated.** The Indexing API is only for job and live-stream pages, and URL
  Inspection is read-only. Use your sitemap, internal links and the manual "Request indexing" button.
- IndexNow does not reach Google.
- It cannot guarantee rankings or indexing.

## Quick start
1. Fork or clone this repo.
2. Copy `skill/` to `.claude/skills/seo-autopilot/` in your project, open Claude Code and say
   "set up SEO for this site". It follows the steps in [`skill/SKILL.md`](skill/SKILL.md).
   Or do it by hand with [`docs/add-a-project.md`](docs/add-a-project.md).
3. Edit `sites.json` with your sites.
4. Copy `templates/seo-daily.yml` to `.github/workflows/seo-daily.yml`, add the secrets listed at the top of
   that file, and press "Run workflow".

Local run:
```bash
GOOGLE_KEY_FILE=/path/outside/repo/service-account.json node daily.mjs
INDEXNOW_KEY_EXAMPLE=<key> node indexnow.mjs --dry
```

## Security
Never commit key files. Use repo secrets (`GOOGLE_KEY_JSON`) or a path outside the repo. `reports/` and key
files are git-ignored. The IndexNow key is public by design (it is served from your site) but use a random one.

## Status
Early version. The GitHub Actions workflow is a template and has not been run on a live repo yet. Planned: a
sync to a database for a multi-site dashboard, GA4 data, and a packaged Claude Code plugin.

MIT licence.
