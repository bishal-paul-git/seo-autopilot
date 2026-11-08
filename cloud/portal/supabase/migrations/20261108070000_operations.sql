-- Operations (D32): an overview for each agency of its own sites, and platform health for platform admins only.
-- Scheduler runs and the pause switch cover every agency, so they are never shown to an agency: an agency member
-- would otherwise see other tenants' activity and could pause everyone. Platform admins are an explicit list kept by
-- the service role (no self sign-up). Not applied anywhere.

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  note text
);
alter table public.platform_admins enable row level security; -- no policies: only the service role and the functions below read it
grant select, insert, delete on public.platform_admins to service_role;

alter table public.god_control add column if not exists updated_by uuid references auth.users (id) on delete set null;

create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

-- Every site of the caller's agencies: what needs a person, what it costs, when it was last planned.
create or replace function public.agency_overview()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'url', s.url, 'status', s.status,
      'strategy', (select m.value->>'status' from public.site_memory m where m.site_id = s.id and m.kind = 'strategy' and m.key = 'initial' and m.superseded_at is null limit 1),
      'waiting', (select count(*) from public.jobs j where j.site_id = s.id and j.status = 'awaiting_approval'),
      'escalated', (select count(*) from public.jobs j where j.site_id = s.id and j.status = 'escalated'),
      'active', (select count(*) from public.jobs j where j.site_id = s.id and j.status in ('queued', 'running', 'awaiting_review', 'authorized')),
      'requests', (select count(*) from public.submissions x where x.site_id = s.id and x.status in ('received', 'needs_clarification')),
      'spendToday', coalesce((select sum(c.usd) from public.job_costs c where c.site_id = s.id and c.at >= date_trunc('day', now())), 0),
      'spendMonth', coalesce((select sum(c.usd) from public.job_costs c where c.site_id = s.id and c.at >= date_trunc('month', now())), 0),
      'lastPlanned', (select t.ticked_at from public.god_site_ticks t where t.site_id = s.id),
      'lastError', (select t.outcome->>'error' from public.god_site_ticks t where t.site_id = s.id)
    ) order by s.name), '[]'::jsonb)
  from public.sites s where private.is_member(s.org_id);
$$;

-- Platform admins only: scheduler state, recent runs and usage.
create or replace function public.platform_health(p_days int default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'control', (select jsonb_build_object('paused', c.paused, 'reason', c.reason, 'updatedAt', c.updated_at, 'by', (select u.email from auth.users u where u.id = c.updated_by)) from public.god_control c where c.id = 1),
    'usage', public.god_usage(p_days),
    'runs', coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc) from (select id, runner, started_at, finished_at, sites_planned, jobs_run, jobs_recovered, invocations, subrequests, errors, paused from public.god_runs order by started_at desc limit 20) r), '[]'::jsonb),
    'lastRunAt', (select max(started_at) from public.god_runs),
    'sites', (select count(*) from public.sites), 'pausedSites', (select count(*) from public.sites where status = 'paused'));
end;
$$;

create or replace function public.set_platform_paused(p_paused boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'not allowed'; end if;
  update public.god_control set paused = p_paused, reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now(), updated_by = (select auth.uid()) where id = 1;
  return (select jsonb_build_object('paused', paused, 'reason', reason, 'updatedAt', updated_at) from public.god_control where id = 1);
end;
$$;

revoke all on function private.is_platform_admin(), public.agency_overview(), public.platform_health(int), public.set_platform_paused(boolean, text) from public, anon;
grant execute on function private.is_platform_admin() to authenticated;
grant execute on function public.agency_overview(), public.platform_health(int), public.set_platform_paused(boolean, text) to authenticated;
