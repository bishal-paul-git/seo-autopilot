# Launch kit (Stage A: open-source launch)

Everything needed to launch seo-autopilot as an open-source product, in order. Brief 13 (`docs/roadmap/13-go-live.md`) explains the reasoning. Items marked **owner** need the owner's accounts or judgement.

## Before launch
| # | Item | Status |
|---|---|---|
| 1 | Release v2.17.0 (connector, packs groundwork, launch files) with Actions → tag-release | ready to run after merge |
| 2 | **Owner:** add the `NPM_TOKEN` secret (an npm automation token for the npm account that will own `seo-autopilot`), then re-run tag-release or run `npm publish` once. The name was free on 2026-10-23. | needs owner |
| 3 | **Owner:** publish the GitHub Action to the Marketplace: open the latest release, tick "Publish this Action to the GitHub Marketplace", and accept the terms. `action.yml` is at the root. | needs owner |
| 4 | **Owner:** Settings → General → turn on Discussions. Add labels `good first issue`, `waitlist`, `help wanted`. | needs owner |
| 5 | **Owner:** Settings → Pages: check that the landing site deploys (`pages` workflow), and add a custom domain if you have one. | needs owner |
| 6 | Deploy the hosted connector so "Connect in Claude" works (STATUS next actions) | waiting on Cloudflare and GitHub App steps |
| 7 | A real case study: Erudience after 4 to 6 weeks on 2.16+, real numbers only (`case-study-template.md`) | collecting data |
| 8 | Live provider check with real keys, recorded in STATUS (brief 03) | needs keys |
| 9 | A 2-minute demo video: install, first report, one approved change, ask Claude | **owner** records |

## Launch day
Post in this order, a day or two apart, and answer every comment the same day:
1. Show HN (`posts.md`, first draft).
2. r/SEO and r/bigseo, following each subreddit's self-promotion rules. Read them first.
3. r/ClaudeAI and the MCP server directories (the Claude plugin and the MCP server).
4. Product Hunt, once the demo video and case study exist.
5. Indie Hackers, plus the owner's own LinkedIn and X.

## After launch
- Triage issues weekly; label good first issues.
- Ship small releases often with tag-release.
- Turn waitlist issues into hosted-version interviews (Stage B).

Rules for every post: no invented numbers or testimonials, no ranking promises, and say plainly what is tested with recorded responses only.
