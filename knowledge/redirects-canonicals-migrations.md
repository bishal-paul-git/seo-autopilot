# Redirects, canonicals and migrations

Changing URLs is one of the easiest ways to lose search visibility, and one of the most preventable.

## Redirects
- **301 / 308 (permanent)** when a page has moved for good. **302 / 307 (temporary)** only when it really is temporary.
- Redirect each old URL to its **closest equivalent**, one hop, not to the home page and not through a chain.
- Keep redirects in place for a long time (a year or more is a common minimum) because links and bookmarks keep arriving.
- Update internal links, the sitemap and canonical tags to the new URLs. Redirects are for outside links; your own links should be direct.

## Canonicals
- Tell search engines the preferred URL when the same content is reachable at several. It is a hint: keep it consistent with redirects, internal links and the sitemap.
- A page's canonical should be a live, indexable, 200 URL. Canonicals pointing at redirects, errors or noindex pages are ignored or harmful.
- Do not canonicalise paginated or genuinely different pages to one page unless you want the others dropped.

## Migrating a site or section
1. **Inventory** every URL (sitemap, analytics, Search Console, the crawl) before changing anything.
2. **Map** old to new, one by one. Decide what to merge or retire deliberately.
3. **Implement** redirects, new canonicals and a new sitemap, and keep the content and metadata the same unless you intend to change them. Change one big thing at a time.
4. **Test** on a staging copy: every old URL should reach its mapped new URL in one hop with a 200.
5. **Launch** and immediately re-check: redirects, robots.txt, noindex tags (a staging noindex left on production is a classic disaster), sitemap, Search Console for the new property.
6. **Monitor** crawl errors, indexing and traffic for weeks. A temporary dip is normal; a lasting one means something is wrong.

## Changing domains or protocols
Use the Change of Address tool in Search Console for a domain move, keep both properties verified, and keep the old domain redirecting for the long term.

## Things people forget
- Trailing-slash and uppercase/lowercase variants.
- Hreflang and canonical tags that still point at old URLs.
- Images and PDFs that were indexed.
- Links inside emails, social profiles and directories you control: update them.
