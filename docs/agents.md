# The agents

seo-autopilot works as a small team of six agents. Each is a Markdown file in [`agents/`](../agents) with a mission, required reading, a method, a quality bar, a list of things it must never do and a defined output. The same text is shown on the [agents page](https://bishal-paul-git.github.io/seo-autopilot/agents/).

| Agent | Job | Where it runs |
|---|---|---|
| strategist | ranked plan for the week from all the data | on request in Claude Code |
| researcher | topic research and the content brief | on request in Claude Code |
| drafter | writes one new page, queued, as a pull request | `seo-implement` workflow (issue labelled `seo-topic`) |
| refresher | updates one existing page in place | `seo-implement` workflow (issue labelled `seo-refresh`) |
| editor | reviews each draft and labels `seo-review-passed` | `seo-review` workflow (optional) |
| technical fixer | fixes audit findings in site code | by you, locally, supervised |

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
