-- Phase 7 of docs/product/SYSTEM-READINESS-PLAN.md (D50): a daily AI budget per website set by the agency owner, the
-- budget and spend in the agency overview, and alerts for what needs a person. No change to approvals or jobs.

-- Per-site daily AI budget in US dollars. Null = the platform default (the Worker's SEO_GOD_DAILY_BUDGET_USD).
alter table public.sites add column if not exists daily_budget_usd numeric(8, 2)
  check (daily_budget_usd is null or (daily_budget_usd >= 0 and daily_budget_usd <= 100));

-- Agency owners only; null resets to the default. Audited.
create or replace function public.set_site_budget(p_site uuid, p_usd numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site);
begin
  if v_org is null or not private.is_owner(v_org) then raise exception 'not allowed'; end if;
  if p_usd is not null and (p_usd < 0 or p_usd > 100) then raise exception 'the daily budget must be between 0 and 100 US dollars'; end if;
  update public.sites set daily_budget_usd = round(p_usd, 2) where id = p_site;
  insert into public.audit_log (org_id, site_id, actor, action, target) values (v_org, p_site, (select auth.uid()), 'site.budget', coalesce(round(p_usd, 2)::text, 'default'));
  return jsonb_build_object('site', p_site, 'dailyBudgetUsd', round(p_usd, 2));
end $$;

-- The scheduler's lookup (service role only): the site's own budget, or null for the default.
create or replace function public.god_site_budget(p_site uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select s.daily_budget_usd from public.sites s where s.id = p_site;
$$;

-- The overview gains each site's budget (null = default) and the budget the scheduler last applied.
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
      'spendLastMonth', coalesce((select sum(c.usd) from public.job_costs c where c.site_id = s.id and c.at >= date_trunc('month', now()) - interval '1 month' and c.at < date_trunc('month', now())), 0),
      'budgetUsd', s.daily_budget_usd,
      'appliedBudgetUsd', (select (t.outcome->>'budgetUsd')::numeric from public.god_site_ticks t where t.site_id = s.id),
      'canSetBudget', private.is_owner(s.org_id),
      'lastPlanned', (select t.ticked_at from public.god_site_ticks t where t.site_id = s.id),
      'lastError', (select t.outcome->>'error' from public.god_site_ticks t where t.site_id = s.id)
    ) order by s.name), '[]'::jsonb)
  from public.sites s where private.is_member(s.org_id);
$$;

-- What needs a person, for the caller's agencies (and the scheduler's heartbeat, shown without other tenants' detail).
-- kinds: scheduler_silent, scheduler_errors, waiting_long, escalated, budget_hit, plan_error.
create or replace function public.ops_alerts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_last timestamptz := (select max(r.started_at) from public.god_runs r); out jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.org_members m where m.user_id = (select auth.uid())) and not private.is_platform_admin() then return out; end if;
  if not public.god_paused() and (v_last is null or v_last < now() - interval '40 minutes') then
    out := out || jsonb_build_array(jsonb_build_object('kind', 'scheduler_silent', 'level', 'bad', 'since', v_last)); end if;
  if (select count(*) from (select r.errors from public.god_runs r order by r.id desc limit 4) x where jsonb_array_length(x.errors) > 0) >= 3 then
    out := out || jsonb_build_array(jsonb_build_object('kind', 'scheduler_errors', 'level', 'warn')); end if;
  return out || coalesce((select jsonb_agg(a) from (
    select jsonb_build_object('kind', 'waiting_long', 'level', 'warn', 'site', s.id, 'siteName', s.name, 'count', count(*), 'since', min(j.updated_at)) a
      from public.sites s join public.jobs j on j.site_id = s.id
     where private.is_member(s.org_id) and s.status <> 'paused' and j.status = 'awaiting_approval' and j.updated_at < now() - interval '3 days' group by s.id, s.name
    union all
    select jsonb_build_object('kind', 'escalated', 'level', 'bad', 'site', s.id, 'siteName', s.name, 'count', count(*), 'since', min(j.updated_at))
      from public.sites s join public.jobs j on j.site_id = s.id
     where private.is_member(s.org_id) and j.status = 'escalated' group by s.id, s.name
    union all
    select jsonb_build_object('kind', 'budget_hit', 'level', 'info', 'site', s.id, 'siteName', s.name, 'count', (t.outcome->>'deferredForBudget')::int, 'budgetUsd', t.outcome->'budgetUsd', 'since', t.ticked_at)
      from public.sites s join public.god_site_ticks t on t.site_id = s.id
     where private.is_member(s.org_id) and t.ticked_at >= date_trunc('day', now()) and coalesce((t.outcome->>'deferredForBudget')::int, 0) > 0
    union all
    select jsonb_build_object('kind', 'plan_error', 'level', 'bad', 'site', s.id, 'siteName', s.name, 'error', left(t.outcome->>'error', 200), 'since', t.ticked_at)
      from public.sites s join public.god_site_ticks t on t.site_id = s.id
     where private.is_member(s.org_id) and t.outcome->>'error' is not null) x), '[]'::jsonb);
end $$;

revoke all on function public.set_site_budget(uuid, numeric), public.god_site_budget(uuid), public.ops_alerts() from public, anon, authenticated;
grant execute on function public.set_site_budget(uuid, numeric), public.ops_alerts() to authenticated;
grant execute on function public.god_site_budget(uuid) to service_role;
