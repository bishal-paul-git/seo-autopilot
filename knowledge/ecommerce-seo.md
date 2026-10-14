# Ecommerce SEO

For sites that sell products. Guidance, not search-engine rules; check the search engine's and merchant programmes' own documentation for current requirements.

## Page types and intent
- **Category pages** target broad commercial queries ("running shoes"). They need a clear heading, a short helpful intro, working filters and real links to products and subcategories.
- **Product pages** target specific products and variants. They need a unique, useful description, specifications, honest price and availability, images, shipping and returns, and reviews if genuine.
- **Guides and comparisons** target research queries and feed the product and category pages with internal links.

## Product pages
- Write descriptions for people: what it is, who it suits, sizes and materials, how it differs from alternatives. Do not paste the manufacturer's text unchanged across many sites.
- One canonical URL per product. Variants (colour, size) either share one page with selectors or have their own pages when people search for them separately, with a canonical strategy that is consistent.
- Structured data: Product with name, image, description, brand, `offers` (price, currency, availability) and review ratings only when real and visible. Prices and availability in the markup must match the page.
- Out of stock: keep the page if the product will return; show alternatives. For discontinued products, redirect to the closest replacement or the category, or return 404/410 if nothing fits.

## Faceted navigation and parameters
Filters can create thousands of near-duplicate URLs. Decide which combinations have real search demand (for example colour plus type) and make those indexable pages with their own titles; keep the rest out of the index (canonical to the clean category, `noindex`, or not crawlable). Keep internal links to indexable versions only. Sort and session parameters should never be indexable.

## Internal linking and structure
Shallow structure: home to category to product within a few clicks. Breadcrumbs with `BreadcrumbList`. Link related products, accessories and guides. Avoid orphan products reachable only via search or filters.

## Reviews and trust
Genuine reviews are a ranking and conversion asset; fake or incentivised-without-disclosure reviews are against policy. Show delivery, returns and contact details clearly. Secure checkout, clear policies and real business details support trust.

## Merchant data
Product feeds and merchant programmes read the same facts: keep price, availability, identifiers and images in the feed identical to the page.

## Speed and media
Large product images are the usual speed problem: correct sizes, modern formats, dimensions set, lazy-load below the fold, a priority hint on the main image. See `media-and-image-seo.md`.

## Measure
Revenue and orders from organic search, not clicks alone; category and product page impressions in Search Console; crawl and index coverage of product URLs.
