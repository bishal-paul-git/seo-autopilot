# Indexing and crawl diagnosis

Use this when pages are missing from the search results, or Search Console says "Discovered, currently not indexed", "Crawled, currently not indexed" or similar. Guidance, not search-engine rules; Search Console's own explanations are the authority.

## First, find out what is true
For each page, answer in order:
1. Does it return 200 for a normal request, and is the content in the HTML a crawler receives (not only built by JavaScript after load)?
2. Is it blocked: `robots.txt`, a `noindex` meta tag or `X-Robots-Tag` header, or a login wall?
3. Does its canonical point to itself? A canonical to another URL tells search engines to index that one instead.
4. Is it in the sitemap, and does the sitemap list only canonical 200 URLs?
5. Is it linked from other pages (not only the sitemap)? Pages with no internal links are "orphans".
6. What does the URL Inspection tool say: last crawl date, user-declared and Google-selected canonical, and the rendered HTML.

## What the common statuses usually mean
- **Discovered, currently not indexed:** the URL is known but has not been crawled. Common on new or low-authority sites. Improve internal links, make sure the site is fast and not erroring, and be patient. Requesting indexing helps a little, in small numbers.
- **Crawled, currently not indexed:** it was fetched and judged not worth indexing yet. Usually a quality or duplication signal: thin content, near-duplicates, little that is not already available elsewhere. Improve the page or consolidate it; resubmitting unchanged pages rarely works.
- **Duplicate without user-selected canonical / Google chose different canonical:** the page is treated as a copy. Make the preferred version obvious with canonicals, redirects and internal links, or merge the pages.
- **Alternate page with proper canonical tag:** working as intended.
- **Soft 404:** the page returns 200 but looks like an error or empty. Return a real 404 or 410, or fill the page.
- **Blocked by robots.txt / excluded by noindex:** check it is deliberate.
- **Page with redirect:** normal for old URLs; make sure the sitemap and links point to the final URL.

## What helps indexing
- Clear internal links from relevant, already-indexed pages, with descriptive anchors.
- A clean sitemap with accurate `lastmod` dates (only change them when the page changed).
- Fast, stable responses; no long redirect chains.
- Content that adds something the rest of the web does not.
- IndexNow notifies some search engines about changes; Google does not use it. For Google, use the sitemap, internal links and, sparingly, the URL Inspection tool's "Request indexing" (a limited daily quota; do not spam it).
- Fewer, better pages. A site with hundreds of near-identical pages makes all of them look low value.

## How long to wait
New sites can take weeks to be crawled in full. Judge by pattern: if the same kinds of pages are never indexed after several weeks and several fixes, it is a quality or structure problem, not a delay.

## Reporting
For each unindexed page: URL, status in Search Console, what was verified, the most likely cause, the fix, and who does it. Group pages by cause so one fix covers many.

## Things to avoid
- Requesting indexing for hundreds of URLs, or for pages that are blocked or duplicate.
- Using the removals tool to "reset" pages.
- Blaming the search engine before checking the page's own signals.

## Reading your server logs
Access logs are the only first-hand record of what crawlers requested. Download a few weeks of them from your host or CDN into `seo-autopilot/logs/` (kept out of git: logs contain visitors' IP addresses) and run `seo-autopilot run logs --verify`.
- **Verify the crawler.** Anyone can claim to be Googlebot. Google and Bing document checking it by reverse DNS, then forward DNS back to the same address; `--verify` does this and leaves fakes out.
- **Know where the logs come from.** If a CDN or firewall sits in front of your server, it may answer or block crawlers before your origin sees them. Prefer the CDN's logs.
- **Find the waste.** Requests that hit errors, redirects or parameter variants are crawling not spent on real pages. Fix the links that lead there, not just the redirects.
- **Compare with the sitemap.** Pages never requested over several weeks usually have weak internal links or little value to Google. One short window proves little.
- **Know your AI crawlers.** There are three kinds: some fetch pages for AI search answers, some when a person asks an AI tool to read a page, and some to collect training data. Blocking a training crawler is a separate choice from appearing in AI answers, and each is a business decision made in robots.txt per crawler.
