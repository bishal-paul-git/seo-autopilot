# Backlinks

Principles: few, relevant, free, honest. No mass submission, no paid links, no link swaps, no comment or forum spam. Links that were bought or traded for rankings can hurt a site, so this tool does not do them.

## What it does

| Job | What |
|---|---|
| `backlinks` | Fills free listing forms from your profile, **at most 5 attempts a day**, one **retry** the next day, then logs the target as `failed`. **Dry run by default.** |
| `backlinks-queue` | Weekly issue with up to 5 listings **for you to do by hand**, each with paste-ready text from your profile |
| `mentions` | Finds pages that name your brand but do not link to you, and drafts a polite request. **Nothing is sent for you.** |
| `mark` | Records a listing you finished by hand: `run mark <id> done [listing-url]` |

## Files you own (in `seo-autopilot/backlinks/`)

- `profile.json`: the only facts the submitter may enter. Every value must already be public on your site. No passwords.
- `targets.json`: the list of places. Each has `mode`: `auto` (the bot may try), `manual` (a person does it) or `skip` (not done, with the reason). The starter list is a research snapshot from October 2026 with `verifiedOn` dates: **re-check any target before relying on it.**
- `config.json`: `maxPerDay` (5), `maxAttempts` (2: first try plus one retry), `retryAfterDays` (1), `delaySeconds`.
- `mentions.json`: your brand terms and the feeds to watch (Google Alerts RSS or a Google News search).

## The rules the submitter will not break

It stops, logs the reason and marks the target `needs_human` (no retry) at: a CAPTCHA or "are you human" wording, a maths question, a password or account wall, a payment, a required field it has no true answer for, a reciprocal-link requirement, `robots.txt` disallowing the page, a search form instead of a listing form, or a form where fewer than two fields match your profile.

It never solves bot checks, never creates accounts, never pays, never ticks marketing opt-ins, never answers a question it cannot answer truthfully, and never touches a target that is not `auto`.

## Cloud browser

By default a headless Chromium runs on the GitHub runner. To use a cloud browser instead, add the repository secret `BROWSER_WS_ENDPOINT` (a `wss://` CDP endpoint from Browserless, Browserbase, Steel or similar). The workflow detects it. **Do not enable the vendor's CAPTCHA-solving option**: this tool is designed to stop at bot checks, and solving them would also break the site's rules.

## Turning on real submissions

Scheduled runs stay dry until you set the repository variable `BACKLINKS_LIVE` to `true`. For a one-off real run use **Actions > seo-backlinks > Run workflow > live**. Screenshots of every filled form are attached to each run for 14 days so you can check what it did.

## Honest expectations

When this was first tested, of 12 verified free directories only one needed no account, and a dry run found a CAPTCHA on it. Most worthwhile free listings need a person. That is why the by-hand checklist and the mentions finder exist: they take the research and typing off you but leave the human decision where it belongs. The bot is most useful when you add targets you have checked yourself: free, no account, no bot check.
