# International and multilingual SEO

For sites that serve more than one language or country. Guidance, not search-engine rules; Google's documentation on localised versions is the authority.

## First decide whether you need separate versions
Separate versions help when the language differs, or when the offer, price, currency, law or shipping differs by country. A translated copy of the same page for the same market adds little. If you serve a market with one version, do not create regional clones.

## URL structure
Country-code domains (strongest country signal, most work), subdirectories (`/fr/`, `/uk/`; simplest to maintain and pool authority), or subdomains. Pick one and keep it consistent. Do not use cookies, IP-based redirects or `Accept-Language` alone to switch the version crawlers see; give each version its own URL.

## hreflang
Annotations that tell search engines which version suits which user. Rules that matter:
- Each version lists **itself and all alternates** (return links must exist both ways).
- Codes are language (`en`, `fr`) optionally with region (`en-GB`, `fr-CA`). Region alone is not valid; the language comes first.
- Add `x-default` for the fallback or language picker page.
- Use full absolute URLs, and the same URLs as the canonicals and sitemap.
- Every alternate must be a live, indexable 200 page. Annotations pointing at redirects or noindex pages are ignored.
- Implement in one place (HTML head, HTTP headers or the sitemap), not several that can disagree.

## Canonicals
Each language version canonicalises to itself, not to the primary-language page. Canonicalising translations to the original tells search engines to drop them.

## Content quality
Translate with a real human check for the audience, not literally: terminology, units, currency, dates, legal wording and examples differ. Machine translation published untouched at scale is a quality risk. Translate the title, description, headings, alt text, structured data and URLs, not only the body.

## Targeting and measurement
Add `inLanguage` to structured data, set the page `lang` attribute, and set up separate Search Console properties or filters per version. Judge each market on its own queries; rankings and click-through differ by country.

## Common faults
Missing return links, wrong codes (`en-UK`), hreflang pointing to redirects, a language picker that uses JavaScript only, automatic redirects by location, duplicate content between `en-US` and `en-GB` without any regional difference, mixed-language pages.
