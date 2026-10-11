# Structured data

Structured data (usually JSON-LD using schema.org types) tells search engines explicitly what a page is. It can make pages eligible for rich results, and it helps machines understand entities. It does **not** improve rankings directly and does not guarantee a rich result.

## Rules
- Mark up only what is **visible on the page** and true. Misleading markup can lead to a manual action.
- Use the type that fits: `Organization`, `WebSite`, `Article`/`BlogPosting`, `BreadcrumbList`, `Product`, `SoftwareApplication`, `LocalBusiness`, `Person`, `FAQPage` (see below), and so on.
- Keep the markup in the **initial HTML**, not injected later, so every crawler sees it.
- Give entities stable `@id`s and link them (`publisher`, `author`, `isPartOf`) so they form one graph rather than disconnected fragments.
- Validate with Google's Rich Results Test and the Schema Markup Validator. The audit reports unparsable JSON-LD and incomplete `Article` markup.

## Types worth having on most sites
- **Organization** (name, URL, logo, `sameAs` links to real profiles, contact details that are public) on the home page.
- **WebSite** with the site name.
- **BreadcrumbList** on deep pages.
- **Article / BlogPosting** on editorial pages: `headline`, `datePublished`, `dateModified`, `author`, `image`, `publisher`.
- **Product / SoftwareApplication / Service** on commercial pages, only with details that appear on the page.

## Things that change
Google has narrowed or retired some rich results over time (for example FAQ rich results are now limited to a small set of sites, and HowTo rich results were removed). Markup can still be valid and harmless, but do not expect a visible reward. Check current Search Central documentation for what is supported before investing effort.

## Common mistakes
- JSON syntax errors (the whole block is ignored).
- Marking up content that is not on the page, or reviews that are not real.
- Several conflicting `Organization` or `Article` blocks on one page.
- Missing required or recommended properties for the chosen type.
