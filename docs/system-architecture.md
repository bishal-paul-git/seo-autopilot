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

**C. Read access for hosted sites (D56)**
1. The portal shows the service account's email (Worker `GET /google/account`). The customer adds it as a user of their
   Search Console property (Restricted) and GA4 property (Viewer).
2. "Check access" (Worker `POST /google/check`, with the signed-in user's token checked by `google_access_site`) lists,
   with the service account, the Search Console properties covering the site's host and the GA4 properties with a web
   stream on it. `google_access_seen` stores the lists.
3. The customer picks. `bind_google` checks the pick against the lists and the host, then binds each property to one
   website only; a refusal is recorded for the platform admin.
4. The daily `search_snapshot` job reads the bound Search Console and GA4 properties with the service account. A weekly
   `speed_snapshot` job checks the home page and the top pages with the platform's PageSpeed key.

**D. What the hosted engine knows, and how it reacts (D57)**
1. Every day per site: `search_snapshot` (28-day Search Console snapshot, GA4, and now 35 days of daily site totals
   merged into report `history`: 120 days of totals, 9 weekly points for the top 30 queries and pages);
   `index_inspect` (URL Inspection API, at most 20 pages a day, important pages first; report `inspect` in the CLI's
   inspect shape, previous state per page; a 403 is recorded as "needs Full permission" and retried after a week);
   `priorities` (free; the CLI's priority engine, `src/analysis/priorities.mjs`, on the hosted reports, re-run whenever
   its inputs change). Sources: `src/god/search-console.mjs`, `inspect.mjs`, `insights.mjs`,
   `src/analysis/search-history.mjs`.
2. Planning (`src/god/tick.mjs`, `planner.mjs`) passes audit, profile, priorities, inspect, speed (D56, router shape)
   and the history's query movement (`rank`) to `routeAgents`; agents get `indexStatus`, `priorities` and
   `searchHistory` (bounded) next to `searchConsole`, `analytics` and `speed`.
3. Fast reaction: `src/analysis/alerts.mjs` compares the latest data with the previous (clicks down 30% week over week
   with at least 50 clicks the week before; an important page de-indexed or newly blocked; new 5xx/4xx or noindex on an
   important page since the previous scan). An alert queues its specialist with a day period (priority 1), within the
   budget and approval rules, not again within 7 days; that week's routine run of the same specialist is skipped.
4. Once a day after 07:00 UTC the scheduler calls `record_daily_digests` (migration 20261119000000): per agency, work
   waiting for a person and for how long, stopped work, failures, data freshness, spend against budget. It is a portal
   notification when something needs attention, so the daily summary email (D40) carries it when SMTP is set. Stale
   data (no snapshot in 48 h for a connected site, no scan in 72 h) and refused inspection also appear in the agency's
   alerts and, for platform admins, in platform health on Operations.

**E. Portfolio and per-change scorecard (D58)**
1. Planning adds a site-memory entry (kind `scorecard`) for each completed agent job that named pages on the site's own
   host (dated when the agency accepted it) and each merged implementation (dated at the merge; its advice is then not
   counted again). Source: `src/analysis/scorecard.mjs` (pure), `src/god/scorecard.mjs`.
2. A free `scorecard` job, only for sites with Google access and only when something is due, reads one small Search
   Console query per change (the pages' daily rows, 28 days before to 28 days after) and freezes on the entry the
   before-baseline and each 14- and 28-day verdict: win, loss, flat, too early or not enough data, against the rest of
   the site from `history`. Superseded copies are pruned after 14 days; the current entry holds everything.
3. `public.portfolio()` (migration 20261120000000) gives the portal's landing page: one row per website of the caller's
   agencies, needs attention first; `portfolio(site)` adds that site's scorecard ("Results of changes").

## Tenancy
Every row belongs to an org through `sites.org_id`. Reads are row-level security (`private.is_member`); writes go through
`SECURITY DEFINER` functions that check membership themselves. Clients see one site through a share link
(`shared_site`, anon). Details and tests: [security.md](security.md).

## Infrastructure decision record
No new infrastructure was added in the audit. The hosted scan uses the Supabase project that already hosts the portal
(D25): pg_cron for schedules, pg_net to wake the function, Vault for its secret. Moving the scan elsewhere is a copy of
`src/hosted/scan.mjs`.
