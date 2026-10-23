# Brief 12: Vertical packs (local, e-commerce, and more)

Owner request (2026-10-23): "local SEO, ecommerce etc to be a separate part or folder so when anyone connects their site they get their own specific agents specialized in."

## Why
- Every site gets all 38 agents installed today, whatever kind of business it is.
- The router can send work to only 2 vertical agents (`seo-local-agent` and `seo-ecommerce`). The five newer local agents (`seo-local-ai-visibility`, `-citation-auditor`, `-content-writer`, `-gbp-optimizer`, `-review-manager`) are never assigned work.
- The vertical agents are prompts with no data jobs behind them, so they work blind.

An agent is only as good as the data it is given.

## What to build
1. **Pack layout.** Use `departments/verticals/<pack>/`, with `agents/`, `knowledge/`, a `pack.json` (name, detection rules, jobs, agents), and a `README.md` charter. Start with `local` and `ecommerce`, then `saas`, `publisher`, and sub-packs such as `local/legal`, `local/medical` and `local/trades`.
2. **Detection, with an override.** The `profile` job turns packs on from its signals: LocalBusiness or Product markup; a Shopify, WooCommerce or Magento platform; an address on the site; cart or checkout URLs. A new config setting, `site.verticals: ["local"]`, can force a pack on or off. Keep the config schema in step.
3. **Install only what fits.** `init` and `upgrade` copy the core agents plus the agents of the packs that are on. `doctor` shows which packs are on and why.
4. **Routing.** `src/analysis/agent-router.mjs` routes to every agent of an active pack, from the pack's data jobs.
5. **Data jobs per pack.** Pure analysis goes in `src/analysis/`, jobs in `src/jobs/`, all tested.
   - **Local:**
     - consistency of name, address and phone across the site, the JSON-LD and the listings the user records;
     - a location-page audit: unique content, markup, maps and internal links;
     - Google Business Profile through the Business Profile APIs with the user's own Google access (categories, hours, posts, Q&A, review counts and replies);
     - local rank checks per city through the SERP provider's location parameter;
     - review velocity and response rate.
   - **E-commerce:**
     - coverage of Product and Offer markup (price, availability, reviews, GTIN);
     - a Merchant Center feed check (Content API, the user's own access);
     - crawl traps from faceted navigation and query parameters;
     - out-of-stock and discontinued page handling;
     - duplicate and thin category pages;
     - pagination.
6. **Generic content.** Packs must work for any business of their kind. The housing-disrepair details in `knowledge/local-legal-services-seo.md` and `knowledge/local-seo-ai-visibility.md` (from commit `54595d8`) become general `local/legal` guidance, or move to that client's own repository (CLAUDE.md: no site-specific content here). Owner decision first.
7. **Tests.** Detection on recorded real-site fixtures for each pack; tests that keep each pack's agents, playbooks, jobs and `pack.json` in step; install tests showing that a non-local site gets no local agents.

## Status
- Step 1 is done (Unreleased, D21): detection, the `verticals` setting, routing, install and `doctor`. Packs are defined in `departments/verticals/packs.json`; the agent files stay in `departments/verticals/agents/` (see D21).
- Steps 2 to 4 (data jobs) are next.

## Order
1. Pack layout, detection, install and routing. The existing agents start getting work. About one session.
2. Local data jobs that need no keys: the consistency check and the location-page audit.
3. E-commerce data jobs that need no keys: markup coverage and crawl traps.
4. Google Business Profile and Merchant Center, with the user's own access. These are tested with recorded responses first, and live before any claim that they work.

## Acceptance
- A Shopify test site gets the e-commerce pack and no local agents.
- A dentist's site gets the local pack.
- `team` routes work to every pack agent.
- `npm test` is green, and the docs and `CHANGELOG.md` are updated.
