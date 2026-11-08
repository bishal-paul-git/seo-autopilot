-- Fixes from the independent security review of 2026-11-08 (D34). Not applied anywhere.
--
-- 1. Search Console with the platform's shared Google account could read any domain an agency added, including one it
--    does not own (another agency's client who had added the account would have their data shown to the attacker).
--    Now a site may use the shared account only when a platform admin has confirmed it (gsc_allowed), the confirmation
--    is cleared whenever the site's address changes, and never while the same domain is registered in another agency.
-- 2. Agency members could create jobs with any budget through create_job and bypass the per-site daily budget, spending
--    the platform's AI key. Member-created jobs now get at most $5 each, need the agency's approval when they carry a
--    budget, and at most 100 a day per agency. (The per-site daily cap is also enforced at run time by the engine.)

alter table public.sites add column if not exists gsc_allowed boolean not null default false,
  add column if not exists gsc_allowed_by uuid references auth.users (id) on delete set null,
  add column if not exists gsc_allowed_at timestamptz;
-- Members may not change it: their update grant lists only name, url, repo and status (20261030000000_portal.sql).

create or replace function private.site_host(p_url text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(lower(split_part(split_part(regexp_replace(coalesce(p_url, ''), '^[a-z]+://', '', 'i'), '/', 1), ':', 1)), '^www\.', '');
$$;

create or replace function private.sites_gsc_reset()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.url is distinct from old.url then new.gsc_allowed := false; new.gsc_allowed_by := null; new.gsc_allowed_at := null; end if;
  return new;
end;
$$;
drop trigger if exists sites_gsc_reset on public.sites;
create trigger sites_gsc_reset before update of url on public.sites for each row execute function private.sites_gsc_reset();

-- Service role (the scan function, the Worker): may this site use the shared Google account right now?
create or replace function public.gsc_allowed(p_site uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.gsc_allowed and not exists (
      select 1 from public.sites o where o.org_id <> s.org_id and private.site_host(o.url) = private.site_host(s.url))
    from public.sites s where s.id = p_site), false);
$$;

-- Platform admins confirm, after checking ownership, that a site may use the shared Google account.
create or replace function public.set_gsc_allowed(p_site uuid, p_allowed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.sites;
begin
  if not private.is_platform_admin() then raise exception 'not allowed'; end if;
  select * into s from public.sites where id = p_site;
  if s.id is null then raise exception 'site not found'; end if;
  if p_allowed and exists (select 1 from public.sites o where o.org_id <> s.org_id and private.site_host(o.url) = private.site_host(s.url)) then
    raise exception 'this domain is also registered in another agency: confirm ownership before allowing it'; end if;
  update public.sites set gsc_allowed = p_allowed, gsc_allowed_by = case when p_allowed then (select auth.uid()) end, gsc_allowed_at = case when p_allowed then now() end where id = p_site;
  insert into public.audit_log (org_id, site_id, actor, action, target) values (s.org_id, s.id, (select auth.uid()), case when p_allowed then 'gsc.allow' else 'gsc.revoke' end, s.id::text);
  return jsonb_build_object('site', s.id, 'allowed', p_allowed);
end;
$$;

create or replace function public.create_job(p_site uuid, p_kind text, p_title text, p_source text default 'agency', p_risk text default 'low',
  p_requires_approval boolean default false, p_priority int default 3, p_inputs jsonb default '{}', p_idempotency_key text default null,
  p_objective text default null, p_depends_on uuid[] default '{}', p_budget_usd numeric default 0)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_org uuid := private.site_org(p_site); is_service boolean := (select auth.role()) = 'service_role';
  v_budget numeric := greatest(coalesce(p_budget_usd, 0), 0);
begin
  if v_org is null then raise exception 'site not found'; end if;
  if not is_service and not private.is_member(v_org) then raise exception 'not allowed'; end if;
  if not is_service and p_source not in ('agency', 'on_demand') then raise exception 'agency staff create agency or on-demand jobs'; end if;
  if not is_service then
    if v_budget > 5 then raise exception 'a job created by agency staff can carry at most $5'; end if;
    if (select count(*) from public.jobs where org_id = v_org and created_by = (select auth.uid()) and created_at > now() - interval '1 day') >= 100 then
      raise exception 'at most 100 jobs a day per person'; end if;
  end if;
  if p_idempotency_key is not null then
    select * into j from public.jobs where site_id = p_site and idempotency_key = p_idempotency_key;
    if j.id is not null then return j; end if; -- a repeated event does not create a second job
  end if;
  insert into public.jobs (org_id, site_id, kind, title, objective, source, priority, risk, requires_approval, inputs, idempotency_key, depends_on, budget_usd, created_by)
    values (v_org, p_site, p_kind, p_title, p_objective, p_source, least(greatest(coalesce(p_priority, 3), 1), 5), p_risk,
            p_requires_approval or p_risk = 'high' or p_source = 'client_submission' or (not is_service and v_budget > 0),
            coalesce(p_inputs, '{}'), p_idempotency_key, coalesce(p_depends_on, '{}'), v_budget, (select auth.uid()))
    returning * into j;
  insert into public.job_events (job_id, org_id, actor_kind, actor, to_status, note) values (j.id, j.org_id, case when is_service then 'agent' else 'user' end, coalesce((select auth.uid())::text, 'service'), 'proposed', 'created');
  insert into public.audit_log (org_id, site_id, actor, action, target) values (j.org_id, j.site_id, (select auth.uid()), 'job.create', j.id::text);
  return j;
end;
$$;

revoke all on function private.site_host(text), private.sites_gsc_reset(), public.gsc_allowed(uuid), public.set_gsc_allowed(uuid, boolean) from public, anon, authenticated;
grant execute on function public.gsc_allowed(uuid) to service_role;
grant execute on function public.set_gsc_allowed(uuid, boolean) to authenticated;
grant execute on function private.site_host(text) to service_role, authenticated;
