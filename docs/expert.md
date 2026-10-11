# The expert layer

The basic jobs report what happened. The expert layer works out what to do about it.

| Job | What it does | Honest limits |
|---|---|---|
| `audit` | Crawls your live site (same host only, polite rate) and applies rules for titles, descriptions, canonicals, redirects, broken links, duplicates, structured data, hreflang, orphan and thin pages. Each finding carries "why it matters" and "how to fix". | It reads server HTML. Pages that only render content with JavaScript are judged on what the server sends, which is also what many crawlers see. |
| `analyze` | From your Search Console rows: striking-distance queries (positions 4 to 20), pages that under-perform the click-through curve learned from your own site, queries where several of your pages compete, decaying pages, intent and brand split, topic clusters and gaps. | Estimates are labelled estimates. Small sites give noisy curves and the confidence column says so. |
| `geo` | AI search readiness (GEO/AEO): which AI crawlers robots.txt lets in, llms.txt, whether sampled pages open with a direct answer, serve text in the initial HTML, and carry entity and trust signals. | Nobody outside the AI companies can see how sources are chosen. These are practices that tend to help, and every finding says so. |
| `speed` | Core Web Vitals for the home page and your top pages through Google's public PageSpeed Insights API. | Lab data is one test and varies; real-user data exists only for pages with enough traffic. |
| `priorities` | Scores every item as impact x confidence / effort and ranks them. Opens one weekly issue with the top ten. | Scores rank work, they do not predict rankings. |
| `experiments` | `run experiments add <url> "<change>"` logs a change; the report compares the 14 days after (starting day 3) with the 14 days before. | No control group, so results are directional only. Seasonality and other changes can explain a move. |
| `knowledge` | Copies 12 playbooks into your project (technical checklist, titles and CTR, search intent, topical authority and internal linking, cannibalization, refreshing and pruning, structured data, content quality and E-E-A-T, redirects and migrations, AI search visibility, measuring and experiments, plus an index). | Guidance, not guarantees. |

## Using it

```bash
npx github:bishal-paul-git/seo-autopilot#v2 run audit
npx github:bishal-paul-git/seo-autopilot#v2 run analyze      # needs a prior `run daily`
npx github:bishal-paul-git/seo-autopilot#v2 run priorities --dry
```

In GitHub Actions the daily workflow runs the three above and the weekly workflow opens the priorities issue and evaluates experiments. In the local app they are the Priorities, Technical audit and Search insights tabs.
