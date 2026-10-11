# Technical SEO checklist

Technical SEO makes sure pages can be found, read and indexed. It rarely wins rankings by itself, but it can quietly stop everything else from working. The audit job checks most of this.

## Crawling
- `robots.txt` should not block pages you want indexed or the CSS and JavaScript needed to render them. Note that robots.txt controls **crawling**, not indexing: a blocked URL can still appear in results without a description, and a `noindex` tag on a blocked page is never seen.
- List your sitemap in robots.txt. The sitemap should contain only **canonical, indexable, 200** URLs.
- Keep important pages within about three clicks of the home page and linked from at least a couple of related pages. Pages with no internal links (orphans) are hard to discover and look unimportant.

## Indexing
- Use `noindex` (meta robots or X-Robots-Tag) to keep a page out of results; allow it to be crawled so the tag is seen.
- A canonical tag is a **hint**, not a command. Make it consistent with redirects, internal links and the sitemap, or it may be ignored.
- Every indexable page should have a self-referencing canonical with the absolute, preferred URL.
- Avoid several URLs showing the same content (parameters, trailing slashes, www vs non-www, http vs https). Redirect to one version.

## Status codes and redirects
- Deleted pages should return 404 or 410. Moved pages: a single 301 to the best equivalent. Avoid chains and loops.
- Do not redirect many unrelated old URLs to the home page: search engines may treat that as a soft 404.
- Fix internal links to point straight at the final URL.

## Rendering
- Search engines read the **HTML your server sends** first. Google renders JavaScript later and not always completely, and many other crawlers (including AI crawlers) do not run JavaScript at all. Put the main content, headings, links and metadata in the initial HTML (server-side or static rendering).
- Test with "view source", not just the browser's inspector.

## Mobile and speed
- Google uses the mobile version of a page for indexing. Use a responsive layout and a viewport tag.
- Core Web Vitals (loading, responsiveness, layout stability) matter at the margins and for users; measure with real-user data where you can. A single lab or server timing is only a hint.
- HTTPS everywhere, no mixed content.

## Hygiene
- One H1 per page that matches the topic; logical heading order.
- Descriptive alt text for meaningful images.
- Valid structured data (see Structured data).
- Correct `lang` attribute; `hreflang` only if you really have language or region variants, with reciprocal tags.
