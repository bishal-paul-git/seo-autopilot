# seo-god (Cloudflare Worker)

The SEO God scheduler and dispatcher (D30). It is stateless: Supabase holds every job, approval, memory row, lease and cost.

- Setup, secrets, deployment and rollback: [docs/cloudflare/README.md](../../docs/cloudflare/README.md).
- Limits and usage: [docs/cloudflare/usage-estimate.md](../../docs/cloudflare/usage-estimate.md).

- `src/worker.mjs` is the entry module. workerd treats every named export of the entry as a handler, so it exports only the handler.
- `src/app.mjs` holds the logic: Cron run, per-site planning, per-job runs, the remote scan, auth and settings.
- `build.mjs` bundles the 38 agent definitions and the vertical packs. A Worker cannot read the repository's files.
- `wrangler.toml` deploys **paused** by default. Secrets are set with `npx wrangler secret put`, never in the file.

Wrangler is a deploy tool only. The engine stays dependency-free.
