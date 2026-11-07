# Operational runbook

For the owner or an operator. Every step that changes production needs the owner's go-ahead.

## Daily health check (5 minutes)
1. Each website repository: Actions, `seo-daily` green today. A red step: open it; most steps continue on error, so read
   the step's log, not only the run's colour.
2. Portal: each site shows "updated today". A GitHub site that does not: its portal secrets, then the `Client portal` step.
3. Address-only sites: Supabase > SQL: `select name, scan_state, scan_error, last_snapshot_at, next_scan_at from public.sites where mode = 'url';`
4. Supabase > Edge Functions > `scan` > Logs: "scan ok" and "scan failed" lines.

## Common problems
| Symptom | Likely cause | Fix |
|---|---|---|
| Portal "Add and scan" error "Could not find the function" | D25 migration not applied | apply it ([deployment-status.md](deployment-status.md)) |
| Address-only site stays "Scanning" | Vault secrets missing, pg_cron or pg_net off, or `scan` failing | check `select * from vault.decrypted_secrets where name like 'scan_%'` exists (do not print values), `select * from cron.job`, function logs |
| `scan_error` "robots.txt asks crawlers not to read this site" | the site blocks crawlers | expected; the owner of the site must allow it |
| `scan_error` "address refused" | private or internal address | expected; use the public address |
| Search Console "Not connected yet" | the site owner has not added the service account | add the email shown in the portal as a Restricted user |
| GitHub site not in portal | `SEO_PORTAL_URL` / `SEO_PORTAL_TOKEN` missing or token rotated | make a new token on the portal's Connect page, update the secret |
| Actions minutes running out | private repositories; heavy jobs | backlinks is weekly; check `seo-weekly` steps that need keys you do not have (they skip, but still start) |
| Supabase project paused | free plan, 7 days without API traffic | restore it in the dashboard; scans and pushes keep it active |

## Emergency stops
- Stop all autopilot merges on a site: repository variable `SEO_AUTOPILOT_PAUSED=true`.
- Stop hosted scans: `select cron.unschedule('seo-autopilot-scan');` and delete the `scan_secret` Vault secret.
- Revoke a site's push access: rotate its token in the portal (the old one stops at once).
- Revoke a client link: set `revoked_at` on the share link (portal or SQL).

## Secrets (names only; values live in GitHub secrets, Supabase function secrets or Vault)
`GOOGLE_KEY_JSON`, `PAGESPEED_API_KEY`, `CRUX_API_KEY`, `GOOGLE_KG_API_KEY`, `BING_WEBMASTER_API_KEY`,
`OPENPAGERANK_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `BRAVE_API_KEY` or `SERPAPI_KEY`, `DATAFORSEO_*`,
`SEO_PORTAL_URL`, `SEO_PORTAL_TOKEN`; Vault `scan_url`, `scan_secret`. Which job needs which: [registry.md](registry.md).
