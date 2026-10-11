# IndexNow

IndexNow tells Bing, Yandex, Seznam and Naver about new or changed URLs. **Google does not use IndexNow.** For Google, rely on your sitemap, internal links and the manual Request indexing button (the weekly `indexing-queue` issue lists what to request).

## Setup (once per site)

1. Choose a key: 8 to 128 characters, letters, digits and dashes. Random is best.
2. Put a plain-text file named `<key>.txt` at the root of your site (for a static site, in the public folder) containing only the key. Deploy.
3. Confirm `https://example.com/<key>.txt` returns the key.
4. Add the key as the repository secret `INDEXNOW_KEY` (the env var name is `indexNow.keyEnv` in the config).

The daily job then sends up to `indexNowPerDay` (default 10) URLs, oldest-submitted first, and remembers what it sent. It skips itself if the key file is not live.

`npx seo-autopilot run indexnow --dry` prints what it would send.
