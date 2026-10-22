# The departments

seo-autopilot works as a team of thirty-three specialist agents grouped into eight departments, like a small agency: Command plans, Research finds, Technical, Content, Authority, AI search and Verticals do the work, and Quality checks it. Each agent has one job, a fixed set of tools, the playbooks it must read first, a quality bar and a defined hand-off. One rule holds for all of them: **nothing goes live unchecked**. Routine changes publish on autopilot once every automated check passes (and are watched and reverted if they make things worse); sensitive topics, site-wide indexing changes, migrations, deletions and outreach always wait for a person (decision D17, `seo-autopilot run autopilot`).

Each department folder has a charter (`README.md`) and its agents (`agents/`). Installed projects get the agents in one flat folder (`seo-autopilot/agents/`) so workflows can find any agent by name; each file's front matter still names its department. The design and roadmap are in [docs/architecture/DEPARTMENTS.md](../docs/architecture/DEPARTMENTS.md).

## [Command](command/README.md)
Plans, sequences and reports. Decides what the team works on this week and whether past work helped.

| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-coordinator](command/agents/seo-coordinator.md) | Reads the site profile and the agent plan, calls the right specialist in the right order, checks what comes back | on request, weekly | no |
| [seo-onboarder](command/agents/seo-onboarder.md) | Profiles the platform, decides edit or advise mode, confirms the business facts, fills in Project rules | first, on any new site | config and Project rules only |
| [seo-reporter](command/agents/seo-reporter.md) | Writes the plain-English report and judges whether past changes worked | on request, weekly or monthly | no |
| [seo-strategist](command/agents/seo-strategist.md) | Turns the data into a short, ranked plan: what to do this week and why | on request, weekly digest | no |

## [Research and intelligence](research/README.md)
Finds what is worth doing: topics, questions, competitors and gaps, from real data.

| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-competitor-analyst](research/agents/seo-competitor-analyst.md) | Studies who ranks above you and finds gaps you can fill with real material | on request | no |
| [seo-researcher](research/agents/seo-researcher.md) | Finds topics worth a page and writes the brief | on request, topic proposals | no |
| [seo-serp-analyst](research/agents/seo-serp-analyst.md) | Tracks positions, search features and share of voice on the queries that matter | on request, weekly or monthly | no |
| [seo-topic-mapper](research/agents/seo-topic-mapper.md) | Maps every topic to one owner page: clusters, intent, potential, gaps and overlaps | on request, before a content plan | no |

## [Technical (audit and monitor)](technical/README.md)
Keeps the site crawlable, indexable, fast and safe to change: audits, monitors and fixes templates and config.

| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-indexing-monitor](technical/agents/seo-indexing-monitor.md) | Tracks what is and is not indexed, diagnoses why, corrects the request-indexing list | on request, weekly | no |
| [seo-international](technical/agents/seo-international.md) | Language and country targeting, hreflang, canonicals, translation checks | on request | templates, on a branch (edit mode) |
| [seo-log-analyst](technical/agents/seo-log-analyst.md) | Reads what Googlebot and AI crawlers really requested in your access logs: crawl waste, sitemap pages not crawled, fakes | on request, from `logs.json` | no |
| [seo-media-optimizer](technical/agents/seo-media-optimizer.md) | Images, video and documents: alt text, sizes, formats, previews | on request | templates and content, on a branch (edit mode) |
| [seo-migration-planner](technical/agents/seo-migration-planner.md) | Plans and checks a platform, domain or URL move so visibility survives | before and after a move | no |
| [seo-performance-fixer](technical/agents/seo-performance-fixer.md) | Turns speed and Core Web Vitals findings into code fixes | on request, from `speed.md` | templates and assets, on a branch |
| [seo-redirect-guardian](technical/agents/seo-redirect-guardian.md) | Keeps URL changes safe: redirect map, chains, loops, 404s | on request, after restructures | redirect config, on a branch |
| [seo-schema-engineer](technical/agents/seo-schema-engineer.md) | Adds and validates structured data that matches the visible page | on request, audit findings | templates, on a branch |
| [seo-technical-fixer](technical/agents/seo-technical-fixer.md) | Fixes audit findings in site templates and config | by you, locally in Claude Code | yes, with your supervision |

## [Content (on-page)](content/README.md)
Writes, refreshes, merges and trims pages, and makes titles and openings earn the click.

| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-cannibalization-resolver](content/agents/seo-cannibalization-resolver.md) | Finds pages competing for one query and plans a merge, redirect or re-target | on request | no |
| [seo-content-pruner](content/agents/seo-content-pruner.md) | Decides keep, refresh, merge, redirect or remove for thin and stale pages | on request, periodic review | no |
| [seo-drafter](content/agents/seo-drafter.md) | Writes one new page from a brief, queued | GitHub Actions on an approved `seo-topic` issue | content files only |
| [seo-internal-linker](content/agents/seo-internal-linker.md) | Owns internal links: orphan and buried pages, and related pages that should link to each other | on request, from `links.json` and the audit | content files only, one page per task |
| [seo-refresher](content/agents/seo-refresher.md) | Updates one existing page in place | GitHub Actions on an approved `seo-refresh` issue | content files only |
| [seo-snippet-optimizer](content/agents/seo-snippet-optimizer.md) | Improves titles, descriptions and opening answers for pages with impressions but few clicks | on request | content files only, one page per task |

## [Authority (off-page and backlinks)](authority/README.md)
Earns links and mentions honestly and makes the business a clear, trusted entity.

| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-backlink-auditor](authority/agents/seo-backlink-auditor.md) | Audits inbound links from a Search Console or tool export: links to reclaim, new and lost sites, patterns to review | on request, from `inbound.json` | no |
| [seo-entity-reputation](authority/agents/seo-entity-reputation.md) | Makes the business a clear, consistent, trusted entity; branded search and reviews | on request | no |
| [seo-link-builder](authority/agents/seo-link-builder.md) | Finds honest link opportunities and drafts outreach for you to send | on request | no |

## [AI search (AEO, GEO, AI Overviews)](ai-search/README.md)
Measures how answer engines and AI search cite the site, and closes the gaps through the other departments.

| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-ai-search-agent](ai-search/agents/seo-ai-search-agent.md) | Tests how AI answers cite the site and fixes the gaps | on request | content files, only when asked |
| [seo-ai-visibility-tracker](ai-search/agents/seo-ai-visibility-tracker.md) | Measures mentions and citations in AI answers over a fixed question set, run after run | on request, monthly | no |

## [Verticals (local, e-commerce)](verticals/README.md)
Specialist rules for local businesses and online shops.

| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-ecommerce](verticals/agents/seo-ecommerce.md) | Category, product and faceted-navigation pages, product markup, stock handling | on request | templates, on a branch (edit mode) |
| [seo-local-agent](verticals/agents/seo-local-agent.md) | Business profile, listings consistency, local markup and location pages | on request | no |

## [Quality (validators)](quality/README.md)
Nothing reaches a person for approval until it passes here: facts, policy and editorial checks.

| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-compliance-auditor](quality/agents/seo-compliance-auditor.md) | Spam-policy, sensitive-topic and disclosure risks, before they cost you | before a content push, after a drop | no |
| [seo-editor](quality/agents/seo-editor.md) | Reviews a draft as an editor and passes or blocks it | GitHub Actions on each `seo/*` pull request (optional) | no |
| [seo-fact-checker](quality/agents/seo-fact-checker.md) | Verifies every claim, number and source in a page; blocks the unsupported | on request, before the editor | no |

## Shared skills
A skill is a procedure several agents follow, kept in one place so they all do it the same way. Agents name the skills they use in "Read first"; installed projects get them in `seo-autopilot/skills/`.

| Skill | What it covers | Used by |
|---|---|---|
| [ai-answer-testing](skills/ai-answer-testing/SKILL.md) | Fair tests of AI answers: a fixed question set, names and aliases to detect, repeated runs, who is cited and whether it is true | ai-visibility-tracker, ai-search-agent |
| [answer-first-copy](skills/answer-first-copy/SKILL.md) | Openings that answer the question in about 25 to 60 words, then the detail; checkable, sourced, written for people | drafter, refresher, snippet-optimizer, ai-search-agent, editor |
| [digital-pr](skills/digital-pr/SKILL.md) | Earning coverage with first-hand data, expert comment, timely angles and reclaimed mentions; small, honest campaigns | link-builder, entity-reputation |
| [broken-link-reclamation](skills/broken-link-reclamation/SKILL.md) | Recovering links to dead pages: own broken inbound links first (redirect or restore), then other sites' dead pages, outreach drafted only | link-builder, backlink-auditor, redirect-guardian |
| [question-mining](skills/question-mining/SKILL.md) | Real questions from Search Console, customers, People Also Ask, suggestions and forums, deduplicated and evidenced | researcher, ai-search-agent, topic-mapper, ai-visibility-tracker |
| [search-intent-labelling](skills/search-intent-labelling/SKILL.md) | Consistent intent labels from the query words, confirmed by the live results, and the page type each needs | researcher, topic-mapper, serp-analyst |
| [traffic-potential](skills/traffic-potential/SKILL.md) | What a topic is worth: the whole cluster, own Search Console data first, provider estimates labelled, ranges and confidence | topic-mapper, serp-analyst, strategist |

Only the first six run in the unattended GitHub workflows (the strategist and researcher also from the CLI). The rest are for you to run in Claude Code, where you see what they do before anything is merged.

## Works on any website
The agents do not assume a stack. Run `seo-autopilot run profile` first: it detects the platform (WordPress, Shopify, Wix, Squarespace, Webflow, Next.js, Astro, Hugo, a single-page app, plain HTML and more), how the pages render, where content, redirects, robots and sitemaps live, and whether agents may edit files. The result, `site-profile.json`, is the first thing every agent reads.

- **Edit mode:** the site's source is in the repository, so agents may change files on a branch, one change at a time, and a person merges.
- **Advise mode:** the site is a hosted builder or CMS, or the source is not available. Agents analyse and give exact instructions; a person applies them.

Then run `seo-autopilot run team`. It reads the audit, priorities, indexing, speed and AI search reports and writes `agent-plan.md`: which agents to run, in order, with a ready-to-paste instruction for each and the finding that caused it. Blockers to crawling and indexing always come before content work. The [seo-coordinator](command/agents/seo-coordinator.md) can follow that plan for you and brief each specialist.

For several sites, list them all in one `seo-autopilot.config.json` and use `--site <id>`; each site gets its own profile, plan and Project rules.

The weekly workflow also runs four checks that the agents use: `consent`, `ymyl`, `pace` and `citations` (see [docs/measurement-and-compliance.md](../docs/measurement-and-compliance.md)). `team` sends consent and sensitive-topic findings to the compliance auditor, pace bursts to the strategist and low citation share to the AI search agent.

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
