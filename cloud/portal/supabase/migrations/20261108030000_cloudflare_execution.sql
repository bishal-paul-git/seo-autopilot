-- Cloudflare execution support (D30). The Cloudflare Worker is a stateless scheduler and dispatcher; everything durable
-- stays here: which sites are due, a pause switch that works without a redeploy, recovery of jobs whose Worker died,
-- and one row per scheduler run for monitoring and free-tier usage. Service role only. Not applied anywhere.

-- Pause switch, read by every scheduler run: pausing needs no deploy and no access to Cloudflare.
create table public.god_control (
  id int primary key default 1 check (id = 1),
  paused boolean not null default false,
  reason text,
  updated_at timestamptz not null default now()
);
insert into public.god_control (id) values (1);

-- When the scheduler last planned each site, so planning rotates through all sites within the request limits.
create table public.god_site_ticks (
  site_id uuid primary key references public.sites (id) on delete cascade,
  org_id uuid not null,
  ticked_at timestamptz not null default now(),
  outcome jsonb
);
create trigger god_site_ticks_same_org before insert or update of site_id, org_id on public.god_site_ticks for each row execute function private.row_same_org();

-- One row per scheduler run: what it did and what it used, for monitoring and the free-tier dashboard.
create table public.god_runs (
  id bigserial primary key,
  runner text not null check (length(runner) between 1 and 80),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  sites_planned int not null default 0,
  jobs_run int not null default 0,
  jobs_recovered int not null default 0,
  invocations int not null default 0,     -- Worker invocations this run caused (itself and its fan-out)
  subrequests int not null default 0,     -- outbound requests the run made (Supabase, providers)
  errors jsonb not null default '[]',
  paused boolean not null default false
);
create index god_runs_started_idx on public.god_runs (started_at desc);

alter table public.god_control enable row level security;
alter table public.god_site_ticks enable row level security;
alter table public.god_runs enable row level security;
-- Agency members may see when their own sites were last planned; nothing else here is readable outside the service role.
create policy god_site_ticks_select on public.god_site_ticks for select to authenticated using ((select private.is_member(org_id)));

create or replace function public.god_paused()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select paused from public.god_control where id = 1), true); -- missing row: stay paused
$$;

create or replace function public.set_god_paused(p_paused boolean, p_reason text default null)
returns boolean language sql security definer set search_path = '' as $$
  update public.god_control set paused = p_paused, reason = p_reason, updated_at = now() where id = 1 returning paused;
$$;

-- Sites to plan in this run: any site with an agency decision to carry out first, then the least recently planned,
-- skipping sites planned within p_min_age. Paused sites are never returned.
create or replace function public.god_due_sites(p_limit int default 5, p_min_age interval default interval '6 hours')
returns table (id uuid, org_id uuid, name text, url text) language sql stable security definer set search_path = '' as $$
  select s.id, s.org_id, s.name, s.url from public.sites s
    left join public.god_site_ticks t on t.site_id = s.id
   where s.status <> 'paused'
     and (t.ticked_at is null or t.ticked_at < now() - p_min_age
          or exists (select 1 from public.jobs j where j.site_id = s.id and j.status = 'authorized'))
   order by exists (select 1 from public.jobs j where j.site_id = s.id and j.status = 'authorized') desc, t.ticked_at nulls first, s.created_at
   limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.record_site_tick(p_site uuid, p_outcome jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.god_site_ticks (site_id, org_id, ticked_at, outcome) values (p_site, private.site_org(p_site), now(), p_outcome)
  on conflict (site_id) do update set ticked_at = now(), outcome = excluded.outcome;
$$;

-- A Worker can be killed mid-job (CPU limit, deploy, crash). Jobs still "running" after their lease are failed through
-- the normal path, so they retry within the cap or escalate; nothing stays stuck and nothing runs twice at once.
create or replace function public.reap_expired_leases(p_limit int default 20)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.jobs where status = 'running' and lease_until < now() order by lease_until limit least(greatest(p_limit, 1), 100) for update skip locked loop
    perform public.fail_job(r.id, 'reaper', 'lease expired: the worker stopped before finishing');
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.record_god_run(p_run jsonb)
returns bigint language sql security definer set search_path = '' as $$
  insert into public.god_runs (runner, started_at, sites_planned, jobs_run, jobs_recovered, invocations, subrequests, errors, paused)
  values (left(coalesce(p_run->>'runner', 'unknown'), 80), coalesce((p_run->>'startedAt')::timestamptz, now()), coalesce((p_run->>'sitesPlanned')::int, 0),
          coalesce((p_run->>'jobsRun')::int, 0), coalesce((p_run->>'jobsRecovered')::int, 0), coalesce((p_run->>'invocations')::int, 0),
          coalesce((p_run->>'subrequests')::int, 0), coalesce(p_run->'errors', '[]'::jsonb), coalesce((p_run->>'paused')::boolean, false))
  returning id;
$$;

-- Free-tier usage for the last p_days, from the runs themselves (the Cloudflare dashboard remains the authority).
create or replace function public.god_usage(p_days int default 1)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('runs', count(*), 'invocations', coalesce(sum(invocations), 0), 'subrequests', coalesce(sum(subrequests), 0),
    'jobsRun', coalesce(sum(jobs_run), 0), 'sitesPlanned', coalesce(sum(sites_planned), 0), 'jobsRecovered', coalesce(sum(jobs_recovered), 0),
    'runsWithErrors', count(*) filter (where jsonb_array_length(errors) > 0), 'since', now() - make_interval(days => p_days))
  from public.god_runs where started_at > now() - make_interval(days => least(greatest(p_days, 1), 90));
$$;

grant select, insert, update, delete on public.god_control, public.god_site_ticks, public.god_runs to service_role;
grant usage on all sequences in schema public to service_role;
revoke all on function public.god_paused(), public.set_god_paused(boolean, text), public.god_due_sites(int, interval), public.record_site_tick(uuid, jsonb),
  public.reap_expired_leases(int), public.record_god_run(jsonb), public.god_usage(int) from public, anon, authenticated;
grant execute on function public.god_paused(), public.set_god_paused(boolean, text), public.god_due_sites(int, interval), public.record_site_tick(uuid, jsonb),
  public.reap_expired_leases(int), public.record_god_run(jsonb), public.god_usage(int) to service_role;
