# Images, video and media SEO

Media helps people understand a page, can bring traffic from image and video results, and is the most common cause of slow pages. Guidance, not search-engine rules.

## Images
- **Use real, relevant images** that add something: photos of the work, product, team or place; diagrams made for the page. Stock filler adds weight, not value.
- **Alt text** describes the image for someone who cannot see it, in a plain phrase, using the topic naturally when it fits. Decorative images get empty alt text (`alt=""`). Do not stuff keywords.
- **File names** that describe the content (`blue-ceramic-teapot.jpg`), not `IMG_0001.jpg`.
- **Size and format:** serve images no larger than they display, in modern formats (WebP or AVIF with a fallback if needed), compressed, with `width` and `height` set so the layout does not jump.
- **Loading:** lazy-load images below the fold; do not lazy-load the main (largest) image; give it a priority hint and preload if it is a CSS background.
- **Responsive images** with `srcset` and `sizes` where sizes vary a lot.
- **Indexing:** images must be crawlable (real `<img>` or `<picture>` elements, not only CSS backgrounds or scripts), on pages that are indexable. An image sitemap helps when images are loaded in unusual ways.
- **Captions and surrounding text** help search engines and readers understand the image. Put it near relevant text.

## Video
- Host where it makes sense: embedding a platform player is fine and simple; self-hosting needs good delivery.
- Give the page a descriptive title, heading and a transcript or summary so the content is searchable.
- Add `VideoObject` markup (name, description, thumbnail, upload date) that matches the page; a video sitemap can help discovery.
- Do not autoplay with sound or let the video hurt speed: lazy-load the player until the visitor interacts.

## Audio and documents
Provide transcripts for audio. For PDFs, make sure text is real text (not scanned images), give them clear titles and link to them from relevant pages. Prefer an HTML page for important content.

## Open Graph and previews
Set an `og:image` of a sensible size for each page type so shared links look right; check the preview in the places people share.

## Rights and accuracy
Only use media you have the right to use. Do not present images as something they are not (for example stock photos as your own team or work). Respect people's privacy and consent in photos and video.

## Measure
Image and video impressions in Search Console, largest-element timing in speed reports, and the share of images with alt text and set dimensions in the audit.
