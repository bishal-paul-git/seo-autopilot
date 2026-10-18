# 01 Port proven site tooling into the product

**Goal:** everything useful that was built for one production site but lives only in that site's repository becomes a generic, tested part of seo-autopilot, so any project gets it. The site then consumes the product versions instead of its own copies. (Source paths for the maintainers' reference site are in that site's own repository, not here.)

## Context
The maintainers' reference site (a prerendered React site on Apache hosting) needed several tools that proved their worth in production. They are written for its content layout. The product must offer the same value for any site, using the site profile (`src/analysis/site-profile.mjs`) to adapt.

## What to port (read each source file first)
1. **Heading and meta audit** (a heading audit and a meta audit script). Heading audit over rendered pages: exactly one H1, no skipped levels, generic or repeated H2 text, too few H2s, over-long H1, per-section averages. Meta audit: title and description length, primary keyword in title, H1 and description, duplicates across pages. Make these audit rules and an `audit --quality` view (or a `quality` job), running on the crawler's rendered HTML (`src/audit/`), not on a build folder. Add rules to `src/audit/rules.mjs` with why and fix text, and recipes to `knowledge/audit-fix-recipes.md` (a test enforces this).
2. **Redirect tooling** (a redirect map file, a build-time check, a server-config generator and a post-deploy smoke test). A data file of old to new URLs, a build-time check (target exists, no chains, no loops, retired URLs listed), generators for Apache `.htaccess`, Netlify `_redirects`, Vercel `vercel.json` and nginx, and a post-deploy smoke test against the live site (301 targets, 410 for retired, real 404 for unknown). Offer as a `redirects` job and `seo-autopilot redirects check|generate|smoke`. The `seo-redirect-guardian` agent should call it.
3. **Facts guard** (a content validator plus a verified-facts file). Generic version: a `facts` job that scans content for numbers, prices, percentages, currency amounts and named-client patterns, and fails or warns unless each appears in a `verified-facts.json` (or has a source link). Configurable per site. The `seo-fact-checker` agent uses it first.
4. **Consent banner and gating recipe** (a consent module, a banner component and a gated script loader). Write `knowledge/recipes/consent-banner.md` with framework-neutral logic and React, Astro and plain-JS examples; the `consent` job already verifies the result.
5. **Conversion tracking recipe** (a tracking module and a delegated click tracker): privacy-safe GA4 events (`generate_lead`, `tool_complete`, `view_calendar`, `cta_click`) with no personal data, plus how to mark key events in GA4. Recipe plus a `conversions` check that lists which events GA4 has received (Data API) and which are starred.
6. **Internal-link builder** (related-guides blocks that link pages back to the guides about them). A `links` job that proposes related-page links from the link graph the crawler already extracts, for low-inbound pages first; output is a reviewable list, never an automatic edit.
7. **Static-content guard** (a static-content guard): the idea that prerendered text may only say what the real page says. Generalise as an `audit` rule that compares prerendered HTML with the hydrated page (needs a headless render; mark as optional).

## Steps
- For each item: pure function in `src/analysis/`, job in `src/jobs/`, registry entry, tests with fixtures from a small sample site, docs in `docs/jobs.md`, router rule in `src/analysis/agent-router.mjs` (which agent to call on a finding), weekly workflow step where sensible.
- Run each against a real site (`state restore`, then the job) and compare with the tool it replaces. Fix false positives before release.
- When done, open a PR in the reference site's repository replacing its scripts with the product jobs where equivalent (keep the site's own sitemap and prerender scripts).

## Done when
`npm test` green; each item has tests, docs and CHANGELOG entry; results on the reference site match its own scripts; new rules have recipes; version bumped and released.

## Not in scope
Site-specific content, sitemap and prerender generation; changing agents' rules.
