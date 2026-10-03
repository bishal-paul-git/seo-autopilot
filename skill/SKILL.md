---
name: seo-pack-onboard
description: Sets up the SEO pack on a website repo step by step - reads the site to learn what it is about, registers it, connects Search Console and IndexNow, and enables the daily cloud run. Use when someone says "set up SEO for this site", "install the SEO pack" or "connect this repo to the SEO hub".
---

# SEO pack onboarding

Goal: take a website repo from nothing to a daily, cloud-run SEO loop that needs no computer left on.
Go one step at a time. After each step say what you did and what is next. Never print or commit secrets.

## Step 1 - Understand the site
Read the repo (framework, build command, where content and pages live, sitemap/robots, deploy method) and
the live homepage. Write `SEO.md` in the project root: what the business does, audience, main services,
primary keyword per key page, content paths, build and link-check commands, never-invent-claims rule, pages
not to touch. Show the file to the user and wait for corrections.

## Step 2 - Technical basics
Check: `/sitemap.xml` with full URLs, `robots.txt` pointing to it, unique title and description per page,
canonical tags, one H1 per page, no orphan pages. List problems; fix only what the user approves.

## Step 3 - Register the site
Add an entry to `sites.json` (id, name, url, searchConsoleProperty, sitemap, repoPath,
indexNowKeyEnv). Use `sc-domain:example.com` for Domain properties.

## Step 4 - Connect Google (user does the clicks, you give exact steps)
1. Create a Google Cloud service account and a JSON key (or reuse an existing one). Enable the Search Console API.
2. In Search Console, add the service-account email as a user on the property.
3. Store the JSON as the repo secret `GOOGLE_KEY_JSON`. Never commit it. Tell the user to delete local copies.
Verify by running `GOOGLE_KEY_FILE=<path> node daily.mjs <id>` once locally if they want a test.

## Step 5 - IndexNow
Generate a random key (letters and digits, 16 to 32 chars). Add `public/<key>.txt` containing only the key,
deploy, confirm the live URL returns it, then add repo secret `INDEXNOW_KEY_<SITE>`.
Say plainly: IndexNow reaches Bing, Yandex, Seznam and Naver, not Google. Google indexing is manual in
Search Console (about 10 requests a day) and the Indexing API must not be used for ordinary pages.

## Step 6 - Turn on the cloud schedule
Copy `templates/seo-daily.yml` to `.github/workflows/seo-daily.yml`, add the secrets, then run it once
with "Run workflow". Confirm the `seo-data` branch appears with reports.

## Step 7 - How decisions work
Each day `reports/<id>/daily-summary.md` lists near-miss queries, pages with no clicks and not-indexed pages.
Agents propose at most 3 changes (what, data, files, risk). The owner approves each. Only then edit the
site, build, check links, push, and verify the live page. One change set per day, reversible with `git revert`.

## Rules
- No invented clients, testimonials, statistics, prices or guarantees.
- Keys only in secrets or outside the repo. Never in chat output.
- Work only inside the repo the user pointed you at.
- Be honest about limits: nothing here can force Google to index a page.
