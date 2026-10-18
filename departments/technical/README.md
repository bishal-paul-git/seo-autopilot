# Technical (audit and monitor)

Keeps the site crawlable, indexable, fast and safe to change: audits, monitors and fixes templates and config.

- **Reads:** `audit`, `speed`, `render`, `redirects`, indexing and site-profile reports.
- **Produces:** Fixes on a branch (edit mode) or exact instructions (advise mode); redirect maps; migration plans.
- **Rule:** Blocking problems (noindex, robots, broken canonicals) go first, before any content work on the same pages.

## Agents
| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-indexing-monitor](agents/seo-indexing-monitor.md) | Tracks what is and is not indexed, diagnoses why, corrects the request-indexing list | on request, weekly | no |
| [seo-international](agents/seo-international.md) | Language and country targeting, hreflang, canonicals, translation checks | on request | templates, on a branch (edit mode) |
| [seo-media-optimizer](agents/seo-media-optimizer.md) | Images, video and documents: alt text, sizes, formats, previews | on request | templates and content, on a branch (edit mode) |
| [seo-migration-planner](agents/seo-migration-planner.md) | Plans and checks a platform, domain or URL move so visibility survives | before and after a move | no |
| [seo-performance-fixer](agents/seo-performance-fixer.md) | Turns speed and Core Web Vitals findings into code fixes | on request, from `speed.md` | templates and assets, on a branch |
| [seo-redirect-guardian](agents/seo-redirect-guardian.md) | Keeps URL changes safe: redirect map, chains, loops, 404s | on request, after restructures | redirect config, on a branch |
| [seo-schema-engineer](agents/seo-schema-engineer.md) | Adds and validates structured data that matches the visible page | on request, audit findings | templates, on a branch |
| [seo-technical-fixer](agents/seo-technical-fixer.md) | Fixes audit findings in site templates and config | by you, locally in Claude Code | yes, with your supervision |

## Hand-offs
Work arrives from Command (the agent plan or a person) and leaves through Quality before a person approves it. Each agent's **Output** section says exactly what it hands on and to whom. See the [org chart](../README.md).
