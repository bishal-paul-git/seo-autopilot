# Release 1: production change manifest (for owner approval)

Prepared 2026-11-08 for owner decision Q2 and steps 3, 4, 6 and 7 of `RELEASE-1-PRODUCTION-GATES-2026-11-08.md`. Code under review: draft PR #51 (`claude/release-1`).

**Nothing in this file has been applied.** Production was only read: catalog queries and function and migration listings, with no writes. Each step below needs its own explicit owner approval, given in `REVIEW-QUESTIONS.md` or in chat. The owner has **not** authorized portal publishing, unpausing, live AI spend or Search Console access (Q2, Q3); they are listed only so the sequence is complete.

## 0. Production today (observed read-only, 2026-11-08 ~03:00 UTC, project `ymwwwhdlyjnqbxxhtcew`)

| Area | Observed |
|---|---|
| Migrations recorded | 3: `portal_00_schema`, `portal_01_tables`, `portal_02_helpers_policies` |
| Schema vs repo | Matches repo migrations `20261030000000_portal.sql` + `20261030120000_portal_approvals_team_brand.sql`. Fingerprints of every column, policy and function (whitespace-normalised) are equal, with 3 exceptions below. |
| Exceptions | `invite_member`: differs only by one code comment. `private.on_new_user`: production revoked public execute (stricter; kept by `create or replace`). **Production-only** `private.claim_erudience()` + trigger `on_auth_user_claim_erudience` on `auth.users`: makes the owner's account an owner of the Erudience org. It is not in the repo; no Release 1 migration touches it. |
| D25 (address-only scan) | **Not applied**: no `scan_secret_ok`, `claim_scan`, `pg_cron` or `pg_net`. |
| Extensions | `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp` |
| Vault secrets | 0 |
| Edge Functions | `scan` v2 (from `3176cf0`, predates the SSRF guard), `ingest` v1 |
| Data | 4 sites (2 `connecting`, 2 `live`, all https), 2 orgs, 2 memberships, 1 user, 0 pending invites. Compatible with every new constraint (checked). |
| Cloudflare | 0 Workers in the account (checked earlier this session) |

## 1. Backup (owner, before any database step)
Supabase Free has no point-in-time restore. Take a logical dump from a reviewed checkout. It needs the database password, which you type yourself and never paste into a file or chat:
```
supabase link --project-ref ymwwwhdlyjnqbxxhtcew
supabase db dump --linked -f backup-2026-11-08-schema.sql
supabase db dump --linked --data-only -f backup-2026-11-08-data.sql
```
Keep both files outside the repository: they contain customer data. Restoring a full dump is the last resort. The rollback in step P1 is the normal path.

## 2. Steps, in order

### P1. Database migrations (Gate B; approval needed)
Apply in this order, in the SQL editor, one file at a time, each in its own transaction:

| # | File | Adds | Touches existing objects |
|---|---|---|---|
| 1 | `20261104000000_portal_url_sites.sql` | address-only scanning (D25); `pg_net`, `pg_cron`; a 10-minute `cron` job | `public.sites`: 5 columns, status check widened (+`scanning`), public-address check |
| 2 | `20261108000000_r1_contracts.sql` | clients, jobs, reviews, approvals, submissions, audit log | `sites.client_id`; `private.on_new_user` redefined (invited clients and agency invitees no longer get a workspace of their own) |
| 3 | `20261108010000_r1_memory.sql` | site memory | none |
| 4 | `20261108020000_r1_scheduler.sql` | costs, scheduler functions | none |
| 5 | `20261108030000_cloudflare_execution.sql` | pause switch, run log, due sites, leases | none |
| 6 | `20261108040000_agency_console.sql` | SEO God console functions | none |
| 7 | `20261108050000_client_portal.sql` | agency inbox, submission review | none |
| 8 | `20261108060000_learning.sql` | console adds lessons | none |
| 9 | `20261108070000_operations.sql` | platform admins, overview, health | none |
| 10 | `20261108080000_security_fixes.sql` | Search Console confirmation, job limits | `sites.gsc_allowed*`, trigger `sites_gsc_reset` |
| 11 | `20261108090000_strategy_draft.sql` | **only if D35 / PR #50 is confirmed** | none |
| 12 | `20261108100000_invite_only.sql` | invite-only sign-up gate (Q8) | trigger `on_auth_user_gate_signup` (before insert on `auth.users`) |

**Immediately after #1, in the same session:** `select cron.unschedule('seo-autopilot-scan');`. Cloudflare is the only scheduler (D30). Until the Vault secrets exist, that job does nothing anyway (`kick_scan` returns early).

**Grants and row-level security:** the catalog diff shows no changes to grants or policies on existing tables. All 17 new tables have RLS enabled (checked in the catalog diff). Writes go only through `security definer` functions with an empty `search_path`, each checking the caller. This is covered by `rls.sql`–`rls14.sql`; see Checks.

**Verify:** `node scripts/god-preflight.mjs` (migrations check). `select count(*) from supabase_migrations.schema_migrations;`. The portal still signs in, lists sites, and invites still work.

**Rollback:** `cloud/portal/supabase/rollback/release-1.sql`, in one transaction. `node scripts/db-rollback-check.mjs` shows locally that after the full chain it restores **every** table, column, constraint, index, trigger, function, policy, grant and RLS flag of today's schema, and that the chain re-applies cleanly afterwards. **Data loss:** rows in the new tables and the new `sites` columns. Existing sites, agencies, members, invites, share links, snapshots and decisions are kept.

### P2. Vault secrets (approval needed)
```
select vault.create_secret('https://ymwwwhdlyjnqbxxhtcew.supabase.co/functions/v1/scan', 'scan_url');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'scan_secret');
```
The second value is also the Worker's `SCAN_SECRET`. Read it once in the Dashboard (Vault) when setting the Worker secret, and never copy it into files or chat.

**Rollback:** delete both in Dashboard → Vault. The scan function then refuses job and cron calls.

### P3. Redeploy the `scan` Edge Function, v2 → v3 (approval needed)
These are the changes since v2 (`3176cf0`):
- SSRF-safe fetch (`src/hosted/safe-fetch.mjs`).
- Job mode returning a compact result.
- One site per cron request; at most 40 pages.
- Search Console only for sites a platform admin confirmed.
- http(s)-only social and logo addresses.

```
node cloud/portal/build-scan.mjs
supabase functions deploy scan --no-verify-jwt --project-ref ymwwwhdlyjnqbxxhtcew
```
**Verify:**
- `curl -s -X POST https://ymwwwhdlyjnqbxxhtcew.supabase.co/functions/v1/scan` without the secret returns 403.
- The preflight check passes.

**Rollback:** check out `3176cf0`, rebuild and deploy the same way. v2 needs none of the new tables.

### P4. Cloudflare Worker, deployed **paused** (owner approved in principle, after Gates A and B)
Follow `docs/cloudflare/README.md` step 5:
- Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_TOKEN`, `SCAN_SECRET`.
- **No `ANTHROPIC_API_KEY`**, so AI spend stays at $0 (Q4 open). **No `GOOGLE_KEY_JSON`** (Q11 open).
- `SEO_GOD_PAUSED = "true"` and `SEO_GOD_DAILY_BUDGET_USD = 0`.
- Also run `select public.set_god_paused(true, 'paused deployment');` so both switches are on.

**Why paused is safe (tested):**
- The Cron run checks both switches first and does nothing else; an unreadable switch counts as paused (`cf-worker.test.mjs`).
- The planning and job routes now check both switches too. A pause therefore also stops work already dispatched, or anything sent with the internal token (new test).
- The workerd end-to-end run confirms this.

**Verify:**
- `/health` returns `{ ok, service, version }` only.
- `select * from public.god_runs order by id desc limit 5;` shows `paused = true`, `jobs_run = 0`.
- Watch for a day: CPU per invocation in the Cloudflare dashboard (X1: p99 against the 10 ms Free limit), requests a day, errors.

**Rollback:**
- `npx wrangler rollback`.
- Or `npx wrangler triggers deploy` with no crons.
- Or `npx wrangler delete`. Nothing in Supabase depends on the Worker.

### P5. Invite-only sign-up (Q8): no Auth setting change needed
Turning off sign-up in Supabase Auth would also block invited people. So the database gate (P1 #12) enforces it instead:
- A new account is refused unless its email has a pending agency or client invite.
- Existing users and sign-in are untouched.
- The portal explains the refusal.
- A platform admin opens sign-up at launch with `select public.set_invite_only(false);`.

Verified in `rls14.sql`:
- A stranger is refused, and nothing is half-created.
- An agency invite and a client invite still work.
- Members cannot change the setting.
- Opening sign-up restores the old behaviour.

`portal-invite-only.test.mjs` checks the message in Chromium.

**Prerequisite:** a platform admin (Q10, owner identity confirmation open):
```
insert into public.platform_admins (user_id, note) select id, 'owner' from auth.users where email = '<owner email>';
```

### P6. Publish the portal (NOT authorized; Q2)
`node cloud/portal/build.mjs`, then upload `cloud/portal/dist/` to Hostinger. Until this is approved, the live portal stays on the current version. It only calls functions that still exist after P1, so it keeps working. New pages (SEO God, Requests, Operations) appear only after publishing.

### P7. Unpause the read-only pilot (NOT authorized; Gate C)
This needs a separate approval after a day of healthy paused runs. It will be scoped to erudience.com only (Q3), with `SEO_GOD_DAILY_BUDGET_USD = 0` and no AI key.

## 3. erudience.com read-only pilot test matrix (for Gate C)
| # | Check | Expected | Evidence |
|---|---|---|---|
| 1 | Add erudience.com by address (agency owner) | site row `mode = url`; status `connecting` | portal, `sites` row |
| 2 | First paused run | `god_runs.paused = true`; no jobs claimed | `god_runs` |
| 3 | Unpause for this site only | the next run plans this site only | `god_site_ticks` |
| 4 | Scan through the scan function | ≤ 40 pages; robots.txt respected; no writes to the site | `god_runs`, `site_memory` report rows |
| 5 | Strategy draft | waits for the agency; no agent jobs while there is no approved strategy | SEO God page |
| 6 | Agency approval | strategy approved in memory; job completed | `jobs`, `site_memory` |
| 7 | Agent work with $0 budget | deferred "over today's budget"; no model calls | tick report, `job_costs` empty |
| 8 | Client boundary | a client account sees reports and requests only, and cannot approve | portal as client; `rls9.sql` |
| 9 | Pause again | the next run does nothing | `god_runs` |
| 10 | Recovery | an expired lease is reaped and the job retried once | `god_runs.jobs_recovered` |
| 11 | Usage | Worker requests a day; Supabase function invocations | dashboards vs `docs/cloudflare/usage-estimate.md` |

## 4. Checks behind this manifest (local, this session; mocked providers only)
- `npm test`: 564/564.
- `bash cloud/portal/supabase/test/run.sh`: 14 suites, including `rls14.sql` (invite-only) and `rls15.sql`. The second calls every outsider-callable function against another agency's records (956 calls; nothing leaked or changed).
- `node scripts/db-rollback-check.mjs`: rollback exact; re-apply clean.
- `node scripts/god-pg-e2e.mjs`.
- `node scripts/cf-local-e2e.mjs` (workerd).
- Production: read-only queries listed in section 0.

**Not verified:**
- Real Cloudflare CPU (X1).
- Any live model or Google call.
- A Supabase staging project (S3 recommends one; it needs a free project slot).
