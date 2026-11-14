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

## Quotas
Google publishes default quotas for each API in the console (APIs & Services › the API › Quotas); this was not measured
here. At 4 pages a week per site, 100 sites use about 400 PageSpeed calls and 100 Chrome UX Report calls a week. The
service account's Search Console and Analytics quotas are shared by every hosted site.
