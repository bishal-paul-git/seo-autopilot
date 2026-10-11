# Optional database dashboard (Supabase)

Not needed for the autopilot. Use it if you want results in your own database so an admin page can show them.

1. In a Supabase project, run `migration.sql`. **It expects a function `public.has_role(uuid, text)` that says whether a user is an admin** (the usual pattern for admin-only read access). If you do not have one, replace the `has_role` policies with your own rule, or use the service role only.
2. Deploy `seo-ingest/index.ts` as an Edge Function named `seo-ingest` with **JWT verification off** (it authenticates with its own token) and set the secret `SEO_INGEST_TOKEN` to a long random string.
3. In your GitHub repository add secrets `SEO_INGEST_URL` (`https://<project>.supabase.co/functions/v1/seo-ingest`) and `SEO_INGEST_TOKEN` (the same string), and add `"ingest": { "urlEnv": "SEO_INGEST_URL", "tokenEnv": "SEO_INGEST_TOKEN" }` to your site in `seo-autopilot.config.json`.
4. Build any admin page that reads the tables: `seo_daily_summary`, `seo_inspections`, `seo_backlinks`, `seo_digests`, `seo_topics`.

Rows are upserts, so reruns are safe. The function never accepts reads, only token-authenticated writes.
