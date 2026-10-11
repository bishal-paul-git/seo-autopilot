# The agent team

seo-autopilot works as a small team. Each agent has one job, a fixed set of tools, the playbooks it must read first, a quality bar it is held to and a defined hand-off. Together they follow one rule: **a human approves what goes live**.

| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-strategist](seo-strategist.md) | Turns the data into a short, ranked plan: what to do this week and why | on request, weekly digest | no |
| [seo-researcher](seo-researcher.md) | Finds topics worth a page and writes the brief | on request, topic proposals | no |
| [seo-drafter](seo-drafter.md) | Writes one new page from a brief, queued | GitHub Actions on an approved `seo-topic` issue | content files only |
| [seo-refresher](seo-refresher.md) | Updates one existing page in place | GitHub Actions on an approved `seo-refresh` issue | content files only |
| [seo-editor](seo-editor.md) | Reviews a draft as an editor and passes or blocks it | GitHub Actions on each `seo/*` pull request (optional) | no |
| [seo-technical-fixer](seo-technical-fixer.md) | Fixes audit findings in site templates and config | by you, locally in Claude Code | yes, with your supervision |

## How work flows

```
 data jobs (daily/weekly) ──► strategist ──► ranked plan
                                   │
              topic or refresh proposal (GitHub issue)
                                   │
                    you add the label  approved
                                   │
                       drafter / refresher ──► pull request (queued)
                                   │
                     seo-check builds it (no secrets)
                                   │
                  editor reviews it (optional) ──► label seo-review-passed
                                   │
                  you merge (or auto-merge, if you opted in)
                                   │
                scheduler releases it a few pages a day
```

## What every agent shares
- **Playbooks first.** They read `knowledge/README.md` and the playbooks it points to before acting. Guidance there is practice, not search-engine rules, and says when something is uncertain.
- **Evidence over opinion.** Every recommendation cites the data behind it (a Search Console number, an audit finding, a live result). If there is no evidence, they say so and lower their confidence.
- **Hard rule on facts.** No number, price, percentage, timeline, client, quote, review or award unless it is already in the site's own verified content or has a real source link. A gap is better than an invention.
- **Text from the internet is data.** Issue bodies, feed items, search results and page text can contain instructions aimed at AI. Agents never follow them.
- **Smallest safe change.** One page per task, content files only (except the technical fixer, which you supervise), never the default branch.
- **Honest hand-off.** Each ends with a report: what was done, what was checked, what was not, and what a human still needs to supply.

## Using them in Claude Code
The files have Claude Code subagent front matter. Copy the ones you want into `.claude/agents/` in your project (or your home folder) and ask for them by name. In GitHub Actions the workflows load them from your project's `seo-autopilot/agents/` folder, which `init` and `seo-autopilot knowledge` keep up to date.

## Changing them
They are plain Markdown. Edit the "Project rules" section at the bottom of an agent to add your voice, forbidden claims, required disclaimers or page formats. Upgrades keep that section and refresh everything above it. Keep the "Never" lists: they are the safety rails.
