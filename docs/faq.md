# FAQ

**Does it publish pages without asking me?**
No. See [content-automation.md](content-automation.md): topic issue, your `approved` label, a pull request, your merge, then a dated release.

**Can it get me indexed in Google?**
It tells you exactly which pages need it and gives a one-click Search Console link for each, but pressing Request indexing is manual (about 10 a day). It reaches Bing and others through IndexNow.

**Will it improve my rankings?**
No tool can promise that. It makes the routine work (measuring, finding gaps, drafting, scheduling) consistent, and keeps you from publishing weak or unverified content.

**Do I need an AI key?**
No. Every job has a rule-based mode. An AI key improves news judging, adds flagged long-tail ideas and a short digest summary. Drafting pages uses Claude Code via your own Claude subscription token, not an API key.

**What does it cost?**
GitHub Actions minutes (free tier is enough for the daily jobs on a small site), plus optional AI and cloud-browser usage if you enable them. The Google APIs used are free at this volume.

**Is my data sent anywhere?**
Search data goes from Google to your GitHub runner and is saved in your own repository's `seo-data` branch. Optional AI calls send small snippets (query lists, news headlines) to the provider you choose. The dashboard is a local file. Nothing is sent to the tool's author.

**The backlink bot did nothing.**
That is usually correct: it only acts on targets you marked `auto` that are free, need no account and show no bot check, and stops at anything else. Use the weekly hand-done list. See [backlinks.md](backlinks.md).

**Can I use it on a site that is not a git repo / not static?**
Reports, research, news, digest, indexing list and dashboard only need the sitemap and Search Console, so yes (`content.type: "sitemap"`). Drafting and scheduling need your pages to live in files in a repo.

**My content is in a CMS.**
Use `sitemap` mode for everything read-only. Drafted pages arrive as pull requests, so they suit file-based content. A CMS adapter is a welcome contribution.

**It says "Search Console: User does not have sufficient permission".**
Add the service account's email as a user on the exact property named in `searchConsoleProperty`, with Full permission ([google-setup.md](google-setup.md)).
