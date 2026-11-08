# Deployment status

Checked on 2026-11-07 against the live services (Supabase API through the project's MCP, Hostinger deployment log,
GitHub). "Built" means code and tests exist; only what is listed as deployed is live.

| Component | Deployed version | Evidence | Notes |
|---|---|---|---|
| Engine release | `v2.22.1` (`v2`, `v2-stable` at `f2301b4`) | `git ls-remote --tags` | address-only scanning, 13 new audit rules and the registry are on PR #33 and the audit branch, not released |
| Website: erudience-flow-engine | seo-daily, weekly, monthly, release, backlinks (weekly since 2026-11-04) running | Actions run history, e.g. seo-daily 41834364691 success | `seo-agent` and `seo-autopilot` skipped: `SEO_AGENT`, `SEO_AUTOPILOT` not set, so **no AI agent runs in production** |
| Website: tenanthousingdisrepair, excel-error-finder | same workflows | Actions | not re-checked run by run in this audit |
| Portal push from websites | **not running** | no snapshot since the 2026-10-31 seed | `SEO_PORTAL_URL` / `SEO_PORTAL_TOKEN` secrets not set on any site |
| Supabase project `ymwwwhdlyjnqbxxhtcew` | migrations up to `20261030211548` (portal, approvals/team/brand) | `supabase_migrations.schema_migrations` | **D25 migration not applied**; pg_cron and pg_net not enabled; Vault secrets `scan_url`, `scan_secret` absent |
| Data | 2 orgs, 1 user, 4 sites (2 live from the seed, 2 connecting), 2 snapshots, 3 share links, 0 decisions | SQL count | |
| `ingest` function | v1, ACTIVE, JWT off (checks the site token) | function list | |
| `scan` function | v2, ACTIVE, JWT off; imports `src/hosted/scan.mjs` at `82c5009` | function list | refuses every call (no Vault secret); **predates the SSRF guard: redeploy before applying D25** |
| Portal page | erudience-flow-engine `seo-portal` `1daf25f`, Hostinger | Hostinger deployment log | shows "Add and scan", which fails until D25 is applied |
| Hosted connector (`cloud/connector`) | not deployed | | needs the owner's GitHub App and Cloudflare deploy |
| npm package | not published | | no `NPM_TOKEN` |

## To go live with address-only sites (owner go-ahead needed for each production step)
1. Merge the audit branch into PR #33's branch (or review both together) and take a pinned commit.
2. Redeploy `scan` from that commit (it then includes `safe-fetch.mjs`).
3. Apply `cloud/portal/supabase/migrations/20261104000000_portal_url_sites.sql`, then the two Vault secrets
   (`cloud/portal/README.md`).
4. Rebuild and publish the portal page.
5. Add one test website; acceptance in [test-matrix.md](test-matrix.md) (E2E-URL rows).

Rollback: delete the cron job (`select cron.unschedule('seo-autopilot-scan')`), delete the Vault secrets (the function
then refuses every call), revert the portal page commit on `seo-portal`. The new columns and functions are additive.
