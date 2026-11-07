# System architecture

Verified against the code and the deployed services on 2026-11-07 (audit branch `claude/audit-refinement`). What is
deployed and what is only built is in [deployment-status.md](deployment-status.md); every job and agent is in
[registry.md](registry.md).

## Components
| # | Component | Source | Runs on | Talks to |
|---|---|---|---|---|
| 1 | **Engine** (CLI, 58 jobs, audit crawler, analysis) | `bin/`, `src/jobs`, `src/audit`, `src/analysis`, `src/lib` | the website's GitHub Actions, or locally | Search Console, GA4, PageSpeed, CrUX, Bing, optional providers (registry lists each job's keys) |
| 2 | **Workflow templates** (12) | `templates/workflows` | copied into each website repository by `init`, refreshed by `upgrade` | the engine via `npx github:bishal-paul-git/seo-autopilot#v2` |
| 3 | **Agents** (38 definitions, 8 departments) and skills (7) | `departments/` | Claude Code (plugin) on request; 7 of them from workflows (`seo-agent`, `seo-implement`, `seo-review`) | the site repository (branches `seo/*`, pull requests), reports |
| 4 | **Autopilot policy** | `src/analysis/autonomy.mjs`, `seo-autopilot.yml`, `seo-automerge.yml`, `seo-watch.yml` | GitHub Actions, off until `SEO_AUTOPILOT=true` | merges low-risk PRs after all checks pass; watch proposes reverts |
| 5 | **MCP server** (6 read-only tools) | `src/mcp` | locally (`seo-autopilot mcp`) | reads the state folder |
| 6 | **Hosted connector** (remote MCP, OAuth via GitHub) | `cloud/connector` | Cloudflare Worker: **not deployed** | the `seo-data` branch through a GitHub App |
| 7 | **Portal database** (orgs, members, sites, snapshots, share links, decisions, invites) | `cloud/portal/supabase/migrations` | Supabase project `ymwwwhdlyjnqbxxhtcew` | the portal page, the two functions |
| 8 | **`ingest` function** | `cloud/portal/supabase/functions/ingest` | Supabase Edge Function | receives a site's daily snapshot (site token), returns pending decisions |
| 9 | **`scan` function** (D25) | `cloud/portal/supabase/functions/scan`, `src/hosted/` | Supabase Edge Function, woken by pg_cron | crawls sites added by address through the SSRF guard; stores snapshots |
| 10 | **Portal page** | `cloud/portal/app/index.html`, `build.mjs` | static, seo.erudience.com (Hostinger, branch `seo-portal` of erudience-flow-engine) | Supabase Auth and REST/RPC with the anon key |
| 11 | **Landing site** | `site/`, `scripts/build-site.mjs` | GitHub Pages | none |

## Data flows
**A. GitHub-connected website (full autopilot)**
1. `seo-daily` (05:17 UTC) restores state from the `seo-data` branch and runs daily jobs (Search Console report and URL
   inspection, rank, proposals, audit, analysis, priorities, link graph, IndexNow, dashboard).
2. `portal --push` builds a snapshot and POSTs it to `ingest` with the site token (`SEO_PORTAL_URL`, `SEO_PORTAL_TOKEN`);
   `ingest` stores it (`ingest_snapshot`) and returns decisions made in the portal (`sync_decisions`).
3. The same step applies each decision on GitHub (label `approved` and dispatch `seo-implement`, hold, or close) and
   acknowledges it.
4. `seo-implement` runs a drafting agent on a `seo/*` branch and opens a PR; `seo-check` and `seo-review` check it; a
   person merges, or, with `SEO_AUTOPILOT=true`, `seo-automerge` merges what the policy allows; `seo-watch` checks the
   result afterwards.
5. The portal shows the latest snapshot, growth across snapshots, and approvals.

**B. Website added by address (D25, no repository)**
1. Portal "Add and scan" calls `add_site_by_url` (validates the address, limits, queues the site, wakes `scan` through
   pg_net with the Vault secret).
2. `scan` checks the secret, claims due sites one at a time (`claim_scan`, `FOR UPDATE SKIP LOCKED`), runs
   `scanSite` (robots.txt respected, SSRF guard on every request and redirect, 60 pages, body cap), optionally reads
   Search Console with `GOOGLE_KEY_JSON`, and stores the snapshot (`finish_scan`).
3. pg_cron wakes `scan` every 10 minutes; each site is due once a day; failures retry after 6 hours.
4. Read-only: address-only sites get findings, business details and priorities, never changes.

## Tenancy
Every row belongs to an org through `sites.org_id`. Reads are row-level security (`private.is_member`); writes go through
`SECURITY DEFINER` functions that check membership themselves. Clients see one site through a share link
(`shared_site`, anon). Details and tests: [security.md](security.md).

## Infrastructure decision record
No new infrastructure was added in the audit. The hosted scan uses the Supabase project that already hosts the portal
(D25): pg_cron for schedules, pg_net to wake the function, Vault for its secret. Moving the scan elsewhere is a copy of
`src/hosted/scan.mjs`.
