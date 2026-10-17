# 06 CMS connectors (WordPress first)

**Goal:** apply approved changes to sites with no repository, through each platform's official API, behind the same human-approval gate.

**Context:** the site profile sets advise mode for CMS and hosted builders (agents give instructions, a person applies them). Most sites are on WordPress or Shopify, so this limits adoption.

**Build (WordPress)**
1. `src/connectors/wordpress.mjs`: read pages and posts, titles and descriptions (Yoast, Rank Math, SEOPress fields), redirects (Redirection or SEO plugin APIs) via the REST API with an Application Password (a repo secret, never logged). Add a read adapter next to `markdown` and `json` in `src/adapters/`.
2. Writes limited to titles, meta descriptions, alt text, internal links in content, redirects and drafts. Everything is a draft or proposed change set; publishing stays human unless the owner enables it per change type.
3. Change sets: page id, field, old value, new value, reason, evidence. Approved by label or dashboard click; the connector applies, stores the old value, writes an audit entry. `seo-autopilot connectors rollback <id>`.
4. Safety: field allow-list, rate limits, dry-run by default, refuse bulk edits over a threshold, never touch plugin or theme files.
5. With a connector configured the profile mode becomes "edit through connector".
6. Later, one brief each: Shopify Admin API, Webflow CMS API; Wix and Squarespace stay advise.

**Verify:** mocked REST tests and a local WordPress in Docker for each write type and rollback; document the exact permissions needed.

**Done when:** read and approved writes work on a local WordPress, rollback tested, non-developer guide, release.
