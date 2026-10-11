<!-- Editors can validate and autocomplete the config with schema/seo-autopilot.config.schema.json: add "$schema": "https://raw.githubusercontent.com/bishal-paul-git/seo-autopilot/main/schema/seo-autopilot.config.schema.json" to the file. -->
# Configuration reference

One file, `seo-autopilot.config.json`, in the root of your repository. Paths are relative to it.

```json
{
  "stateDir": ".seo-autopilot",
  "dataDir": "seo-autopilot",
  "stateBranch": "seo-data",
  "sites": [
    {
      "id": "example",
      "name": "Example",
      "url": "https://example.com/",
      "searchConsoleProperty": "https://example.com/",
      "sitemap": "https://example.com/sitemap.xml",
      "indexNow": { "keyEnv": "INDEXNOW_KEY" },
      "inspectPerDay": 60,
      "indexNowPerDay": 10,
      "ga4PropertyId": null,
      "ignoreQueries": ["example"],
      "brandTerms": ["Example"],
      "content": { "type": "sitemap" },
      "schedule": { "perDay": 3 },
      "release": { "deployHookEnv": "DEPLOY_HOOK_URL" },
      "labels": { "proposal": "seo-proposal", "topic": "seo-topic", "approved": "approved", "digest": "seo-digest", "backlink": "seo-backlink", "indexing": "seo-indexing" },
      "limits": { "proposalsPerRun": 3, "topicsPerWeek": 2, "newsTopicsPerRun": 1 },
      "ingest": { "urlEnv": "SEO_INGEST_URL", "tokenEnv": "SEO_INGEST_TOKEN" }
    }
  ]
}
```

## Top level

| Key | Default | Meaning |
|---|---|---|
| `stateDir` | `.seo-autopilot` | where each run keeps its memory (one folder per site). Saved to the state branch by the workflows |
| `dataDir` | `seo-autopilot` | the files you edit: `feeds.json`, `topics.json`, `backlinks/` |
| `stateBranch` | `seo-data` | git branch holding the saved state (one force-pushed orphan commit, reports only, never secrets) |

## Site

| Key | Meaning |
|---|---|
| `id` | lowercase letters, digits, dashes. Unique |
| `url` | must be `https://` and end with `/` |
| `searchConsoleProperty` | the property exactly as in Search Console: the URL with trailing slash, or `sc-domain:example.com` |
| `sitemap` | full URL of the sitemap (index files are not followed; use the page sitemap) |
| `indexNow.keyEnv` | name of the env var/secret holding your IndexNow key |
| `ga4PropertyId` | numeric GA4 property id, or `null` |
| `ignoreQueries`, `brandTerms` | brand queries are never turned into topic proposals |
| `feeds`, `topicsConfig`, `backlinksDir` | override the default file locations under `dataDir` |
| `limits` | daily/weekly caps on proposals and topics |
| `ingest` | optional dashboard sync, see [dashboard.md](dashboard.md) |

## Content adapters (`content`)

The adapter tells the autopilot what pages exist, so it never proposes a duplicate and can schedule and count pages.

```jsonc
{ "type": "sitemap" }                       // zero config, read-only: coverage check only, no scheduling
{ "type": "json", "include": ["src/content/**/*.json"],      // arrays of page objects
  "routes": [{ "match": "guides.json", "urlPattern": "/blog/{slug}" }] }
{ "type": "markdown", "dir": "content/blog", "ext": [".md", ".mdx"], "urlPattern": "/blog/{slug}" }
```

Page fields it understands: `slug`/`id`, a title (`h1`, `title`, `name`, `term` or `metaTitle`), `primaryKeyword`/`keyword`, `faqs` (`q` or `question`), and the drip fields `publishAt` (YYYY-MM-DD), `queued` (approved, not dated) and `hold` (never schedule). Scheduling and release need `json` or `markdown`.

## Data files you edit (in `dataDir`)

- `feeds.json`: `[{ "id", "name", "url", "category": "regulator|platform|industry", "region" }]`
- `topics.json`: `keywords` (term to weight 1-3), `minScore`, `maxItemAgeDays`, `proposeCategories`, `proposeFeedIds`, `minScoreWithoutAi`, `draftRules` (appended to topic issues)
- `backlinks/`: see [backlinks.md](backlinks.md)

## Environment variables and secrets

See [jobs.md](jobs.md).
