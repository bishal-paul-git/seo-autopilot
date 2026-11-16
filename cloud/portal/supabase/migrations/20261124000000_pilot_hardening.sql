-- Pilot hardening (decision D62): fixes from the 2026-11-16 audits of the operating cycle, the agents and the portal.
-- Nothing here changes cron, the pause switches, budgets, automatic Google linking or the shared AI key.
--
-- 1. public.dismiss_job: an agency member closes work that stopped (escalated or failed) as cancelled, with an audit row,
--    so it no longer waits on anyone. Clients cannot.
-- 2. Website changes (kind 'implement') are authorized only by an agency approval: transition_job (the Worker) refuses to
--    authorize one, and create_job refuses the kind for anyone but the service role. request_implementation, the one
--    portal path that drafts a work order, now creates its job itself with the same checks as before.
-- 3. The pause switch, the run records and the platform admin list cannot be written by anon or signed-in users, even
--    if row level security were turned off by mistake (today "RLS on, no policy" is the only guard).
-- 4. A share link (shared_site) returns the same results-only snapshot as a signed-in client (client_sites).
-- 5. site_pipeline: the website scan is "connected" only when the last scan is newer than 72 hours ("No scan for N
--    days" after that), and the AI specialists show "off" while the scheduler is paused for every website.
-- 6. portfolio returns each website's real status (connecting, scanning, live, paused), not "live" for all of them.
-- 7. Run records: the Worker writes its god_runs row when a run starts (start_god_run) and completes it at the end
--    (record_god_run with the id), so a run stopped by a platform limit still leaves a row marked as not finished.

-- 1 -------------------------------------------------------------------------------------------------------------------
create or replace function public.dismiss_job(p_job uuid, p_note text default null)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not private.is_member(j.org_id) then raise exception 'not allowed'; end if;
  if j.status not in ('escalated', 'failed') then raise exception 'only stopped work (escalated or failed) can be dismissed'; end if;
  insert into public.audit_log (org_id, site_id, actor, action, target, data) values (j.org_id, j.site_id, (select auth.uid()), 'job.dismiss', j.id::text, jsonb_build_object('from', j.status, 'note', p_note));
  -- The lifecycle has no failed -> cancelled move: failed work goes through escalated, as it would on its own.
  if j.status = 'failed' then perform private.move_job(j.id, 'escalated', 'user', (select auth.uid())::text, 'dismissed by the agency'); end if;
  return private.move_job(j.id, 'cancelled', 'user', (select auth.uid())::text, coalesce(nullif(trim(coalesce(p_note, '')), ''), 'dismissed by the agency'));
end;
$$;
revoke all on function public.dismiss_job(uuid, text) from public, anon, authenticated;
grant execute on function public.dismiss_job(uuid, text) to authenticated;

-- 2 -------------------------------------------------------------------------------------------------------------------
create or replace function public.transition_job(p_job uuid, p_to text, p_actor text, p_note text default null, p_data jsonb default null)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job;
  -- Rejecting, authorizing gated work, deciding anything that waits for the agency (D35), and authorizing a website
  -- change (D62, whatever its handler returned) belong to the agency (approve_job).
  if p_to = 'rejected' or (p_to = 'authorized' and (j.requires_approval or j.status = 'awaiting_approval' or j.kind = 'implement')) then
    raise exception 'only an agency approval can authorize or reject';
  end if;
  return private.move_job(p_job, p_to, 'agent', p_actor, p_note, p_data);
end;
$$;
revoke all on function public.transition_job(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.transition_job(uuid, text, text, text, jsonb) to service_role;

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
  -- D62: a website change starts only from an accepted recommendation (request_implementation), never as a free job.
  if not is_service and p_kind = 'implement' then raise exception 'website changes start from an accepted recommendation (request_implementation)'; end if;
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

-- Unchanged from 20261108110000_github_execution.sql except that it creates the job itself (create_job now refuses the
-- kind for signed-in callers): same membership, status, recommendation and GitHub checks, same idempotency key, a free
-- medium-risk job whose result the agency approves before anything reaches GitHub.
create or replace function public.request_implementation(p_job uuid, p_index int)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare src public.jobs; rec jsonb; j public.jobs; v_key text;
begin
  select * into src from public.jobs where id = p_job;
  if src.id is null or not private.is_member(src.org_id) then raise exception 'not allowed'; end if;
  if src.status <> 'completed' then raise exception 'only accepted advice can be implemented'; end if;
  rec := src.outputs->'proposal'->'recommendations'->p_index;
  if rec is null or jsonb_typeof(rec) <> 'object' then raise exception 'no such recommendation'; end if;
  if not exists (select 1 from public.integrations i where i.site_id = src.site_id and i.provider = 'github' and i.scope = 'write' and i.status = 'connected') then
    raise exception 'connect GitHub for this website first';
  end if;
  v_key := 'implement:' || src.id::text || ':' || p_index::text;
  select * into j from public.jobs where site_id = src.site_id and idempotency_key = v_key;
  if j.id is not null then return j; end if;
  insert into public.jobs (org_id, site_id, kind, title, objective, source, priority, risk, requires_approval, inputs, idempotency_key, depends_on, budget_usd, created_by)
    values (src.org_id, src.site_id, 'implement', left('Implement: ' || coalesce(rec->>'title', 'recommendation'), 200), 'implement an accepted recommendation through the site''s GitHub workflow',
            'agency', 2, 'medium', false, jsonb_build_object('sourceJob', src.id, 'index', p_index, 'recommendation', rec), v_key, '{}', 0, (select auth.uid()))
    returning * into j;
  insert into public.job_events (job_id, org_id, actor_kind, actor, to_status, note) values (j.id, j.org_id, 'user', coalesce((select auth.uid())::text, 'service'), 'proposed', 'created');
  insert into public.audit_log (org_id, site_id, actor, action, target) values (j.org_id, j.site_id, (select auth.uid()), 'job.create', j.id::text);
  return j;
end $$;
revoke all on function public.request_implementation(uuid, int) from public, anon, authenticated;
grant execute on function public.request_implementation(uuid, int) to authenticated;

-- 3 -------------------------------------------------------------------------------------------------------------------
revoke insert, update, delete on public.god_control, public.god_runs, public.platform_admins from anon, authenticated;

-- 4 -------------------------------------------------------------------------------------------------------------------
-- Same fields removed as client_sites (r1_contracts): agent runs, the plan, issue links, drafts, proposals, candidates,
-- integration notes, the source and the internal digest.
create or replace function public.shared_site(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('site', jsonb_build_object('name', s.name, 'url', s.url, 'status', s.status, 'last_snapshot_at', s.last_snapshot_at),
    'brand', jsonb_build_object('name', coalesce(o.brand_name, o.name), 'color', o.brand_color),
    'data', (select x.data - array['runs', 'plan', 'planAt', 'issues', 'drafts', 'proposals', 'candidates', 'integrations', 'source', 'digest'] from public.site_snapshots x where x.site_id = s.id order by x.taken_at desc limit 1),
    'growth', private.growth(s.id))
  from public.share_links l join public.sites s on s.id = l.site_id join public.orgs o on o.id = s.org_id
  where l.token = p_token and l.revoked_at is null;
$$;

-- 5 -------------------------------------------------------------------------------------------------------------------
-- Unchanged from 20261119000000_daily_digest.sql except the scan's 72-hour rule and the AI specialists while paused.
create or replace function public.site_pipeline(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.sites; agency boolean; tok record; snap jsonb; rep record; sj record; tk record; v_last_run timestamptz;
  conns jsonb := '[]'::jsonb; integ jsonb; g record; v_scan_at timestamptz; v_god_paused boolean := public.god_paused();
begin
  select * into s from public.sites where id = p_site;
  if s.id is null then raise exception 'not allowed'; end if;
  agency := private.is_member(s.org_id);
  if not agency and not private.is_client_viewer(p_site) then raise exception 'not allowed'; end if;
  select t.last_used_at, t.created_at into tok from private.ingest_tokens t where t.site_id = p_site;
  select x.data into snap from public.site_snapshots x where x.site_id = p_site and tok.last_used_at is not null and x.taken_at <= tok.last_used_at order by x.taken_at desc limit 1;
  select m.value, m.created_at, m.source into rep from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'search_console' and m.superseded_at is null limit 1;
  select j.status, j.updated_at, (select left(e.note, 300) from public.job_events e where e.job_id = j.id order by e.at desc, e.id desc offset 1 limit 1) note
    into sj from public.jobs j where j.site_id = p_site and j.kind = 'search_snapshot' order by j.created_at desc limit 1;
  select t.ticked_at, t.outcome into tk from public.god_site_ticks t where t.site_id = p_site;
  v_last_run := (select max(r.started_at) from public.god_runs r);
  -- D62: the newest completed scan (or snapshot from the site's own run); older than 72 hours is stale, not connected.
  v_scan_at := greatest((select max(j.updated_at) from public.jobs j where j.site_id = p_site and j.kind = 'scan' and j.status = 'completed'), s.last_snapshot_at);
  select i.status, i.detail into g from public.integrations i where i.site_id = p_site and i.provider = 'google' and i.scope = 'read' and i.status in ('connected', 'error');

  -- Connections, each { key, name, state: connected | waiting | missing | error | off, detail, at }.
  conns := conns || jsonb_build_array(jsonb_build_object('key', 'scan', 'name', 'Website scan',
    'state', case when s.scan_state = 'failed' then 'error' when v_scan_at > now() - interval '72 hours' then 'connected'
                  when v_scan_at is not null or exists (select 1 from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'audit') then 'error' else 'waiting' end,
    'detail', case when s.scan_state = 'failed' then 'The last scan failed' || case when agency and s.scan_error is not null then ': ' || left(s.scan_error, 200) else '' end
                   when v_scan_at is not null and v_scan_at <= now() - interval '72 hours' then 'No scan for ' || extract(day from now() - v_scan_at)::int || ' days'
                   when v_scan_at is null and exists (select 1 from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'audit') then 'No recent scan'
                   else 'Reads every page: titles, links, speed, structured data' end,
    'at', v_scan_at));
  conns := conns || jsonb_build_array(jsonb_build_object('key', 'github', 'name', 'Daily SEO run (GitHub)',
    'state', case when s.repo is null then 'off' when tok.last_used_at > now() - interval '3 days' then 'connected' when tok.last_used_at is not null then 'error' else 'missing' end,
    'detail', case when s.repo is null then 'Not used for this website'
                   when tok.last_used_at > now() - interval '3 days' then 'Sends Search Console, indexing and keyword data every day'
                   when tok.last_used_at is not null then 'No data for more than 3 days'
                   when agency then 'Add SEO_PORTAL_URL and SEO_PORTAL_TOKEN to ' || s.repo || ' (Connection page)'
                   else 'Your SEO team is connecting it' end,
    'at', tok.last_used_at));
  conns := conns || jsonb_build_array(jsonb_build_object('key', 'search_console', 'name', 'Google Search Console',
    'state', case when rep.created_at > now() - interval '3 days' then 'connected' when g.status = 'error' or sj.status = 'escalated' then 'error'
                   when rep.created_at is not null or g.detail->>'gscProperty' is not null then 'waiting' else 'missing' end,
    'detail', case when rep.created_at is not null then coalesce(rep.value->'totals'->>'clicks', '0') || ' clicks, ' || coalesce(rep.value->'totals'->>'impressions', '0') || ' impressions in 28 days' ||
                     case when rep.value->>'source' = 'github' then ' (from the daily GitHub run)' else '' end
                   when g.status = 'error' then 'Search Console access was removed: add the email again and press Check access'
                   when sj.status = 'escalated' then case when agency then coalesce(sj.note, 'No access') else 'Waiting for access' end
                   when g.detail->>'gscProperty' is not null then 'Access given; the first read runs at the next planning'
                   when g.status = 'connected' then 'Choose the Search Console property on Connections'
                   when s.gsc_allowed then 'Waiting for the first read'
                   else 'Not connected yet' end,
    'at', rep.created_at));
  -- D56: Analytics for the bound GA4 property, and the weekly central speed check.
  conns := conns || coalesce((select jsonb_build_array(jsonb_build_object('key', 'analytics', 'name', 'Google Analytics 4',
      'state', case when m.created_at > now() - interval '3 days' then 'connected' else 'waiting' end,
      'detail', coalesce(m.value->'totals'->>'sessions', '0') || ' visits in 28 days', 'at', m.created_at))
    from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'analytics' and m.superseded_at is null limit 1),
    case when g.detail->>'ga4Property' is not null then jsonb_build_array(jsonb_build_object('key', 'analytics', 'name', 'Google Analytics 4', 'state', 'waiting',
      'detail', 'Access given; the first read runs at the next planning', 'at', null)) else '[]'::jsonb end);
  conns := conns || coalesce((select jsonb_build_array(jsonb_build_object('key', 'speed', 'name', 'Speed checks',
      'state', case when m.created_at > now() - interval '8 days' then 'connected' else 'waiting' end,
      'detail', 'Phone speed of ' || jsonb_array_length(coalesce(m.value->'pages', '[]'::jsonb)) || ' pages, checked every week', 'at', m.created_at))
    from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'speed' and m.superseded_at is null limit 1), '[]'::jsonb);
  -- What the website's own run reports about its other connections (Analytics, PageSpeed, IndexNow, Bing): no secrets.
  integ := case when jsonb_typeof(snap->'integrations') = 'array' then snap->'integrations' else '[]'::jsonb end;
  conns := conns || coalesce((select jsonb_agg(jsonb_build_object('key', 'run:' || lower(regexp_replace(i->>'name', '[^A-Za-z0-9]+', '-', 'g')),
      'name', left(i->>'name', 60), 'state', case when (i->>'ok')::boolean then 'connected' else 'missing' end,
      'detail', case when agency then left(coalesce(i->>'note', ''), 200) when (i->>'ok')::boolean then left(coalesce(i->>'note', ''), 200) else 'Not connected' end,
      'at', tok.last_used_at))
    from jsonb_array_elements(integ) i where jsonb_typeof(i) = 'object' and coalesce(i->>'name', '') <> '' and i->>'name' not in ('Google Search Console', 'AI agents')
      and not (i->>'name' = 'Google Analytics 4' and g.detail->>'ga4Property' is not null)), '[]'::jsonb);
  conns := conns || jsonb_build_array(jsonb_build_object('key', 'agents', 'name', 'AI specialists',
    'state', case when s.status = 'paused' or v_god_paused then 'off' when v_last_run > now() - interval '150 minutes' then 'connected' else 'error' end,
    'detail', case when s.status = 'paused' then 'Paused for this website'
                   when v_god_paused then 'Paused for every website: no specialist runs until it is switched back on'
                   else 'The SEO director plans every few hours; specialists run within the daily budget' end,
    'at', tk.ticked_at));

  return jsonb_build_object(
    'site', jsonb_build_object('id', s.id, 'name', s.name, 'url', s.url, 'status', s.status, 'repo', case when agency then s.repo end),
    'agency', agency,
    'schedule', jsonb_build_object('everyMinutes', 60, 'lastRun', v_last_run, 'paused', v_god_paused or s.status = 'paused',
      'lastPlanned', tk.ticked_at, 'nextPlan', tk.ticked_at + interval '6 hours',
      'strategy', (select m.value->>'status' from public.site_memory m where m.site_id = p_site and m.kind = 'strategy' and m.key = 'initial' and m.superseded_at is null limit 1),
      'budgetUsd', case when agency then coalesce((tk.outcome->>'budgetUsd')::numeric, s.daily_budget_usd) end,
      'spentTodayUsd', case when agency then coalesce((select sum(c.usd) from public.job_costs c where c.site_id = p_site and c.at >= date_trunc('day', now())), 0) end),
    'connections', conns,
    'counts', jsonb_build_object(
      'active', (select count(*) from public.jobs j where j.site_id = p_site and j.status in ('queued', 'running', 'awaiting_review', 'authorized')),
      'waiting', (select count(*) from public.jobs j where j.site_id = p_site and j.status = 'awaiting_approval'),
      'stopped', (select count(*) from public.jobs j where j.site_id = p_site and j.status = 'escalated'),
      'done30', (select count(*) from public.jobs j where j.site_id = p_site and j.status = 'completed' and j.updated_at > now() - interval '30 days'),
      'reviews30', (select count(*) from public.reviews r join public.jobs j on j.id = r.job_id where j.site_id = p_site and r.created_at > now() - interval '30 days'),
      'passed30', (select count(*) from public.reviews r join public.jobs j on j.id = r.job_id where j.site_id = p_site and r.verdict = 'pass' and r.created_at > now() - interval '30 days')),
    -- Every agent that has worked on this site: its latest run and how many in 30 days.
    'agents', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('agent', coalesce(j.agent, substring(j.kind from '^agent:(seo-[a-z0-9-]+)$')), 'status', (array_agg(j.status order by j.updated_at desc))[1],
          'title', left((array_agg(j.title order by j.updated_at desc))[1], 160), 'at', max(j.updated_at),
          'runs30', count(*) filter (where j.created_at > now() - interval '30 days')) x
        from public.jobs j where j.site_id = p_site and coalesce(j.agent, substring(j.kind from '^agent:(seo-[a-z0-9-]+)$')) is not null group by coalesce(j.agent, substring(j.kind from '^agent:(seo-[a-z0-9-]+)$'))) t), '[]'::jsonb),
    -- Work in progress and the latest steps, newest first: the live view.
    'live', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('agent', coalesce(j.agent, substring(j.kind from '^agent:(seo-[a-z0-9-]+)$')), 'kind', j.kind, 'title', left(j.title, 160), 'status', j.status, 'at', j.updated_at) x
        from public.jobs j where j.site_id = p_site and j.status in ('queued', 'running', 'awaiting_review', 'authorized', 'awaiting_approval', 'escalated')
        order by j.updated_at desc limit 20) t), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('at', e.at, 'agent', coalesce(j.agent, substring(j.kind from '^agent:(seo-[a-z0-9-]+)$')), 'kind', j.kind, 'title', left(j.title, 120), 'to', e.to_status,
          'note', case when agency then left(e.note, 200) end) x
        from public.job_events e join public.jobs j on j.id = e.job_id where j.site_id = p_site order by e.at desc, e.id desc limit 25) t), '[]'::jsonb));
end $$;

-- 6 -------------------------------------------------------------------------------------------------------------------
-- Unchanged from 20261120000000_portfolio_scorecard.sql except 'status' (the site's own status).
create or replace function public.portfolio(p_site uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_rows jsonb; v_card jsonb := null;
begin
  if v_uid is null then raise exception 'not allowed'; end if;
  if p_site is not null and not exists (select 1 from public.sites s where s.id = p_site and private.is_member(s.org_id)) then raise exception 'not allowed'; end if;
  with site as (
    select s.id, s.name, s.url, s.status, s.org_id, coalesce(o.brand_name, o.name) agency
      from public.sites s join public.orgs o on o.id = s.org_id
     where private.is_member(s.org_id) and (p_site is null or s.id = p_site)),
  mem as (
    select x.id,
      (select m.value from public.site_memory m where m.site_id = x.id and m.kind = 'report' and m.key = 'search_console' and m.superseded_at is null limit 1) sc,
      (select m.value->'daily' from public.site_memory m where m.site_id = x.id and m.kind = 'report' and m.key = 'history' and m.superseded_at is null and jsonb_typeof(m.value->'daily') = 'object' limit 1) daily,
      (select m.value from public.site_memory m where m.site_id = x.id and m.kind = 'report' and m.key = 'inspect' and m.superseded_at is null limit 1) insp
    from site x),
  -- Like-for-like: the 28 days ending on the snapshot's last day against the 28 days before, from the daily totals.
  win as (
    select m.id, (m.sc->>'to')::date to_day,
      coalesce((select jsonb_build_object(
          'cur', sum((d.value->>0)::numeric) filter (where d.key::date between (m.sc->>'to')::date - 27 and (m.sc->>'to')::date),
          'curDays', count(*) filter (where d.key::date between (m.sc->>'to')::date - 27 and (m.sc->>'to')::date),
          'prev', sum((d.value->>0)::numeric) filter (where d.key::date between (m.sc->>'to')::date - 55 and (m.sc->>'to')::date - 28),
          'prevDays', count(*) filter (where d.key::date between (m.sc->>'to')::date - 55 and (m.sc->>'to')::date - 28))
        from jsonb_each(m.daily) d where d.key ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' and jsonb_typeof(d.value) = 'array'), '{}'::jsonb) w
    from mem m where coalesce(m.sc->>'to', '') ~ '^\d{4}-\d{2}-\d{2}$' and m.daily is not null),
  base as (
    select x.*, m.sc, m.insp, w.w,
      private.site_freshness(x.id) fresh,
      (select count(*) from public.jobs j where j.site_id = x.id and j.status = 'awaiting_approval') waiting,
      (select min(j.updated_at) from public.jobs j where j.site_id = x.id and j.status = 'awaiting_approval') waiting_since,
      (select count(*) from public.jobs j where j.site_id = x.id and j.status = 'escalated') escalated,
      coalesce((select sum(c.usd) from public.job_costs c where c.site_id = x.id and c.at > now() - interval '7 days'), 0) spend7,
      (select t.outcome from public.god_site_ticks t where t.site_id = x.id) tick,
      (select jsonb_build_object(
          'win', count(*) filter (where coalesce(m.value->>'label', 'too_early') = 'win'),
          'loss', count(*) filter (where m.value->>'label' = 'loss'),
          'flat', count(*) filter (where m.value->>'label' = 'flat'),
          'tooEarly', count(*) filter (where coalesce(m.value->>'label', 'too_early') = 'too_early'),
          'notEnoughData', count(*) filter (where m.value->>'label' = 'not_enough_data'))
        from public.site_memory m where m.site_id = x.id and m.kind = 'scorecard' and m.superseded_at is null and m.value->>'supersededBy' is null) card,
      (select count(*) from jsonb_each(case when jsonb_typeof(m.insp->'results') = 'object' then m.insp->'results' else '{}'::jsonb end) r
        where coalesce(r.value->>'verdict', '') <> 'PASS' and coalesce(r.value->>'coverage', '') !~* '^(submitted and indexed|indexed, not submitted)'
          and coalesce(r.value->>'coverage', '') !~* 'redirect|alternate') not_indexed,
      (select count(*) from jsonb_object_keys(case when jsonb_typeof(m.insp->'results') = 'object' then m.insp->'results' else '{}'::jsonb end)) inspected
    from site x join mem m on m.id = x.id left join win w on w.id = x.id),
  calc as (
    select r.*,
      case when (r.w->>'curDays')::int >= 24 and (r.w->>'prevDays')::int >= 24 and (r.w->>'prev')::numeric > 0
           then round(((r.w->>'cur')::numeric - (r.w->>'prev')::numeric) / (r.w->>'prev')::numeric, 3) end clicks_change,
      case when jsonb_typeof(r.tick->'alerts') = 'array' then jsonb_array_length(r.tick->'alerts') else 0 end alerts,
      r.tick->>'error' plan_error
    from base r),
  scored as (
    select c.*, array_remove(array[
        case when c.escalated > 0 then c.escalated || ' stopped and need' || case when c.escalated = 1 then 's' else '' end || ' a person' end,
        case when c.plan_error is not null then 'planning failed' end,
        case when c.alerts > 0 then c.alerts || ' alert' || case when c.alerts = 1 then '' else 's' end || ' today' end,
        case when jsonb_array_length(c.fresh->'stale') > 0 then 'stale data' end,
        case when c.clicks_change <= -0.2 then 'clicks down ' || round(-c.clicks_change * 100) || '%' end,
        case when (c.card->>'loss')::int > 0 then (c.card->>'loss') || ' change' || case when (c.card->>'loss')::int = 1 then '' else 's' end || ' lost traffic' end,
        case when c.waiting > 0 then c.waiting || ' waiting for approval' end,
        case when c.not_indexed > 0 then c.not_indexed || ' page' || case when c.not_indexed = 1 then '' else 's' end || ' not indexed' end,
        case when (c.fresh->>'inspectBlocked')::boolean then 'index status refused' end], null) reasons,
      -- Weights: work that is stuck or broken first, then traffic falling, then decisions waiting, then index gaps.
      (case when c.escalated > 0 then 40 else 0 end) + (case when c.plan_error is not null then 30 else 0 end) + least(c.alerts, 3) * 15
        + (case when jsonb_array_length(c.fresh->'stale') > 0 then 12 else 0 end) + (case when c.clicks_change <= -0.2 then 20 else 0 end)
        + least((c.card->>'loss')::int, 3) * 5 + least(c.waiting, 5) * 4 + (case when c.waiting_since < now() - interval '3 days' then 6 else 0 end)
        + least(c.not_indexed, 10) + (case when (c.fresh->>'inspectBlocked')::boolean then 2 else 0 end) score
    from calc c)
  select coalesce(jsonb_agg(jsonb_build_object(
      'site', s.id, 'name', s.name, 'url', s.url, 'agency', s.agency, 'status', s.status,
      'clicks28', (s.sc->'totals'->>'clicks')::numeric, 'impressions28', (s.sc->'totals'->>'impressions')::numeric,
      'searchTo', s.sc->>'to', 'searchAt', s.sc->>'generatedAt', 'property', s.sc->>'property',
      'clicksNow', (s.w->>'cur')::numeric, 'clicksBefore', (s.w->>'prev')::numeric, 'clicksChange', s.clicks_change,
      'notIndexed', case when s.inspected > 0 then s.not_indexed end, 'inspected', s.inspected, 'inspectBlocked', coalesce((s.fresh->>'inspectBlocked')::boolean, false),
      'stale', s.fresh->'stale', 'alerts', s.alerts, 'planError', left(s.plan_error, 200), 'escalated', s.escalated,
      'waiting', s.waiting, 'waitingSince', s.waiting_since, 'spend7Usd', round(s.spend7, 4),
      'scorecard', s.card, 'attention', case when s.status = 'paused' then 0 else s.score end, 'reasons', to_jsonb(s.reasons))
    order by (s.status = 'paused'), case when s.status = 'paused' then 0 else s.score end desc, s.name), '[]'::jsonb)
  into v_rows from scored s;

  if p_site is not null then
    select coalesce(jsonb_agg(m.value || jsonb_build_object('key', m.key) order by m.value->>'changedAt' desc, m.key), '[]'::jsonb) into v_card
      from (select m.key, m.value from public.site_memory m where m.site_id = p_site and m.kind = 'scorecard' and m.superseded_at is null
             order by m.value->>'changedAt' desc limit 100) m;
  end if;
  return jsonb_build_object('generatedAt', now(), 'sites', v_rows) || case when v_card is null then '{}'::jsonb else jsonb_build_object('scorecard', v_card) end;
end $$;
revoke all on function public.portfolio(uuid) from public, anon, authenticated;
grant execute on function public.portfolio(uuid) to authenticated;

-- 7 -------------------------------------------------------------------------------------------------------------------
-- A row without finished_at is a run that started and has not recorded its end (still running, or stopped by a limit).
alter table public.god_runs alter column finished_at drop not null;

create or replace function public.start_god_run(p_run jsonb)
returns bigint language sql security definer set search_path = '' as $$
  insert into public.god_runs (runner, started_at, finished_at, errors)
  values (left(coalesce(p_run->>'runner', 'unknown'), 80), coalesce((p_run->>'startedAt')::timestamptz, now()), null,
          '["the run started but did not record its end (stopped by a platform limit?)"]'::jsonb)
  returning id;
$$;

-- With an id from start_god_run: completes that row (once). Without one (or an unknown id): inserts the whole run, as before.
create or replace function public.record_god_run(p_run jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if p_run ? 'id' then
    update public.god_runs set finished_at = now(), sites_planned = coalesce((p_run->>'sitesPlanned')::int, 0), jobs_run = coalesce((p_run->>'jobsRun')::int, 0),
           jobs_recovered = coalesce((p_run->>'jobsRecovered')::int, 0), invocations = coalesce((p_run->>'invocations')::int, 0),
           subrequests = coalesce((p_run->>'subrequests')::int, 0), errors = coalesce(p_run->'errors', '[]'::jsonb), paused = coalesce((p_run->>'paused')::boolean, false)
     where id = (p_run->>'id')::bigint and finished_at is null returning id into v_id;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.god_runs (runner, started_at, finished_at, sites_planned, jobs_run, jobs_recovered, invocations, subrequests, errors, paused)
  values (left(coalesce(p_run->>'runner', 'unknown'), 80), coalesce((p_run->>'startedAt')::timestamptz, now()), now(), coalesce((p_run->>'sitesPlanned')::int, 0),
          coalesce((p_run->>'jobsRun')::int, 0), coalesce((p_run->>'jobsRecovered')::int, 0), coalesce((p_run->>'invocations')::int, 0),
          coalesce((p_run->>'subrequests')::int, 0), coalesce(p_run->'errors', '[]'::jsonb), coalesce((p_run->>'paused')::boolean, false))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.start_god_run(jsonb), public.record_god_run(jsonb) from public, anon, authenticated;
grant execute on function public.start_god_run(jsonb), public.record_god_run(jsonb) to service_role;
