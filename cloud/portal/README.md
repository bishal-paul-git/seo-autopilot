# Client portal

A hosted dashboard for an agency and its clients. Each website's own SEO Autopilot run sends one snapshot a day.
- **The agency** signs in and sees every website it connected. It connects new websites and makes client links.
- **A client** opens a link and sees one website's dashboard on a phone or a desktop. They don't need an account.

Decision D23 in `docs/implementation/DECISIONS.md` explains the design.

**What the dashboard shows:** search totals and trend, keywords (ranking now and targeted next), every page with a 0 to 100 score, location pages by area, pages Google has not indexed, the plan and proposed pages, the weekly report and the agents' recent work. When the site's GA4 property is connected, it also shows visits by channel, source, country and device.

## Parts
| Part | Where | What it is |
|---|---|---|
| Snapshot | `src/analysis/portal.mjs`, `src/jobs/portal.mjs` | `seo-autopilot run portal [--push]`: `portal.json` from the reports the other jobs already wrote. The daily workflow pushes it when the secrets below are set |
| Database | `supabase/migrations/` | Tables, row level security and the functions the page calls (Postgres on Supabase) |
| Ingest | `supabase/functions/ingest/` | Edge Function: takes a snapshot with the site's token and saves it |
| Page | `app/index.html`, `build.mjs` | One static file with no libraries. It reads through Supabase's REST API with the publishable key |
| Checks | `supabase/test/`, `test/portal*.test.mjs` | Access rules on Postgres 16; the snapshot; the page in Chromium against a stand-in API |

## Who can see what
- **Sign-up:** every new account gets its own organisation (agency). People see only their own organisations' websites, snapshots and links. Row level security enforces this, not the page.
- **Snapshots** come in only through `ingest_snapshot`. The ingest function calls it with the service role, and the caller needs the site's token.
  - Only a hash of each token is kept, in a schema the API does not expose.
  - Making a new token stops the old one.
  - Each website keeps its last 120 snapshots.
- **A client link** is a random token. `shared_site` returns that one website's name and latest snapshot, and nothing else about the agency. Revoke a link by setting `revoked_at`.
- **The page holds only public values:** the project address and the publishable key. `build.mjs` refuses service-role and secret keys.

## Deploy
1. Create or choose a Supabase project.
   - Apply `supabase/migrations/*.sql` with `supabase db push`, the SQL editor or the MCP `apply_migration`.
   - Deploy `supabase/functions/ingest` with JWT verification off, because it checks the site token itself.
2. In Supabase, open Authentication › URL Configuration. Set the Site URL to the portal's address so confirmation emails link back to it. Custom SMTP is needed before strangers can sign up: the built-in mailer only sends to the project's team.
3. Build the page: `PORTAL_SUPABASE_URL=https://<ref>.supabase.co PORTAL_SUPABASE_KEY=<publishable key> node cloud/portal/build.mjs`, which writes `cloud/portal/dist/`. Host that folder on any static host (Hostinger, Vercel, Netlify, GitHub Pages). It sends `noindex` and a robots.txt that blocks crawling.
4. For each website, choose "Connect a website" in the portal, then add two secrets to the website's repository:
   - `SEO_PORTAL_URL`: `https://<ref>.supabase.co/functions/v1/ingest`
   - `SEO_PORTAL_TOKEN`: shown once.

   The `seo-daily` workflow then runs `portal --push` every day. Existing installs need `seo-autopilot upgrade --apply` first to get that step.

## Test locally
- `npm test` runs the snapshot tests, and the browser test when Playwright is installed.
- The access rules need a Postgres 16 server:
  `createdb portal && psql -v ON_ERROR_STOP=1 -d portal -f cloud/portal/supabase/test/shim.sql -f cloud/portal/supabase/migrations/20261030000000_portal.sql -f cloud/portal/supabase/test/rls.sql`

  It ends with `all portal access checks passed`.

## Not done yet
- **Billing:** plans, limits per plan and Stripe.
- **Team invitations:** a second person in the same agency is added by hand in `org_members` for now.
- **Custom domains per agency.**
- **Real-time updates:** the page reloads data when opened.
