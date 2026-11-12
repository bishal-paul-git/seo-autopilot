# Knowledge review, November 2026 (leads, not yet verified)

Status: **leads only.** Phase 5 of `SYSTEM-READINESS-PLAN.md` (D49). Research on 2026-11-12 could not open the official documentation hosts from the build environment (Google Search Central and Help, the rater guidelines PDF, Bing, schema.org, Wikidata, IndexNow, OpenAI, Perplexity; the environment's network does not allow them, and the owner kept it that way). The candidate pages below were found by web search and their one-line descriptions come from search summaries, **not from reading the pages**. Nothing here goes into a playbook until the page has been opened and read. Lines marked (W) need the most care.

Done so far: `knowledge/ai-search-visibility.md` v2 (two sources actually opened: Anthropic's crawler documentation and the llms.txt proposal; every claim labelled documented / observed / hypothesis).

How to finish: open each candidate (from a machine or environment that can reach these hosts), confirm what it says, then add it to the playbook's `## Sources` in the checked format and set `Last reviewed`. `node scripts/knowledge-review.mjs` lists what is still undated.

## Lines that may be wrong or out of date (to confirm against the candidates)
| Playbook | Line | Lead | Candidate source |
|---|---|---|---|
| entity-and-reputation | "`sameAs` lists only profiles you control" | schema.org and Google describe sameAs as reference pages that identify the entity (Wikipedia, Wikidata, review profiles), not only owned profiles; suggested wording "only pages that unambiguously describe this entity" | schema.org/sameAs; Google Organization structured data |
| entity-and-reputation | "You cannot request [a knowledge panel]" | true that panels are automatic, but an existing panel can be claimed and edits suggested (W) | Knowledge Panel Help 9787176, 7534902 |
| indexing-and-crawl-diagnosis | "Discovered, currently not indexed: common on new or low-authority sites" | Google's stated usual cause is crawl scheduling to avoid overloading the site (W); "low authority" is interpretation | Search Console Help 7440203 |
| indexing-and-crawl-diagnosis | "Crawled, currently not indexed: usually a quality or duplication signal" | Google says it is common and not necessarily a problem (W); say that first | Search Console Help 7440203 |
| indexing-and-crawl-diagnosis | AI crawlers "each a business decision made in robots.txt" | user-triggered fetchers generally ignore robots.txt; Google-Extended is a token, not a crawler (W) | Google user-triggered fetchers; Google common crawlers |
| content-quality-and-eeat | spam policy list | a "back button hijacking" spam policy may have been added in April 2026 (W) | Google spam policies; Search Central blog 2026/04 |
| redirects-canonicals-migrations | "Changing domains or protocols" with the Change of Address tool | the tool is reportedly for domain or subdomain moves, not http→https or www changes (W) | Search Console Help 9370220 |
| redirects-canonicals-migrations | "Canonicals pointing at redirects … are ignored or harmful" | Google reportedly processes such canonicals; "weakens the signal" is safer (W) | Google consolidate duplicate URLs |
| seo-reporting | "Search Console data lags by a couple of days" | a 24-hour near-real-time view exists; newest days are preliminary (W) | Search Central blog 2024/12 |
| seo-reporting / entity | brand vs non-brand "in Search Console" by regex | a built-in branded queries filter is reported (AI-classified, not on small or sub-path properties); regex stays the fallback (W) | Search Central blog 2025/11 |
| seo-reporting | "Under roughly 1,000 impressions a month" | no primary source: label it as our rule of thumb | none |
| structured-data | "FAQ limited, HowTo removed" | may be incomplete if more features were retired since 2023 | Google structured data docs |

## Candidate sources by playbook (unverified)
- **ai-search-visibility** (still to verify): Google AI features in Search (developers.google.com/search/docs/appearance/ai-features); Google common crawlers incl. Google-Extended; OpenAI bots (platform.openai.com/docs/bots); Perplexity bots (docs.perplexity.ai/guides/bots); Bing/Copilot crawler controls.
- **refreshing-and-pruning-content**: Google helpful content; Google redirects and HTTP status codes; noindex; guidance on dates.
- **link-building-and-digital-pr**: Google spam policies (link spam); qualifying outbound links (sponsored, ugc, nofollow); disavow; Bing Webmaster Guidelines.
- **titles-descriptions-and-ctr**: Google "Influencing your title links"; Google snippets and meta descriptions.
- **structured-data**: Google intro and general structured-data guidelines; search gallery; schema.org type pages.
- **entity-and-reputation**: Google Organization structured data; schema.org/sameAs; Knowledge Panel Help 9787176 and 7534902; Wikidata:Notability; Google "Add business details".
- **indexing-and-crawl-diagnosis**: Search Console Help 7440203 (page indexing) and 9012289 (URL inspection); Google recrawl; sitemaps; verifying Google crawlers; user-triggered fetchers; IndexNow (Bing, indexnow.org).
- **content-quality-and-eeat**: Google helpful content; spam policies; rater guidelines PDF; generative AI content guidance; site reputation abuse post (2024/11).
- **redirects-canonicals-migrations**: Google redirects; site moves; Change of Address (9370220); canonicalisation; HTTP status codes; Bing Webmaster Guidelines.
- **seo-reporting**: Search Console data (96568); recent data (blog 2024/12); branded filter (blog 2025/11); Performance report help (17011259, 17010961).
- Not yet researched: search-intent-and-page-types, technical-seo-checklist, cannibalization-and-consolidation, topical-authority-and-internal-linking, local-seo and the other 14 playbooks.
