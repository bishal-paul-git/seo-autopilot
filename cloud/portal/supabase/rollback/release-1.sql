-- Rollback for Release 1 database migrations (20261104000000 through 20261108130000).
-- Returns the schema to what production had on 2026-11-08 (the portal migrations only). Generated from a catalog diff
-- and checked locally: after the full chain and this script, every table, column, constraint, index, trigger,
-- function, policy, grant and row-level-security flag matches the original (see docs/implementation/RELEASE-1-PRODUCTION-CHANGE-MANIFEST.md).
--
-- DATA LOSS: every row in the 17 new tables (jobs, site memory, clients, submissions, costs, run logs, ...) and the
-- new columns on public.sites is deleted. Take the backup in the manifest first. Existing sites, agencies, members,
-- invites, share links, snapshots and decisions are kept.
-- Run as the database owner (Supabase SQL editor) in one transaction. Then redeploy the previous scan function.
begin;

-- 1. Stop the scan schedule that 20261104000000 creates (only if pg_cron is installed).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'seo-autopilot-scan';
  end if;
end $$;

-- 2. Triggers added on existing tables.
drop trigger if exists on_auth_user_gate_signup on auth.users;
drop trigger if exists sites_client_same_org on public.sites;
drop trigger if exists sites_gsc_reset on public.sites;

-- 3. Sign-up as it was: every new user gets their own workspace (on_auth_user_created is unchanged and keeps using it).
create or replace function private.on_new_user()
returns trigger language plpgsql security definer set search_path = '' as $f$
declare v_org uuid;
begin
  insert into public.orgs (name) values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'My agency')) returning id into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org, new.id, 'owner');
  return new;
end;
$f$;

-- 4. public.sites: statuses the old check does not know go back to connecting; new columns and checks go.
update public.sites set status = 'connecting' where status not in ('connecting', 'live', 'paused');
alter table public.sites drop constraint if exists sites_url_public;
alter table public.sites drop constraint if exists sites_status_check;
alter table public.sites add constraint sites_status_check check (status in ('connecting', 'live', 'paused'));
alter table public.sites
  drop column if exists gsc_allowed_by,
  drop column if exists client_id,
  drop column if exists mode,
  drop column if exists scan_state,
  drop column if exists gsc_allowed_at,
  drop column if exists scan_started_at,
  drop column if exists next_scan_at,
  drop column if exists gsc_allowed,
  drop column if exists scan_error;

-- 5. New tables (their policies, indexes, triggers and sequences go with them).
drop table if exists public.notification_seen cascade;
drop table if exists public.email_prefs cascade;
alter table public.invites drop column if exists emailed_at;
drop table if exists public.client_invites cascade;
drop table if exists public.jobs cascade;
drop table if exists public.job_events cascade;
drop table if exists public.reviews cascade;
drop table if exists public.approvals cascade;
drop table if exists public.clients cascade;
drop table if exists public.client_members cascade;
drop table if exists public.submissions cascade;
drop table if exists public.integrations cascade;
drop table if exists public.audit_log cascade;
drop table if exists public.site_memory cascade;
drop table if exists public.god_control cascade;
drop table if exists public.job_costs cascade;
drop table if exists public.god_site_ticks cascade;
drop table if exists public.god_runs cascade;
drop table if exists public.platform_admins cascade;
drop table if exists private.platform_settings cascade;

-- 6. New functions (GitHub tokens stored by 110000 are removed first: they belong to no remaining feature).
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'vault') and to_regclass('vault.secrets') is not null then
    delete from vault.secrets where name like 'github_token:%';
  end if;
end $$;
drop function if exists public.connect_github(uuid, text, text);
drop function if exists public.disconnect_github(uuid);
drop function if exists public.site_integrations(uuid);
drop function if exists public.github_target(uuid);
drop function if exists public.record_integration_status(uuid, text, boolean, text);
drop function if exists public.request_implementation(uuid, integer);
drop function if exists public.site_deployments(uuid);
drop function if exists public.my_notifications();
drop function if exists private.notifications_for(uuid);
drop function if exists public.mark_notifications_seen();
drop function if exists public.site_work_report(uuid, date);
drop function if exists public.site_workforce(uuid, integer);
drop function if exists public.set_email_summary(boolean);
drop function if exists public.my_email_summary();
drop function if exists public.email_queue(integer);
drop function if exists public.email_sent(text, text);
drop function if exists public.scan_secret();
drop function if exists private.public_host(p_url text);
drop function if exists private.kick_scan();
drop function if exists public.add_site_by_url(p_url text, p_name text, p_org uuid);
drop function if exists public.scan_now(p_site uuid);
drop function if exists public.scan_secret_ok(p_secret text);
drop function if exists public.claim_scan();
drop function if exists public.finish_scan(p_site uuid, p_data jsonb, p_error text);
drop function if exists private.client_org(p_client uuid);
drop function if exists private.sites_client_same_org();
drop function if exists private.row_same_org();
drop function if exists private.is_client_viewer(p_site uuid);
drop function if exists private.is_agency_for_site(p_site uuid);
drop function if exists private.job_move_allowed(p_from text, p_to text);
drop function if exists public.my_submissions(p_site uuid);
drop function if exists private.move_job(p_job uuid, p_to text, p_actor_kind text, p_actor text, p_note text, p_data jsonb);
drop function if exists public.create_job(p_site uuid, p_kind text, p_title text, p_source text, p_risk text, p_requires_approval boolean, p_priority integer, p_inputs jsonb, p_idempotency_key text, p_objective text, p_depends_on uuid[], p_budget_usd numeric);
drop function if exists public.transition_job(p_job uuid, p_to text, p_actor text, p_note text, p_data jsonb);
drop function if exists public.record_review(p_job uuid, p_reviewer text, p_verdict text, p_rationale text, p_evidence jsonb);
drop function if exists public.claim_job(p_worker text, p_lease_seconds integer);
drop function if exists public.fail_job(p_job uuid, p_actor text, p_error text);
drop function if exists public.approve_job(p_job uuid, p_decision text, p_note text);
drop function if exists public.submit_to_agency(p_site uuid, p_kind text, p_title text, p_body text);
drop function if exists public.client_sites();
drop function if exists public.create_client(p_name text, p_org uuid);
drop function if exists public.assign_site_client(p_site uuid, p_client uuid);
drop function if exists public.invite_client_user(p_client uuid, p_email text);
drop function if exists public.record_god_run(p_run jsonb);
drop function if exists public.recall(p_site uuid, p_kind text);
drop function if exists public.set_platform_paused(p_paused boolean, p_reason text);
drop function if exists private.site_host(p_url text);
drop function if exists public.remember(p_site uuid, p_items jsonb, p_actor text);
drop function if exists public.set_god_paused(p_paused boolean, p_reason text);
drop function if exists public.god_sites();
drop function if exists public.site_jobs(p_site uuid);
drop function if exists public.site_spend(p_site uuid, p_since timestamp with time zone);
drop function if exists public.record_job_output(p_job uuid, p_outputs jsonb, p_cost numeric, p_note text);
drop function if exists public.god_paused();
drop function if exists public.gsc_allowed(p_site uuid);
drop function if exists public.record_site_tick(p_site uuid, p_outcome jsonb);
drop function if exists public.reap_expired_leases(p_limit integer);
drop function if exists public.god_due_sites(p_limit integer, p_min_age interval);
drop function if exists private.sites_gsc_reset();
drop function if exists public.god_usage(p_days integer);
drop function if exists public.god_console(p_site uuid);
drop function if exists public.answer_question(p_site uuid, p_key text, p_value text);
drop function if exists public.retry_job(p_job uuid, p_note text);
drop function if exists public.platform_health(p_days integer);
drop function if exists public.review_submission(p_submission uuid, p_decision text, p_note text, p_job_kind text, p_risk text, p_budget_usd numeric);
drop function if exists public.submission_for_job(p_job uuid);
drop function if exists public.agency_inbox(p_site uuid);
drop function if exists private.is_platform_admin();
drop function if exists public.agency_overview();
drop function if exists public.set_gsc_allowed(p_site uuid, p_allowed boolean);
drop function if exists private.gate_signup();
drop function if exists private.invite_only();
drop function if exists public.set_invite_only(p_on boolean);

commit;

-- Optional, only if nothing else in the project uses them (production had neither before Release 1):
-- drop extension if exists pg_cron; drop extension if exists pg_net;
-- Vault secrets added for Release 1 (scan_url, scan_secret) are removed in Dashboard -> Project Settings -> Vault.
