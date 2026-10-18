# 10 Page planner and funnels: from a goal to a keyword map and a page plan

**Goal:** given a business goal (for example "win enquiries from agencies who want a delivery partner"), produce an honest, SEO-focused page plan: keyword clusters, which page serves each, the conversion funnel, per-page specs and the facts the owner must supply. This is generic planning, useful to any business; a worked example of the output shape is below.

## Why
Planning a set of pages for a goal was done by hand during real work and took many steps: cluster the searches, map each to one page, design the path from a guide to an enquiry, write title, description, headings and CTAs per page, and list what must come from the owner so nothing is invented. That should be a repeatable product feature.

## Build
1. **Playbook** `knowledge/page-planning-and-conversion-funnels.md`: intent types, one primary keyword per page, hub and sub-page structure, funnel stages (awareness, consideration, decision, follow-up), CTA hierarchy (one primary, one secondary, soft links from guides), proof blocks (real work only), lead magnets, micro-conversions, internal linking rules, release pace for new pages, what to measure and when. Add to the playbook index and the agents.
2. **Agent** `agents/seo-page-planner.md` (read-only; same structure and tests as the others): reads the site profile, `insights.json` (real queries), existing pages (to avoid cannibalisation), conversion events (what already converts), and the owner's goal. Output: keyword map table, page list with specs (URL, primary and secondary keywords, intent, title, description, H1, H2 outline, CTAs, links in and out, schema), funnel diagram in text, facts needed from the owner, release order, measures. Router rule in `src/analysis/agent-router.mjs` when the config has `goals`.
3. **Job** `plan-pages` (`--goal "..."`): deterministic parts only. Cluster Search Console queries by shared terms, map them to existing pages, flag gaps and cannibalisation, check title and description lengths and keyword uniqueness for the proposed pages, write `page-plan.json` and `page-plan.md`. The agent does the reasoning on top.
4. **Keyword data without paid volume:** use the site's own queries first; make external keyword sources pluggable (Search Console, a SERP or keyword API when a key exists). When no volume data exists the plan must say so and mark priorities as judgement, to be validated after a few weeks of impressions.
5. **Facts gate:** every sentence type that needs a business fact (terms, prices, partners, results, certifications) becomes a "needs owner" item; the planner never fills it in. Reuse the `facts` job.
6. **Tracking plan:** suggest events per funnel step (CTA clicks, form starts, leads by source) and check with the `conversions` job that they exist.

## Output shape (worked example, neutral)
Goal: win enquiries from agencies. Clusters: partnership (core), white label, subcontract, referral, integration, choosing a supplier, how-it-works explainers. Pages: a hub, one page per partner type, six guides at the top of the funnel. Funnel: guide, then partner page, then an application form with the partner type preselected, with a call as the second option. Per page: primary keyword, title (under about 58 characters), description (120 to 155), H1, H2 outline, CTA, links, schema, owner facts needed. Release: hub and first sub-page together, guides every few days.

## Verify
Unit tests for clustering and keyword uniqueness on fixture queries; agent file passes `test/agents.test.mjs`; a fixture goal produces a plan with every "needs owner" item present and no invented facts; run on a real site in report-only mode.

## Done when
Playbook, agent, job, router rule, docs and tests are in; one real plan produced and reviewed by the owner; release.
