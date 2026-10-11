# Audit fix recipes

What to actually do about each finding in the technical audit. Rule names match the audit report. Always fix the cause, not just the symptom, and re-run the audit after.

## Crawling and indexing
- **status-error:** a sitemap URL that errors. Restore the page, redirect it to its replacement with a single 301, or remove it from the sitemap. Never leave a 404 in the sitemap.
- **status-redirect / redirect-chain / link-to-redirect:** list the final URL in the sitemap and in internal links. Collapse chains so the old URL redirects straight to the destination in one hop.
- **noindex-in-sitemap:** decide. If the page should rank, remove `noindex`; if not, remove it from the sitemap.
- **robots-blocked / robots-blocks-all:** allow the path in robots.txt. A blocked page cannot have its content or `noindex` read. A site-wide `Disallow: /` is almost always a leftover staging rule.
- **sitemap-not-in-robots:** add a `Sitemap:` line with the absolute sitemap URL.
- **orphan:** add links from at least one hub page and two related pages, using descriptive anchor text. An orphan relies on the sitemap alone.
- **deep:** link important pages from the home page or a main hub so they are within three clicks.

## Canonicals and duplicates
- **canonical-missing:** add a self-referencing canonical with the absolute, final URL.
- **canonical-other:** confirm it is intentional. If this page should rank, point the canonical at itself.
- **canonical-broken:** the canonical target errors, redirects or is noindex. Point it at a live, indexable page.
- **title-duplicate / desc-duplicate / h1-duplicate / duplicate-content:** make each page distinct for its own query, or consolidate pages that serve the same intent and redirect the loser (cannibalisation playbook).

## On-page
- **title-missing / title-long / title-short:** one unique title per page, topic first, about 50 to 60 characters.
- **desc-missing / desc-long / desc-short:** a unique summary of what the reader gets, about 120 to 155 characters. Search engines may rewrite it.
- **h1-missing / h1-multiple:** one H1 stating the page topic.
- **thin-content:** if the page should rank, answer the query properly. If not (tools, legal, hubs), accept it, or add `noindex`, or merge it.
- **images-no-alt:** describe meaningful images in the `alt` text; use empty `alt=""` for decoration.
- **generic-anchor:** replace "click here" with words that say where the link goes.
- **broken-link:** fix the target or remove the link.

## Structured data and sharing
- **jsonld-invalid:** the block does not parse. Validate the JSON; common causes are trailing commas and unescaped quotes.
- **jsonld-article-incomplete:** add the missing `headline`, `datePublished`, `author` or `image` with real values matching the page.
- **schema-required-missing:** add the required properties for the type from Google's documentation, filled with real values visible on the page.
- **og-missing:** add `og:title`, `og:description` and an `og:image` at least 1200 pixels wide.

## International, technical hygiene
- **hreflang-invalid:** use ISO language codes with optional region (`en`, `en-GB`) or `x-default`.
- **hreflang-no-self:** each page lists itself in its hreflang set.
- **hreflang-not-reciprocal:** every alternate must list this page back.
- **viewport-missing:** add `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **lang-missing:** set `lang` on the `<html>` element.
- **mixed-content:** load every resource over HTTPS.
- **slow-ttfb:** measure from several locations before acting; fix with caching, a CDN or a faster origin. Audit timings are hints from one machine.

## Order of work
Fix anything that stops indexing first (status, robots, noindex, canonicals), then duplicates, then on-page, then polish. One change at a time on important pages, logged in the experiments file, so you can tell what worked.
