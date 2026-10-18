# Content (on-page)

Writes, refreshes, merges and trims pages, and makes titles and openings earn the click.

- **Reads:** Approved topic and refresh issues, Search Console insights, `quality` and `links` reports.
- **Produces:** One page per pull request, queued for release.
- **Rule:** Every change passes Quality (fact-checker, then editor) before a person approves it.

## Agents
| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-cannibalization-resolver](agents/seo-cannibalization-resolver.md) | Finds pages competing for one query and plans a merge, redirect or re-target | on request | no |
| [seo-content-pruner](agents/seo-content-pruner.md) | Decides keep, refresh, merge, redirect or remove for thin and stale pages | on request, periodic review | no |
| [seo-drafter](agents/seo-drafter.md) | Writes one new page from a brief, queued | GitHub Actions on an approved `seo-topic` issue | content files only |
| [seo-internal-linker](agents/seo-internal-linker.md) | Owns internal links: orphan and buried pages, and related pages that should link to each other | on request, from `links.json` and the audit | content files only, one page per task |
| [seo-refresher](agents/seo-refresher.md) | Updates one existing page in place | GitHub Actions on an approved `seo-refresh` issue | content files only |
| [seo-snippet-optimizer](agents/seo-snippet-optimizer.md) | Improves titles, descriptions and opening answers for pages with impressions but few clicks | on request | content files only, one page per task |

## Hand-offs
Work arrives from Command (the agent plan or a person) and leaves through Quality before a person approves it. Each agent's **Output** section says exactly what it hands on and to whom. See the [org chart](../README.md).
