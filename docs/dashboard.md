# Dashboard

You get a dashboard with no extra setup, and can add a database-backed one if you want history across devices.

## 1. The built-in dashboard (default)

`seo-autopilot run dashboard` builds **one HTML file** from the data the autopilot keeps in your repository:
`.seo-autopilot/<site>/dashboard/index.html`. No server, no database, no tracking scripts, works offline.

It shows:

- clicks, impressions and average position (28-day totals), with charts over time
- how many inspected pages are indexed, and the status of the rest
- **the pages to request indexing for**, each with a direct Search Console link
- the content schedule: what goes live on which day, and how many are approved but not yet dated
- the keyword and topic backlog
- backlink targets and their status
- the latest weekly digest and the news list

**Getting it:** the daily workflow builds it and attaches it to the run as the artifact `seo-dashboard` (kept 14 days). Open **Actions > seo-daily > the latest run > Artifacts**, download, open `index.html`. It is also saved on the `seo-data` branch under `.seo-autopilot/<site>/dashboard/`.

Locally: `npx seo-autopilot run dashboard`, then open the printed path.

**Privacy:** the file lists real queries and URLs and is marked `noindex`. If you put it on GitHub Pages it is public on most plans, so only do that with a private repository on a plan that allows private Pages, or password-protect it.

## 2. Optional: your own database dashboard (Supabase)

If you already have a site with an admin area, you can send the results to your own database. Config:

```json
"ingest": { "urlEnv": "SEO_INGEST_URL", "tokenEnv": "SEO_INGEST_TOKEN" }
```

Set both as repository secrets. Each job then POSTs its results to your endpoint with the header `x-ingest-token`.

A ready-made endpoint and schema are in [`templates/dashboard-supabase`](../templates/dashboard-supabase): one SQL migration (tables with admin-only read access) and one Edge Function that checks the token and stores results. Your admin page then reads the tables (`seo_daily_summary`, `seo_inspections`, `seo_backlinks`, `seo_digests`, `seo_topics`). The Erudience site's `/admin/seo` page is a working example built on exactly these tables.

You do not need this for the autopilot to work.
