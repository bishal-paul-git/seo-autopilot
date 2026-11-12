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

## Hosted SEO God (Cloudflare Worker `seo-god`, Supabase, portal)
Checked on the pilot in November 2026 (D50). Every change to production still needs the owner's go-ahead.

**Daily check (2 minutes):** portal → **Operations**. The **Alerts** card lists what needs a person:
| Alert | Meaning | What to do |
|---|---|---|
| The scheduler has not run | no run in 40 minutes while not paused | Cloudflare → Workers & Pages → seo-god → Logs; redeploy (below) if the Worker is missing or failing |
| Three of the last four runs reported errors | repeated failures | Operations → Scheduler → Recent runs (platform admins) shows the messages |
| Items waiting more than 3 days | approvals nobody has decided | open the site's SEO God page and approve or reject |
| Jobs stopped and need a person | escalated after retries, a refusal, an unreadable review or no budget | SEO God page → the job: retry, or reject |
| Today's AI budget is used up | work waits until tomorrow | fine as a cap; raise the site's **Daily budget** (owners) if the work is worth it |
| The last planning run failed | the site could not be planned | the message names the step; a scan failure usually explains itself (robots.txt, address) |

**Pause everything (no deploy):** Operations → **Pause the scheduler** (platform admins), or SQL `select public.set_god_paused(true, 'reason');`. Resume the same way. A single site: set its status to `paused`.

**Budgets:** each site uses the platform default (`SEO_GOD_DAILY_BUDGET_USD` in `cloud/worker/wrangler.toml`, $2 today) unless an agency owner sets its own on Operations → **Daily budget** (0 to 100 US dollars; empty = default). Spend this month and last month is shown per site.

**Roll back:**
- *Worker:* GitHub → Actions → **deploy-seo-god** → Run workflow, choosing a branch or tag that holds the previous good version (tag each release so there is one), with "run" ticked. Every deploy keeps the secrets.
- *Portal:* the previous files are kept on the host as `previous-YYYY-MM-DD*.html` next to `index.html` (Hostinger → File manager → seo.erudience.com). Rename the wanted one to `index.html`.
- *Database:* `cloud/portal/supabase/rollback/post-release-1.sql` reverts everything after Release 1 (D42 to D50) and `rollback/release-1.sql` reverts Release 1. Rehearse first on a local copy: `node scripts/db-rollback-check.mjs --post` and `node scripts/db-rollback-check.mjs` (both restore the catalog exactly and re-apply cleanly; last run 2026-11-12). Roll back the Worker and portal to a matching commit at the same time, or they will call missing functions.

**Rotate a key:**
- `ANTHROPIC_API_KEY` or `GOOGLE_KEY_JSON` (Worker secrets): Cloudflare → seo-god → Settings → Variables and secrets → edit. Takes effect on the next run; no deploy needed. Revoke the old key at the provider afterwards.
- `SUPABASE_SERVICE_ROLE_KEY`: rotate in Supabase → Project Settings → API keys, update the GitHub repository secret of the same name, then run **deploy-seo-god** (it writes the Worker secret).
- The Worker's internal token is generated on every deploy; redeploying rotates it.
- Agent exams: `ANTHROPIC_API_KEY` GitHub repository secret (Settings → Secrets and variables → Actions).

## Secrets (names only; values live in GitHub secrets, Supabase function secrets or Vault)
`GOOGLE_KEY_JSON`, `PAGESPEED_API_KEY`, `CRUX_API_KEY`, `GOOGLE_KG_API_KEY`, `BING_WEBMASTER_API_KEY`,
`OPENPAGERANK_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `BRAVE_API_KEY` or `SERPAPI_KEY`, `DATAFORSEO_*`,
`SEO_PORTAL_URL`, `SEO_PORTAL_TOKEN`; Vault `scan_url`, `scan_secret`. Which job needs which: [registry.md](registry.md).
