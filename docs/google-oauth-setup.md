# Connect with Google: owner setup (D56)

Hosted customers connect Search Console and GA4 by pressing **Connect with Google** in the portal, signing in, pressing
Allow and picking their properties. For that, the platform needs one Google OAuth client (made once, by the owner) and
three Worker secrets. Speed checks need one more Worker secret (a PageSpeed API key).

Nothing here is done automatically. No secret goes in a file, a commit, a chat or an email.

| What | Value |
|---|---|
| Google Cloud project | `seo-autopilot-511920` |
| Worker | `seo-god`, `https://seo-god.contact-bishalpaul.workers.dev` (from the deploy-seo-god run log, 2026-11-13) |
| Authorised redirect URI | `https://seo-god.contact-bishalpaul.workers.dev/oauth/google/callback` (exact, no trailing slash) |
| Authorised JavaScript origin | none needed (the browser never talks to Google's token endpoint) |
| Portal | `https://seo.erudience.com/` (Worker var `PORTAL_URL` in `cloud/worker/wrangler.toml`) |
| Scopes | `openid`, `email`, `https://www.googleapis.com/auth/webmasters.readonly`, `https://www.googleapis.com/auth/analytics.readonly` |

If the Worker later moves to a custom domain, add the new callback address to the client, and set the Worker var
`GOOGLE_OAUTH_REDIRECT_URI` to it. Without that var the Worker uses `<its own address>/oauth/google/callback`.

## 1. Turn on the APIs (Google Cloud console)
In project `seo-autopilot-511920`, go to APIs & Services › Library and enable:
- **Google Search Console API**: lists the properties and reads search data.
- **Google Analytics Admin API**: lists the GA4 properties for the picker.
- **Google Analytics Data API**: reads visits per landing page.
- **PageSpeed Insights API** and **Chrome UX Report API**: the weekly speed checks.

## 2. OAuth consent screen (Google Auth Platform)
Go to APIs & Services › OAuth consent screen (in the newer console: Google Auth Platform › Branding, Audience, Data access).
1. User type: **External**.
2. App name, for example "SEO Autopilot". Add a support email and a developer contact email.
3. **Data access** (scopes): add `.../auth/webmasters.readonly` and `.../auth/analytics.readonly`. `openid` and `email`
   are added by default.
4. **Audience**: leave the publishing status on **Testing** to start.
   - In Testing, only the Google accounts listed under **Test users** can connect, up to 100.
   - Add yourself and each pilot customer's Google account.
   - In Testing, Google ends the grant after **7 days**, so a test user must press Connect with Google again weekly. The
     portal then shows "The Google connection stopped working".
5. **To let any customer connect, publish the app** (Audience › Publish app). Google then asks for:
   - a homepage URL and a **privacy policy URL** on a domain you own and have verified in Search Console (the authorised
     domain, for example erudience.com);
   - **verification of the sensitive scopes**. Both scopes above are sensitive. Expect to explain how the data is used,
     and to record a short video of the consent flow. Verification can take **several weeks**.
   - Until it is verified, a published app still works, but users see an "unverified app" warning and the number of
     new users is capped.

## 3. OAuth client
APIs & Services › Credentials › Create credentials › **OAuth client ID**:
- Application type: **Web application**. Name: "seo-god Worker".
- Authorised redirect URIs: `https://seo-god.contact-bishalpaul.workers.dev/oauth/google/callback`
- Create. Copy the **Client ID** and the **Client secret** straight into step 4. Do not save them anywhere else.

## 4. Worker secrets (Cloudflare)
Set each secret from `cloud/worker` with `npx wrangler secret put <NAME>` (the value is typed at the prompt), or in the
Cloudflare dashboard › Workers & Pages › seo-god › Settings › Variables and Secrets (type: Secret):

| Secret | Value | Without it |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | the client ID from step 3 | Connect with Google answers "not set up yet" |
| `GOOGLE_OAUTH_CLIENT_SECRET` | the client secret from step 3 | same |
| `PAGESPEED_API_KEY` | an API key (step 5) | the weekly speed check is never planned |

`PORTAL_URL` is an ordinary var, already set in `wrangler.toml`. Redeploy the Worker (the deploy-seo-god workflow) after
the code is merged. The service-account secret `GOOGLE_KEY_JSON` stays optional: it is used only for sites with no Google
connection that a platform admin confirmed.

## 5. PageSpeed key
APIs & Services › Credentials › Create credentials › **API key**. Then Edit API key › API restrictions › **Restrict key**
to *PageSpeed Insights API* and *Chrome UX Report API* only. There is no application restriction: the Worker calls from
Cloudflare's addresses. Put it in the Worker secret `PAGESPEED_API_KEY`.

Both APIs are free. Google publishes default quotas in the console (APIs & Services › each API › Quotas); this was not
measured here. At 4 pages a week per site, 100 sites use about 400 PageSpeed calls and 100 Chrome UX Report calls a week.

## 6. Database and portal
1. Run `cloud/portal/supabase/migrations/20261118000000_google_oauth.sql` in the Supabase SQL editor (production project
   `ymwwwhdlyjnqbxxhtcew`). It adds the attempts table, the Vault-backed functions and the updated `site_pipeline`.
   Rollback: drop the new functions and `private.google_oauth`, and re-run `20261117010000_pipeline_agent_from_kind.sql`.
2. Build the portal with the Worker address and publish it:
   `PORTAL_SUPABASE_URL=… PORTAL_SUPABASE_KEY=<publishable key> PORTAL_WORKER_URL=https://seo-god.contact-bishalpaul.workers.dev node cloud/portal/build.mjs`.
   Without `PORTAL_WORKER_URL`, the button says "not set up on this portal yet".

## 7. Check it
1. `curl https://seo-god.contact-bishalpaul.workers.dev/health` answers `{"ok":true,...}`.
2. In the portal, open a site › Connections › Set up › **Connect with Google**. Sign in with a test user and press Allow.
   You return to Connections with "Google connected as …", and the property for the site's address is pre-selected.
3. Press **Save**. At the next planning run, a "Read the last 28 days from Search Console" job completes, with evidence
   that ends "(the site's own Google connection)".
4. **Disconnect** revokes the grant at Google. It is gone from https://myaccount.google.com/permissions.

## What the customer sees
On Connections, a "Set up" card with three steps:
1. Website ✓
2. Connect with Google: a button, then two dropdowns, then "Connected as …" with Save, Refresh lists and Disconnect.
3. GitHub (optional).

The older developer guide (service account, secrets, workflows) is under **Advanced: connect a GitHub run**.

A client user of the site may connect their own Google when nothing is connected. They may then change or disconnect only
that connection. They never see the agency's Google email or lists.
