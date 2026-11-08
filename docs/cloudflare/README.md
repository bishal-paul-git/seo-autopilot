# Cloudflare execution: architecture, setup and rollback (D30)

Owner direction: [CLOUDFLARE-EXECUTION-PLAN-2026-11-08.md](../architecture/CLOUDFLARE-EXECUTION-PLAN-2026-11-08.md) (PR #42).
Decision: D30 in [DECISIONS.md](../implementation/DECISIONS.md).
Where every job runs: [runtime-matrix.md](runtime-matrix.md). Free-tier usage: [usage-estimate.md](usage-estimate.md).

**Status:** built and tested locally, including in workerd (Cloudflare's runtime) and in Deno (Supabase's runtime). **Not deployed.** Nothing in Cloudflare, Supabase or DNS has been changed.

## Who does what
| Part | Role | Runtime limits that shaped it |
|---|---|---|
| **Cloudflare Worker `seo-god`** (`cloud/worker/`) | One Cron Trigger every 15 min checks the pause switch, recovers expired leases, picks due sites, and hands each site's planning and each job to a new invocation of itself (the `SELF` service binding). Runs the SEO God planner, onboarding, strategy drafts and advise-only agent runs. | 10 ms CPU and 50 subrequests per invocation. One site or one job per invocation; measured 0.4-2.5 ms CPU per step. |
| **Supabase Postgres** (existing project) | Jobs, guarded lifecycle, agency-only approvals, reviews, leases, retries, memory, costs, run log, pause switch and due-site rotation. All gates are SQL (`private.move_job`). | Source of truth; the Worker keeps no state. |
| **Supabase Edge Function `scan`** (existing) | Crawling and audits in job mode: one site per request, at most 40 pages, compact result back to the Worker, snapshot stored for the portal. | 2 s CPU per request; a 60-page audit measured 0.8-1.6 s. |
| **GitHub** (existing) | Source, PRs, CI, releases, plus the 52 CLI jobs that need files or processes, in the site repositories' existing workflows. | Unchanged. |
| **Hostinger** (existing) | The portal at seo.erudience.com. | Unchanged. |
| **Cloudflare Workflows** | Not used. Supabase already makes every step durable (job states, leases, retries, approvals), and Workflows Free has the same 10 ms per step plus a 3,000-step daily cap. | Revisit only for a multi-step job that cannot be split into jobs. |

## Safety properties (what is tested)
| Property | How | Evidence |
|---|---|---|
| Agency-only approvals | the database refuses any worker move into authorized/rejected for gated work; a second agency approval accepts the strategy | `rls4.sql`, `god-pg-e2e.mjs`, `cf-local-e2e.mjs` |
| Tenant isolation | agency B cannot approve or read agency A's jobs, ticks, costs or memory; the Worker plans one site per invocation, with site ids taken only from the database | `rls4-7.sql`, `cf-local-e2e.mjs` |
| No duplicate execution | idempotency keys per site and period; `claim_job` uses `for update skip locked` with a lease; expired leases are recovered through the normal capped retry path | `rls4.sql`, `rls7.sql`, `cf-local-e2e.mjs` |
| Retries and escalation | at most 3 attempts, then escalated to a person; review-driven retries capped; refusals, a missing key or too little budget escalate at once | `god.test.mjs`, `agent-runner.test.mjs` |
| Budgets | per-site daily budget reserved before queueing; per-job budget across attempts; cost from the provider's own usage | `tick.test.mjs`, `agent-runner.test.mjs`, `cf-local-e2e.mjs` |
| Kill switches | Worker var `SEO_GOD_PAUSED` (default `"true"`) and the database switch `public.set_god_paused(true)`, which needs no deploy. If the database cannot be read, the scheduler pauses. | `cf-worker.test.mjs`, `cf-local-e2e.mjs` |
| Internal routes | `/internal/*` need `INTERNAL_TOKEN` (constant-time compare; refused when unset); only `/health` is public and returns no data | `cf-worker.test.mjs`, `cf-local-e2e.mjs` |
| Scan safety | public http(s) only, guarded fetch at every redirect, robots.txt, 40-page cap, shared secret | `safe-fetch.test.mjs`, `scan-fn-local.mjs` (Deno, real site) |
| Monitoring | one `god_runs` row per run (sites planned, jobs run, leases recovered, invocations, subrequests, errors); `public.god_usage(days)`; Workers observability logs | `rls7.sql`, `cf-local-e2e.mjs` |

**Known limits:**
- The Worker uses the Supabase service-role key. It bypasses row security, so tenant safety rests on the SQL functions and on the Worker never taking a site id from a public request.
- A dedicated database role for the Worker would be stronger. It would need a JWT signed with the project secret, so it was not done here.
- CPU inside Cloudflare has not been measured yet, because workerd does not enforce limits locally.

## Account setup (owner actions, in this order)
Nothing here has been done. Each step needs the owner.

1. **Review and merge the PR chain:** #33 → #34 → #35/#36 → #37 → #38 → #39 → #40 → #41 → #43 → #44 → #45 → #46 → #47 → #48 → the security fixes PR.
2. **Supabase migrations.** Apply them in order to project `ymwwwhdlyjnqbxxhtcew`, Dashboard → SQL, or `supabase db push` from a reviewed checkout:
   - `20261104000000_portal_url_sites.sql`
   - `20261108000000_r1_contracts.sql`
   - `20261108010000_r1_memory.sql`
   - `20261108020000_r1_scheduler.sql`
   - `20261108030000_cloudflare_execution.sql`
   - `20261108040000_agency_console.sql` (the SEO God page in the portal)
   - `20261108050000_client_portal.sql` (client requests and the agency inbox)
   - `20261108060000_learning.sql` (what the SEO God learned, in the console)
   - `20261108070000_operations.sql` (Operations page; platform admins)
   - `20261108080000_security_fixes.sql` (security review fixes, D34)

   Then make yourself a platform admin: `insert into public.platform_admins (user_id, note) select id, 'owner' from auth.users where email = '<your email>';`

   The first one (D25) needs the `pg_cron` and `pg_net` extensions. It also **schedules its own 10-minute scan** (`seo-autopilot-scan`). With Cloudflare as the only scheduler, remove that schedule straight after applying, so sites are not crawled twice:

   `select cron.unschedule('seo-autopilot-scan');`
3. **Supabase Vault secrets** (D25), in SQL:
   - `select vault.create_secret('https://ymwwwhdlyjnqbxxhtcew.supabase.co/functions/v1/scan', 'scan_url');`
   - `select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'scan_secret');`

   Read the generated `scan_secret` once in the Dashboard (Vault). It is the Worker's `SCAN_SECRET`.
4. **Redeploy the `scan` Edge Function** from this branch:
   - `node cloud/portal/build-scan.mjs`
   - `supabase functions deploy scan --no-verify-jwt --project-ref ymwwwhdlyjnqbxxhtcew`

   This replaces v2. The deployed v2 predates the SSRF guard and must not be left in place once D25 is applied.
5. **Cloudflare (Free plan):**
   - `cd cloud/worker && npm ci && npx wrangler login` (or a `CLOUDFLARE_API_TOKEN` with *Workers Scripts: Edit*).
   - Set secrets with `npx wrangler secret put <NAME>`. The value is typed at the prompt, never in a file:
     | Name | Value |
     |---|---|
     | `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API → service_role |
     | `INTERNAL_TOKEN` | a new random value, e.g. `openssl rand -hex 32`; used only between the Worker and itself |
     | `SCAN_SECRET` | the `scan_secret` from step 3 |
     | `ANTHROPIC_API_KEY` | optional, the agency's own key; without it agent jobs are deferred, never queued |
     | `GOOGLE_KEY_JSON` | optional, the agency's Google service account key (JSON); site owners add its email as a user in their Search Console; without it traffic is never measured |
   - Plain vars are already in `wrangler.toml` and safe to commit: `SUPABASE_URL`, `SCAN_FUNCTION_URL`, budgets, model. Check them.
   - `npm run deploy` deploys **paused** (`SEO_GOD_PAUSED = "true"`). Then:
     - `curl https://seo-god.<your-subdomain>.workers.dev/health` must answer `{"ok":true,...}`;
     - `select * from public.god_runs order by id desc limit 3;` after 15 minutes must show `paused = true`.
6. **Publish the portal** with the SEO God page: `PORTAL_SUPABASE_URL=… PORTAL_SUPABASE_KEY=<publishable key> node cloud/portal/build.mjs`, then upload `cloud/portal/dist/` to seo.erudience.com (Hostinger) as before.
7. **Go live for one pilot site:**
   - set the other sites to `status = 'paused'` in `public.sites`;
   - change `SEO_GOD_PAUSED` to `"false"` and `npm run deploy`;
   - watch `god_runs`, `jobs` and the Workers dashboard (CPU p99, errors) for a day, then un-pause sites in batches.
8. **Agent advice (optional):** set the `ANTHROPIC_API_KEY` secret and a non-zero `SEO_GOD_DAILY_BUDGET_USD` (per site per day), then deploy.

A staging Worker (`npm run deploy:staging`) exists in `wrangler.toml`. Point its `SUPABASE_URL` at a Supabase branch or a test project, never at production data.

## Check the setup
`SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… WORKER_URL=https://seo-god.<you>.workers.dev node scripts/god-preflight.mjs` checks each step above, read-only, and says what to do for each failing one.

To let a site use the shared Google account for Search Console, a platform admin first confirms the agency really manages it, then runs `select public.set_gsc_allowed('<site id>', true);`. This is refused while the domain is in another agency (D34).

## Rollback (fastest first)
1. Portal → Operations → **Pause the scheduler** (platform admins), or `select public.set_god_paused(true, 'reason');`. Either stops all work from the next run, with no deploy.
2. `SEO_GOD_PAUSED = "true"` plus `npm run deploy`, or `npx wrangler rollback` to the previous Worker version.
3. `npx wrangler triggers deploy` with an empty `crons` list removes the schedule; `npx wrangler delete` removes the Worker.
4. Jobs left `running` are recovered by `reap_expired_leases` on the next run, or can be failed by hand with `public.fail_job`. No website is ever changed by this Worker (advise only), so no site rollback is needed.

## Checks to run
- `npm test` covers the engine, the orchestration and the Worker logic (mocked).
- `bash cloud/portal/supabase/test/run.sh` runs the 7 SQL suites; run it as a database superuser.
- `node scripts/god-pg-e2e.mjs` runs the orchestration against the real migrations.
- `cd cloud/worker && npm ci && cd ../.. && node scripts/cf-local-e2e.mjs` runs the Worker in workerd against the real migrations, with stand-ins for Supabase HTTP, scan and Anthropic.
- `node cloud/portal/build-scan.mjs && DENO=deno node scripts/scan-fn-local.mjs https://<site>` runs the scan function in Deno on a real site.
- `node scripts/cf-measure.mjs https://<site>` gives CPU per step on a real site.
- `node scripts/cf-runtime-audit.mjs` regenerates the runtime matrix.
