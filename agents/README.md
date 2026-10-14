# The agent team

seo-autopilot works as a team of eighteen specialists. Each agent has one job, a fixed set of tools, the playbooks it must read first, a quality bar it is held to and a defined hand-off. Together they follow one rule: **a human approves what goes live**.

### Plan and write
| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-strategist](seo-strategist.md) | Turns the data into a short, ranked plan: what to do this week and why | on request, weekly digest | no |
| [seo-researcher](seo-researcher.md) | Finds topics worth a page and writes the brief | on request, topic proposals | no |
| [seo-drafter](seo-drafter.md) | Writes one new page from a brief, queued | GitHub Actions on an approved `seo-topic` issue | content files only |
| [seo-refresher](seo-refresher.md) | Updates one existing page in place | GitHub Actions on an approved `seo-refresh` issue | content files only |
| [seo-snippet-optimizer](seo-snippet-optimizer.md) | Improves titles, descriptions and opening answers for pages with impressions but few clicks | on request | content files only, one page per task |

### Check and protect quality
| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-fact-checker](seo-fact-checker.md) | Verifies every claim, number and source in a page; blocks the unsupported | on request, before the editor | no |
| [seo-editor](seo-editor.md) | Reviews a draft as an editor and passes or blocks it | GitHub Actions on each `seo/*` pull request (optional) | no |
| [seo-cannibalization-resolver](seo-cannibalization-resolver.md) | Finds pages competing for one query and plans a merge, redirect or re-target | on request | no |
| [seo-content-pruner](seo-content-pruner.md) | Decides keep, refresh, merge, redirect or remove for thin and stale pages | on request, periodic review | no |

### Technical SEO
| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-technical-fixer](seo-technical-fixer.md) | Fixes audit findings in site templates and config | by you, locally in Claude Code | yes, with your supervision |
| [seo-schema-engineer](seo-schema-engineer.md) | Adds and validates structured data that matches the visible page | on request, audit findings | templates, on a branch |
| [seo-redirect-guardian](seo-redirect-guardian.md) | Keeps URL changes safe: redirect map, chains, loops, 404s | on request, after restructures | redirect config, on a branch |
| [seo-performance-fixer](seo-performance-fixer.md) | Turns speed and Core Web Vitals findings into code fixes | on request, from `speed.md` | templates and assets, on a branch |
| [seo-indexing-monitor](seo-indexing-monitor.md) | Tracks what is and is not indexed, diagnoses why, corrects the request-indexing list | on request, weekly | no |

### Authority, AI search, local and reporting
| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-link-builder](seo-link-builder.md) | Finds honest link opportunities and drafts outreach for you to send | on request | no |
| [seo-ai-search-agent](seo-ai-search-agent.md) | Tests how AI answers cite the site and fixes the gaps | on request | content files, only when asked |
| [seo-local-agent](seo-local-agent.md) | Business profile, listings consistency, local markup and location pages | on request | no |
| [seo-reporter](seo-reporter.md) | Writes the plain-English report and judges whether past changes worked | on request, weekly or monthly | no |

Only the first six run in the unattended GitHub workflows (the strategist and researcher also from the CLI). The rest are for you to run in Claude Code, where you see what they do before anything is merged.

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
