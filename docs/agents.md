# The agents

seo-autopilot works as a team of twenty-seven agents. Each is a Markdown file in [`agents/`](../agents) with a mission, required reading, a method, a quality bar, a list of things it must never do and a defined output. The same text is shown on the [agents page](https://bishal-paul-git.github.io/seo-autopilot/agents/).

| Agent | Job | Where it runs |
|---|---|---|
| strategist | ranked plan for the week from all the data | on request in Claude Code |
| researcher | topic research and the content brief | on request in Claude Code |
| drafter | writes one new page, queued, as a pull request | `seo-implement` workflow (issue labelled `seo-topic`) |
| refresher | updates one existing page in place | `seo-implement` workflow (issue labelled `seo-refresh`) |
| editor | reviews each draft and labels `seo-review-passed` | `seo-review` workflow (optional) |
| technical fixer | fixes audit findings in site code | by you, locally, supervised |
| fact-checker | verifies every claim and source in a page; blocks the unsupported | on request in Claude Code |
| snippet optimiser | better titles, descriptions and opening answers for pages with impressions but few clicks | on request, one page per task |
| cannibalisation resolver | plans a merge, redirect or re-target for pages competing for one query | on request |
| content pruner | keep, refresh, merge, redirect or remove for thin and stale pages | on request, periodic |
| schema engineer | structured data that matches the visible page | on request, on a branch |
| redirect guardian | redirect map, chains, loops, 404s after restructures | on request, on a branch |
| performance fixer | speed and Core Web Vitals fixes in code | on request, on a branch |
| indexing monitor | what is and is not indexed, why, and a corrected request list | on request, weekly |
| link builder | honest link opportunities and outreach drafts for you to send | on request |
| AI search agent | tests AI answers and fixes the citation gaps | on request |
| local agent | profile, listings, local markup, location pages | on request |
| reporter | plain-English report; judges whether past changes worked | on request, weekly or monthly |
| coordinator | reads the profile and the agent plan, calls the right specialist in order, checks results | on request, weekly |
| onboarder | profiles any platform, decides edit or advise mode, fills in Project rules | first, on any new site |
| competitor analyst | what the pages above you do better, and the gap you can honestly fill | on request |
| international | hreflang, canonicals and language targeting | on request, on a branch |
| ecommerce | category, product and filter pages, product markup | on request, on a branch |
| migration planner | plans a platform, domain or URL move | before and after a move |
| entity and reputation | consistent, trusted business entity; branded search; reviews | on request |
| media optimiser | images, video, documents | on request, on a branch |
| compliance auditor | spam-policy, sensitive-topic and disclosure risks | before a content push |

Only the first six run in the unattended GitHub workflows. The others are for you to run in Claude Code, where you see what they do before anything is merged.

## Any kind of website
Run `seo-autopilot run profile` once (and after a redesign). It detects the platform, how pages render and where content, redirects, robots and the sitemap live, and decides **edit mode** (the source is in this repository, agents change files on a branch) or **advise mode** (a hosted builder or CMS: agents give exact instructions for a person). Every agent reads `site-profile.json` first. Then `seo-autopilot run team` writes `agent-plan.md`: which agents to run, in order, with the finding behind each. See the playbook [Working on any kind of website](../knowledge/site-platforms.md).

## In GitHub Actions
`init` and `upgrade --apply` copy the agents into your project's data folder (`seo-autopilot/agents/` by default). The workflows tell Claude to read the relevant file first. The hard limits in the workflow (scoped file edits, no build commands, issue text treated as data) apply regardless of what an agent file says.

## Running agents yourself (Python runtime)
The strategist and researcher can also run unattended in the Python agent runtime, with read-only tools and no ability to change your site. See [engines.md](engines.md).

## In Claude Code
Copy any file from `agents/` into `.claude/agents/` (project) or `~/.claude/agents/` (all projects), then ask for it by name, for example "use seo-strategist to plan this week". They use standard subagent front matter (`name`, `description`, `tools`).

## Making them yours
Edit the **Project rules** section at the bottom of an agent: your voice, banned phrases, required disclaimers, formats, who approves what. Keep the **Never** lists. `upgrade --apply` refreshes the agents from the product but keeps your own **Project rules** section, so edit only that section and your changes survive upgrades.

## What they read
The agents read the SEO [playbooks](../knowledge/README.md) first, then the reports the jobs save (priorities, audit, search insights, AI search, speed, experiments, digest). They cite the data behind every recommendation and say when there is not enough of it.
