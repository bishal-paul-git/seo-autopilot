# Hosted Google access: owner setup (D56)

Hosted customers give the platform's Google **service account** read access to their own Search Console and GA4
properties, press **Check access**, and pick the property in the portal. There is no Google sign-in, no OAuth client and
no consent screen. The Worker already has the service account (secret `GOOGLE_KEY_JSON`, D47); only a few things are
still needed. Nothing here is done automatically, and no secret goes in a file, a commit, a chat or an email.

## 1. APIs on the service account's Google Cloud project
In the project the service account belongs to (`seo-autopilot-511920`), go to APIs & Services › Library and enable:
- **Google Analytics Admin API**: Check access lists the GA4 properties shared with the service account and their web streams.
- **Google Analytics Data API**: the daily read of visits per landing page.
- **PageSpeed Insights API** and **Chrome UX Report API**: the weekly speed checks.

The Google Search Console API is already enabled (the D47 reads use it).

## 2. Worker secret and vars (Cloudflare, `seo-god`)
| Name | Kind | Value | Without it |
|---|---|---|---|
| `GOOGLE_KEY_JSON` | secret (already set) | the service account's JSON key | no Google access at all |
| `PAGESPEED_API_KEY` | secret | API key from APIs & Services › Credentials › Create credentials › API key, restricted to the PageSpeed Insights and Chrome UX Report APIs | weekly speed checks are never planned |
| `SUPABASE_PUBLISHABLE_KEY` | plain var in `cloud/worker/wrangler.toml` | the portal's publishable key (public, the same one the portal is built with) | Check access answers "not set up yet" |
| `PORTAL_URL` | plain var (already `https://seo.erudience.com/`) | the portal's address: the only browser origin allowed to call `/google/*` | same |

Set the secret with `npx wrangler secret put PAGESPEED_API_KEY` from `cloud/worker`, or in the Cloudflare dashboard ›
Workers & Pages › seo-god › Settings › Variables and Secrets. Then redeploy the Worker with the deploy-seo-god workflow
after the merge.

## 3. Database and portal
1. Run `cloud/portal/supabase/migrations/20261118000000_google_access.sql` in the Supabase SQL editor (production
   project `ymwwwhdlyjnqbxxhtcew`).
   - It adds `google_bindings`, `google_binding_conflicts` and the functions, and updates `site_pipeline`.
   - Rollback: drop those two tables and the new functions, then re-run `20261117010000_pipeline_agent_from_kind.sql`.
2. Build the portal with the Worker address, then publish it:
   `PORTAL_SUPABASE_URL=… PORTAL_SUPABASE_KEY=<publishable key> PORTAL_WORKER_URL=https://seo-god.contact-bishalpaul.workers.dev node cloud/portal/build.mjs`

## 4. Check it
1. `curl https://seo-god.contact-bishalpaul.workers.dev/google/account` answers with the service account's email only.
2. In the portal, open a site › Connections › Set up. The email is shown with a Copy button.
3. In Search Console, add the email as a user of that site's property (Restricted). Press **Check access**: the
   property appears, already selected. Press **Save**.
4. At the next planning run, a "Read the last 28 days from Search Console" job completes, with evidence ending
   "(property connected in the portal)".
5. Refused attempts (a property or domain already used by another website) appear on Operations under "Google access
   refused" for platform admins.

## 5. Index status, history, alerts and the daily digest (D57)
1. **Permission for URL inspection.** Google's URL Inspection API answers only for a **Full** user or an owner of the
   property. With Restricted access the daily `index_inspect` job records "needs Full permission" (shown in the
   agency's alerts and digest) and tries again after a week. Everything else works with Restricted.
2. **Migration** `cloud/portal/supabase/migrations/20261119000000_daily_digest.sql` (run in the SQL editor after
   20261118000000). It adds `agency_digests` (RLS on, no policies), `record_daily_digests` (service role),
   `agency_digests` (members), and new versions of `private.notifications_for`, `ops_alerts` and `platform_health`.
   Until it is applied the Worker skips the digest quietly. Rollback: drop `public.agency_digests`, the functions
   `record_daily_digests`, `agency_digests`, `private.agency_digest`, `private.site_freshness`, then re-run the
   `notifications_for` definition from 20261108120000, `ops_alerts` from 20261116000000 and `platform_health` from
   20261108070000. Note: the daily call also deletes superseded copies (older than 14 days) of the derived reports
   `search_console`, `history`, `priorities`, `inspect`, `speed` and `analytics`; audit copies are kept.
3. **Scan function**: redeploy `scan` so the Worker receives error statuses and noindex pages (`signals`) for the alert
   detector. Without it, alerts on errors use the audit's sitemap findings only.
4. **Worker**: redeploy (deploy-seo-god). Optional var `INSPECT_PER_DAY` (default 20, at most 40).
5. Check: the next day, a site with a bound property has a completed "Check which pages Google has indexed" job and a
   "Rank the to-do list" job; after 07:00 UTC, Notifications shows a "Daily digest" item when something waits.

## 6. Portfolio and results of changes (D58)
1. **Migration** `cloud/portal/supabase/migrations/20261120000000_portfolio_scorecard.sql` (run in the SQL editor after
   20261119000000). It allows site-memory kind `scorecard`, adds `public.portfolio(p_site uuid default null)` (agency
   members) and a new `record_daily_digests` that also prunes superseded scorecard copies. Until it is applied the portal
   shows the old website cards and the Worker cannot store scorecard entries (planning carries on without them and
   retries each run), so apply it before redeploying the Worker. Rollback: drop `public.portfolio(uuid)`, re-run
   `record_daily_digests` from 20261119000000, delete `site_memory` rows of kind `scorecard`, then restore the kind
   check from 20261108020000.
2. **Worker**: redeploy (deploy-seo-god). No new variable or secret. The `scorecard` job uses the same service account
   and Restricted access is enough.
3. **Portal**: rebuild and publish (`node cloud/portal/build.mjs`).
4. Check: the portal opens on "Portfolio". A change accepted or merged on a site with a bound property shows on that
   site's "Results of changes" as "Too early"; about 3 days later a "Score changes against Search Console" job has run
   and the change has a baseline; the 14-day verdict follows about 20 days after the change.

## Quotas
URL inspection: Google allows 2,000 inspections a day and 600 a minute per property; the job asks at most 20 a day.

Google publishes default quotas for each API in the console (APIs & Services › the API › Quotas); this was not measured
here. At 4 pages a week per site, 100 sites use about 400 PageSpeed calls and 100 Chrome UX Report calls a week. The
service account's Search Console and Analytics quotas are shared by every hosted site.
