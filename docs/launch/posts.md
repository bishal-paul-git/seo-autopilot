# Launch post drafts

Drafts to edit before posting. Fill each `<…>` only with real figures from the case study, or delete the line. Never post a number nobody measured.

## Show HN
**Title:** Show HN: seo-autopilot, an open-source SEO team that runs in your own GitHub

**Text:**
I built seo-autopilot because SEO tools mostly report problems and leave the work to you. This one also does the work, carefully.

It is a dependency-free Node CLI plus GitHub workflows. It runs in your website's repository with your own Google and AI keys, and nothing passes through me. Daily, weekly and monthly jobs:
- audit the site;
- read Search Console;
- track rankings;
- research keywords from your real queries;
- find competitor gaps;
- score pages against the top results;
- check Core Web Vitals and structured data;
- ask ChatGPT, Claude, Gemini and Perplexity whether they cite you.

38 agents (Claude) turn findings into pull requests. By default a person approves every change. With autopilot on, routine changes (titles, internal links, fixes) merge after every automated check passes, within pace limits, and a watcher reverts anything that hurts. Sensitive topics, site-wide indexing, deletions and outreach always wait for a person.

You can also use it from Claude or ChatGPT: there is an MCP server, and a hosted connector that reads your reports after a GitHub sign-in.

What it is not: it has no web-scale index of its own, so keyword volumes and backlink data need your own provider key (DataForSEO) and are labelled as estimates. Several provider integrations are tested with recorded responses only so far; the README says which.

<Case study line, only with real numbers, for example: "On erudience.com over N weeks: …">

MIT licensed. Repository: https://github.com/bishal-paul-git/seo-autopilot. Feedback welcome, especially from people who run sites on stacks I have not tested.

## Reddit (r/SEO, r/bigseo)
Check each subreddit's rules on self-promotion first. Lead with something useful, not the link:
- **Title:** I open-sourced the SEO workflow I use: Search Console data in, approved pull requests out
- **Body:** what it checks, how changes are approved, the honest limits (as in the Show HN post), and a question for the community, for example: "What would you never let an automated SEO tool change?"

## Product Hunt
- **Tagline:** An open-source SEO team that does the work, in your own GitHub
- **Description:** 38 agents, Search Console-first research, rank tracking, competitor gap, AI-search visibility, and changes as pull requests you approve or let autopilot merge within limits. Use it from Claude and ChatGPT.
- **First comment:** why it exists, what is free, what is coming (hosted version, waitlist link), and the honest limits.
- **Assets:** demo video, dashboard screenshot (the demo uses sample data and is labelled), and the agents page.

## One-paragraph description (directories, profiles)
seo-autopilot is an open-source (MIT) SEO team for any website. It runs in your own GitHub repository with your own Google and AI keys. It audits your site, tracks rankings from Search Console, researches keywords and competitor gaps, checks AI-search visibility, and drafts fixes and pages as pull requests. A person approves them, or routine ones merge on autopilot after every check passes. Use it from the command line, GitHub Actions, Claude Code, or Claude and ChatGPT through MCP.
