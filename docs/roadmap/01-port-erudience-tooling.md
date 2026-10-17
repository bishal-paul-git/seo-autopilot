# 01 Port the Erudience tooling into the product

**Goal:** everything useful that was built for Erudience but lives only in `D:\ClaudeCode\erudience-flow-engine` becomes a generic, tested part of seo-autopilot, so any project gets it. Erudience then consumes the product versions instead of its own copies.

## Context
Erudience (Vite and React, prerendered, Hostinger/Apache) needed several tools that proved their worth in production. They are written for its content layout. The product must offer the same value for any site, using the site profile (`src/analysis/site-profile.mjs`) to adapt.

## What to port (read each source file first)
1. **Heading and meta audit** (`erudience-flow-engine/scripts/audit-headings.mjs`, `audit-meta.mjs`). Heading audit over rendered pages: exactly one H1, no skipped levels, generic or repeated H2 text, too few H2s, over-long H1, per-section averages. Meta audit: title and description length, primary keyword in title, H1 and description, duplicates across pages. Make these audit rules and an `audit --quality` view (or a `quality` job), running on the crawler's rendered HTML (`src/audit/`), not on a build folder. Add rules to `src/audit/rules.mjs` with why and fix text, and recipes to `knowledge/audit-fix-recipes.md` (a test enforces this).
2. **Redirect tooling** (`scripts/redirect-map.json`, `check-redirects.mjs`, `generate-htaccess.mjs`, `smoke-redirects.mjs`). A data file of old to new URLs, a build-time check (target exists, no chains, no loops, retired URLs listed), generators for Apache `.htaccess`, Netlify `_redirects`, Vercel `vercel.json` and nginx, and a post-deploy smoke test against the live site (301 targets, 410 for retired, real 404 for unknown). Offer as a `redirects` job and `seo-autopilot redirects check|generate|smoke`. The `seo-redirect-guardian` agent should call it.
3. **Facts guard** (`scripts/validate-content.mjs` plus `src/content/verified-facts.json`). Generic version: a `facts` job that scans content for numbers, prices, percentages, currency amounts and named-client patterns, and fails or warns unless each appears in a `verified-facts.json` (or has a source link). Configurable per site. The `seo-fact-checker` agent uses it first.
4. **Consent banner and gating recipe** (`src/lib/consent.ts`, `src/components/ConsentBanner.tsx`, changes in `ScriptInjector.tsx`). Write `knowledge/recipes/consent-banner.md` with framework-neutral logic and React, Astro and plain-JS examples; the `consent` job already verifies the result.
5. **Conversion tracking recipe** (`src/lib/track.ts`, `CtaTracker.tsx`): privacy-safe GA4 events (`generate_lead`, `tool_complete`, `view_calendar`, `cta_click`) with no personal data, plus how to mark key events in GA4. Recipe plus a `conversions` check that lists which events GA4 has received (Data API) and which are starred.
6. **Internal-link builder** (`src/content/related-guides.mjs` and the "Guides on this topic" blocks). A `links` job that proposes related-page links from the link graph the crawler already extracts, for low-inbound pages first; output is a reviewable list, never an automatic edit.
7. **Static-content guard** (`check-static-content.mjs`): the idea that prerendered text may only say what the real page says. Generalise as an `audit` rule that compares prerendered HTML with the hydrated page (needs a headless render; mark as optional).

## Steps
- For each item: pure function in `src/analysis/`, job in `src/jobs/`, registry entry, tests with fixtures from a small sample site, docs in `docs/jobs.md`, router rule in `src/analysis/agent-router.mjs` (which agent to call on a finding), weekly workflow step where sensible.
- Run each against Erudience (`state restore`, then the job) and compare with the tool it replaces. Fix false positives before release.
- When done, open a PR in the Erudience repo replacing its scripts with the product jobs where equivalent (keep Erudience-only scripts such as its sitemap and prerender).

## Done when
`npm test` green; each item has tests, docs and CHANGELOG entry; results on Erudience match its own scripts; new rules have recipes; version bumped and released.

## Not in scope
Erudience-specific content, sitemap and prerender generation; changing agents' rules.
