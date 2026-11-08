-- SEO God scheduler support (R1-A2, D28): what the scheduler needs from the database to run every site on its own,
-- within a daily budget, with every cent recorded. Service role only (the worker); agency members can read their own
-- costs. Not applied anywhere.

-- Compact reports (the last audit summary) and agency settings live in site memory too.
alter table public.site_memory drop constraint if exists site_memory_kind_check;
alter table public.site_memory add constraint site_memory_kind_check
  check (kind in ('identity', 'brand', 'strategy', 'objective', 'decision', 'experiment', 'lesson', 'failure', 'question', 'answer', 'report', 'setting'));

-- One row per charge, so a day's spend is exact even when a job runs across midnight or is retried.
create table public.job_costs (
  id bigserial primary key,
  org_id uuid not null, site_id uuid not null references public.sites (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  usd numeric(10, 4) not null check (usd >= 0),
  note text,
  at timestamptz not null default now()
);
create index job_costs_site_at_idx on public.job_costs (site_id, at);
create trigger job_costs_same_org before insert or update of site_id, org_id on public.job_costs for each row execute function private.row_same_org();
alter table public.job_costs enable row level security;
create policy job_costs_select on public.job_costs for select to authenticated using ((select private.is_member(org_id)));

-- Sites the scheduler plans for: every site that is not paused by its agency.
create or replace function public.god_sites()
returns table (id uuid, org_id uuid, name text, url text, status text) language sql stable security definer set search_path = '' as $$
  select s.id, s.org_id, s.name, s.url, s.status from public.sites s where s.status <> 'paused' order by s.created_at;
$$;

-- A site's jobs that still matter to planning (open ones, plus the last 30 days of finished ones).
create or replace function public.site_jobs(p_site uuid)
returns setof public.jobs language sql stable security definer set search_path = '' as $$
  select * from public.jobs j where j.site_id = p_site
     and (j.status not in ('completed', 'cancelled', 'rejected') or j.updated_at > now() - interval '30 days')
   order by j.created_at;
$$;

-- What the handler produced (shown to the agency when it approves) and what it cost.
create or replace function public.record_job_output(p_job uuid, p_outputs jsonb, p_cost numeric default 0, p_note text default null)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  if coalesce(p_cost, 0) < 0 then raise exception 'cost cannot be negative'; end if;
  update public.jobs set outputs = coalesce(p_outputs, outputs), cost_usd = cost_usd + coalesce(p_cost, 0), updated_at = now()
   where id = p_job returning * into j;
  if j.id is null then raise exception 'job not found'; end if;
  if coalesce(p_cost, 0) > 0 then insert into public.job_costs (org_id, site_id, job_id, usd, note) values (j.org_id, j.site_id, j.id, p_cost, p_note); end if;
  return j;
end;
$$;

create or replace function public.site_spend(p_site uuid, p_since timestamptz)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(c.usd), 0) from public.job_costs c where c.site_id = p_site and c.at >= p_since;
$$;

revoke all on function public.god_sites(), public.site_jobs(uuid), public.record_job_output(uuid, jsonb, numeric, text), public.site_spend(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.god_sites(), public.site_jobs(uuid), public.record_job_output(uuid, jsonb, numeric, text), public.site_spend(uuid, timestamptz) to service_role;
