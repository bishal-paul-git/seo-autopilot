-- Daily digest and stale-data checks (decision D57). Approvals used to wait silently: a notification is dated by the
-- job's last change, so after the first day nothing reminded anyone. Once a day (the scheduler's first run after
-- 07:00 UTC) each agency gets a digest: work waiting for a person and for how long, stopped work, failures in the last
-- 24 hours, data freshness per website and yesterday's AI spend against the budget. It is stored, shown in the portal
-- as a notification when something needs attention, and so carried by the daily summary email when SMTP is set up.
-- Stale data (no Search Console snapshot in 48 hours for a connected website, no scan in 72 hours, URL inspection
-- refused) also appears in the agency's alerts and, for platform admins, on Operations.
-- Superseded copies of the large derived reports (snapshot, history, priorities, inspection, speed, analytics) are
-- pruned after 14 days in the same daily call: each day writes new copies, the current one is never touched, and the
-- `history` report already keeps the long-term trend. Audit copies are kept (the monthly work report reads them).

create table if not exists public.agency_digests (
  org_id uuid not null references public.orgs (id) on delete cascade,
  day date not null,
  digest jsonb not null,
  attention boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (org_id, day)
);
alter table public.agency_digests enable row level security; -- no policies: read only through the functions below
revoke all on public.agency_digests from public, anon, authenticated;

-- How fresh one website's data is, and what is stale. Service-side helper (no caller check: callers check membership).
create or replace function private.site_freshness(p_site uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (select x.id, x.status, x.url, x.gsc_allowed from public.sites x where x.id = p_site),
  r as (select m.key, m.value from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.superseded_at is null and m.key in ('search_console', 'audit', 'inspect', 'speed')),
  f as (
    select (select nullif(value->>'generatedAt', '')::timestamptz from r where key = 'search_console') sc_at,
           (select nullif(value->>'generatedAt', '')::timestamptz from r where key = 'audit') scan_at,
           (select nullif(value->>'generatedAt', '')::timestamptz from r where key = 'inspect') inspect_at,
           (select nullif(value->>'generatedAt', '')::timestamptz from r where key = 'speed') speed_at,
           (select value->'blocked' from r where key = 'inspect' and jsonb_typeof(value->'blocked') = 'object') inspect_blocked,
           exists (select 1 from public.google_bindings b where b.site_id = p_site and b.kind = 'gsc') or coalesce((select gsc_allowed from s), false) google)
  select jsonb_build_object('searchConsoleAt', f.sc_at, 'scanAt', f.scan_at, 'inspectAt', f.inspect_at, 'speedAt', f.speed_at, 'googleConnected', f.google,
      'inspectBlocked', f.inspect_blocked is not null,
      'stale', case when (select status from s) = 'paused' then '[]'::jsonb else to_jsonb(array_remove(array[
         case when f.google and (f.sc_at is null or f.sc_at < now() - interval '48 hours') then 'search_console' end,
         case when f.scan_at is null or f.scan_at < now() - interval '72 hours' then 'scan' end], null)) end)
  from f;
$$;
revoke all on function private.site_freshness(uuid) from public, anon, authenticated;

-- One agency's digest for today (service-side).
create or replace function private.agency_digest(p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with site as (
    select s.id, s.name, s.status, private.site_freshness(s.id) fresh,
      coalesce(s.daily_budget_usd, (select (t.outcome->>'budgetUsd')::numeric from public.god_site_ticks t where t.site_id = s.id)) budget,
      (select count(*) from public.jobs j where j.site_id = s.id and j.status = 'awaiting_approval') waiting,
      (select min(j.updated_at) from public.jobs j where j.site_id = s.id and j.status = 'awaiting_approval') waiting_since,
      (select count(*) from public.jobs j where j.site_id = s.id and j.status = 'escalated') escalated,
      (select count(distinct e.job_id) from public.job_events e join public.jobs j on j.id = e.job_id where j.site_id = s.id and e.to_status = 'failed' and e.at > now() - interval '24 hours') failed,
      coalesce((select sum(c.usd) from public.job_costs c where c.site_id = s.id and c.at >= date_trunc('day', now()) - interval '1 day' and c.at < date_trunc('day', now())), 0) spent_yesterday
    from public.sites s where s.org_id = p_org),
  tot as (
    select coalesce(sum(waiting), 0) waiting, min(waiting_since) waiting_since, coalesce(sum(escalated), 0) escalated, coalesce(sum(failed), 0) failed,
      count(*) filter (where jsonb_array_length(fresh->'stale') > 0) stale, count(*) filter (where (fresh->>'inspectBlocked')::boolean) inspect_blocked,
      coalesce(sum(spent_yesterday), 0) spent, count(*) filter (where budget is not null and spent_yesterday >= budget and budget > 0) at_budget, count(*) sites
    from site)
  select jsonb_build_object(
    'day', (now() at time zone 'utc')::date, 'generatedAt', now(),
    'totals', jsonb_build_object('sites', t.sites, 'waiting', t.waiting, 'oldestWaitingSince', t.waiting_since,
       'oldestWaitingDays', case when t.waiting_since is null then null else floor(extract(epoch from now() - t.waiting_since) / 86400)::int end,
       'escalated', t.escalated, 'failed24h', t.failed, 'staleSites', t.stale, 'inspectBlocked', t.inspect_blocked, 'spentYesterdayUsd', round(t.spent, 4), 'sitesAtBudget', t.at_budget),
    'attention', t.waiting > 0 or t.escalated > 0 or t.failed > 0 or t.stale > 0 or t.inspect_blocked > 0 or t.at_budget > 0,
    'title', concat_ws(', ',
       case when t.waiting > 0 then t.waiting || ' waiting for a decision' || case when t.waiting_since < now() - interval '1 day' then ' (oldest ' || floor(extract(epoch from now() - t.waiting_since) / 86400)::int || ' days)' else '' end end,
       case when t.escalated > 0 then t.escalated || ' stopped and need' || case when t.escalated = 1 then 's' else '' end || ' a person' end,
       case when t.failed > 0 then t.failed || ' failed in the last 24 hours' end,
       case when t.stale > 0 then t.stale || ' website' || case when t.stale = 1 then '' else 's' end || ' with stale data' end,
       case when t.inspect_blocked > 0 then 'URL inspection refused on ' || t.inspect_blocked end,
       '$' || to_char(round(t.spent, 2), 'FM999990.00') || ' AI spend yesterday' || case when t.at_budget > 0 then ' (' || t.at_budget || ' at budget)' else '' end),
    'sites', coalesce((select jsonb_agg(jsonb_build_object('site', x.id, 'siteName', x.name, 'status', x.status, 'waiting', x.waiting, 'waitingSince', x.waiting_since,
       'escalated', x.escalated, 'failed24h', x.failed, 'freshness', x.fresh, 'spentYesterdayUsd', round(x.spent_yesterday, 4), 'budgetUsd', x.budget) order by x.name) from site x), '[]'::jsonb))
  from tot t;
$$;
revoke all on function private.agency_digest(uuid) from public, anon, authenticated;

-- Scheduler (service role): record today's digest for every agency with websites, once a day, after p_after_hour UTC;
-- then prune old superseded derived reports. Safe to call on every run: later calls the same day do nothing.
create or replace function public.record_daily_digests(p_limit int default 50, p_after_hour int default 7)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_day date := (now() at time zone 'utc')::date; n int := 0; v_pruned int := 0; o record; d jsonb;
begin
  if extract(hour from now() at time zone 'utc') < coalesce(p_after_hour, 7) then return jsonb_build_object('recorded', 0, 'waiting', 'until ' || coalesce(p_after_hour, 7) || ':00 UTC'); end if;
  for o in select distinct s.org_id from public.sites s where not exists (select 1 from public.agency_digests g where g.org_id = s.org_id and g.day = v_day)
           limit greatest(least(coalesce(p_limit, 50), 500), 1) loop
    d := private.agency_digest(o.org_id);
    insert into public.agency_digests (org_id, day, digest, attention) values (o.org_id, v_day, d, coalesce((d->>'attention')::boolean, false)) on conflict (org_id, day) do nothing;
    n := n + 1;
  end loop;
  if n > 0 then
    with old as (select m.id from public.site_memory m where m.kind = 'report' and m.key in ('search_console', 'history', 'priorities', 'inspect', 'speed', 'analytics')
                   and m.superseded_at is not null and m.superseded_at < now() - interval '14 days' limit 5000)
    delete from public.site_memory m using old where m.id = old.id;
    get diagnostics v_pruned = row_count;
    delete from public.agency_digests where day < v_day - 90;
  end if;
  return jsonb_build_object('recorded', n, 'pruned', v_pruned);
end $$;

-- An agency member's recent digests (Operations), newest first.
create or replace function public.agency_digests(p_days int default 7)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('org', d.org_id, 'day', d.day, 'attention', d.attention, 'digest', d.digest) order by d.day desc), '[]'::jsonb)
  from public.agency_digests d where private.is_member(d.org_id) and d.day > (now() at time zone 'utc')::date - greatest(least(coalesce(p_days, 7), 90), 1);
$$;

-- Notifications (D38) gain the digest: one item per agency per day, dated when it was recorded, only when something
-- needs attention. Everything else is unchanged from 20261108120000_notifications_reports.sql.
create or replace function private.notifications_for(p_uid uuid)
returns table (kind text, site uuid, site_name text, title text, at timestamptz, page text)
language sql stable security definer set search_path = '' as $$
  with mine as (select s.id, s.name from public.sites s join public.org_members om on om.org_id = s.org_id and om.user_id = p_uid)
  select 'approval', j.site_id, m.name, j.title, j.updated_at, 'god' from public.jobs j join mine m on m.id = j.site_id where j.status = 'awaiting_approval'
  union all select 'stuck', j.site_id, m.name, j.title || coalesce(': ' || left(j.error, 120), ''), j.updated_at, 'god' from public.jobs j join mine m on m.id = j.site_id where j.status = 'escalated'
  union all select 'request', x.site_id, m.name, x.title, x.created_at, 'requests' from public.submissions x join mine m on m.id = x.site_id where x.status in ('received', 'needs_clarification')
  union all select case when j.status = 'completed' then 'verified' else 'change_failed' end, j.site_id, m.name, coalesce(j.outputs->'verification'->>'summary', j.title), j.updated_at, 'god'
    from public.jobs j join mine m on m.id = j.site_id where j.kind = 'implement' and j.status in ('completed', 'escalated') and j.updated_at > now() - interval '14 days'
  union all select 'integration', i.site_id, m.name, i.provider || ': ' || coalesce(i.last_error, 'not working'), coalesce(i.last_ok_at, i.created_at), 'god'
    from public.integrations i join mine m on m.id = i.site_id where i.status = 'error'
  union all select 'planning', t.site_id, m.name, 'Planning stopped: ' || left(t.outcome->>'error', 160), t.ticked_at, 'god'
    from public.god_site_ticks t join mine m on m.id = t.site_id where t.outcome->>'error' is not null
  union all select 'digest', null::uuid, coalesce(o.brand_name, o.name), d.digest->>'title', d.created_at, 'ops'
    from public.agency_digests d join public.orgs o on o.id = d.org_id join public.org_members om on om.org_id = d.org_id and om.user_id = p_uid
   where d.attention and d.created_at > now() - interval '3 days'
  union all select 'answer', x.site_id, s.name, x.title || ' · ' || replace(x.status, '_', ' '), x.decided_at, 'requests'
    from public.submissions x join public.sites s on s.id = x.site_id
   where x.submitted_by = p_uid and x.decided_at is not null and x.decided_at > now() - interval '30 days'
     and exists (select 1 from public.client_members cm where cm.client_id = s.client_id and cm.user_id = p_uid);
$$;
revoke all on function private.notifications_for(uuid) from public, anon, authenticated;

-- Alerts (D50) gain stale data and refused URL inspection per website. Everything else is unchanged from
-- 20261116000000_budgets_alerts.sql.
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
     where private.is_member(s.org_id) and t.outcome->>'error' is not null
    union all
    select jsonb_build_object('kind', 'stale_data', 'level', 'warn', 'site', f.id, 'siteName', f.name, 'stale', f.fresh->'stale', 'since', least((f.fresh->>'searchConsoleAt')::timestamptz, (f.fresh->>'scanAt')::timestamptz))
      from (select s.id, s.name, private.site_freshness(s.id) fresh from public.sites s where private.is_member(s.org_id) and s.status <> 'paused') f where jsonb_array_length(f.fresh->'stale') > 0
    union all
    select jsonb_build_object('kind', 'inspect_blocked', 'level', 'info', 'site', s.id, 'siteName', s.name)
      from public.sites s join public.site_memory m on m.site_id = s.id and m.kind = 'report' and m.key = 'inspect' and m.superseded_at is null
     where private.is_member(s.org_id) and jsonb_typeof(m.value->'blocked') = 'object') x), '[]'::jsonb);
end $$;

-- Platform health (D32) gains the websites with stale data across every agency (names only), for platform admins.
-- Everything else is unchanged from 20261108070000_operations.sql.
create or replace function public.platform_health(p_days int default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'control', (select jsonb_build_object('paused', c.paused, 'reason', c.reason, 'updatedAt', c.updated_at, 'by', (select u.email from auth.users u where u.id = c.updated_by)) from public.god_control c where c.id = 1),
    'usage', public.god_usage(p_days),
    'runs', coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc) from (select id, runner, started_at, finished_at, sites_planned, jobs_run, jobs_recovered, invocations, subrequests, errors, paused from public.god_runs order by started_at desc limit 20) r), '[]'::jsonb),
    'lastRunAt', (select max(started_at) from public.god_runs),
    'sites', (select count(*) from public.sites), 'pausedSites', (select count(*) from public.sites where status = 'paused'),
    'stale', coalesce((select jsonb_agg(jsonb_build_object('site', f.id, 'siteName', f.name, 'stale', f.fresh->'stale') order by f.name)
       from (select s.id, s.name, private.site_freshness(s.id) fresh from public.sites s where s.status <> 'paused') f where jsonb_array_length(f.fresh->'stale') > 0), '[]'::jsonb));
end;
$$;

revoke all on function public.record_daily_digests(int, int), public.agency_digests(int), public.ops_alerts(), public.platform_health(int) from public, anon, authenticated;
grant execute on function public.record_daily_digests(int, int) to service_role;
grant execute on function public.agency_digests(int), public.ops_alerts(), public.platform_health(int) to authenticated;
