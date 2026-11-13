-- D54 fix: production jobs keep the specialist's name in the job kind ("agent:seo-reporter") and leave jobs.agent empty,
-- so site_pipeline listed no specialists. The agent is now taken from either. Same function otherwise.
create or replace function public.site_pipeline(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.sites; agency boolean; tok record; snap jsonb; rep record; sj record; tk record; v_last_run timestamptz;
  conns jsonb := '[]'::jsonb; integ jsonb;
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

  -- Connections, each { key, name, state: connected | waiting | missing | error | off, detail, at }.
  conns := conns || jsonb_build_array(jsonb_build_object('key', 'scan', 'name', 'Website scan',
    'state', case when s.scan_state = 'failed' then 'error' when s.last_snapshot_at is not null or exists (select 1 from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'audit') then 'connected' else 'waiting' end,
    'detail', case when s.scan_state = 'failed' then 'The last scan failed' || case when agency and s.scan_error is not null then ': ' || left(s.scan_error, 200) else '' end
                   else 'Reads every page: titles, links, speed, structured data' end,
    'at', (select max(j.updated_at) from public.jobs j where j.site_id = p_site and j.kind = 'scan' and j.status = 'completed')));
  conns := conns || jsonb_build_array(jsonb_build_object('key', 'github', 'name', 'Daily SEO run (GitHub)',
    'state', case when s.repo is null then 'off' when tok.last_used_at > now() - interval '3 days' then 'connected' when tok.last_used_at is not null then 'error' else 'missing' end,
    'detail', case when s.repo is null then 'Not used for this website'
                   when tok.last_used_at > now() - interval '3 days' then 'Sends Search Console, indexing and keyword data every day'
                   when tok.last_used_at is not null then 'No data for more than 3 days'
                   when agency then 'Add SEO_PORTAL_URL and SEO_PORTAL_TOKEN to ' || s.repo || ' (Connection page)'
                   else 'Your SEO team is connecting it' end,
    'at', tok.last_used_at));
  conns := conns || jsonb_build_array(jsonb_build_object('key', 'search_console', 'name', 'Google Search Console',
    'state', case when rep.created_at > now() - interval '3 days' then 'connected' when sj.status = 'escalated' then 'error' when rep.created_at is not null then 'waiting' else 'missing' end,
    'detail', case when rep.created_at is not null then coalesce(rep.value->'totals'->>'clicks', '0') || ' clicks, ' || coalesce(rep.value->'totals'->>'impressions', '0') || ' impressions in 28 days' ||
                     case when rep.value->>'source' = 'github' then ' (from the daily GitHub run)' else '' end
                   when sj.status = 'escalated' then case when agency then coalesce(sj.note, 'No access') else 'Waiting for access' end
                   when s.gsc_allowed then 'Waiting for the first read'
                   else 'Not connected yet' end,
    'at', rep.created_at));
  -- What the website's own run reports about its other connections (Analytics, PageSpeed, IndexNow, Bing): no secrets.
  integ := case when jsonb_typeof(snap->'integrations') = 'array' then snap->'integrations' else '[]'::jsonb end;
  conns := conns || coalesce((select jsonb_agg(jsonb_build_object('key', 'run:' || lower(regexp_replace(i->>'name', '[^A-Za-z0-9]+', '-', 'g')),
      'name', left(i->>'name', 60), 'state', case when (i->>'ok')::boolean then 'connected' else 'missing' end,
      'detail', case when agency then left(coalesce(i->>'note', ''), 200) when (i->>'ok')::boolean then left(coalesce(i->>'note', ''), 200) else 'Not connected' end,
      'at', tok.last_used_at))
    from jsonb_array_elements(integ) i where jsonb_typeof(i) = 'object' and coalesce(i->>'name', '') <> '' and i->>'name' not in ('Google Search Console', 'AI agents')), '[]'::jsonb);
  conns := conns || jsonb_build_array(jsonb_build_object('key', 'agents', 'name', 'AI specialists',
    'state', case when s.status = 'paused' then 'off' when v_last_run > now() - interval '40 minutes' then 'connected' else 'error' end,
    'detail', case when s.status = 'paused' then 'Paused for this website'
                   else 'The SEO director plans every few hours; specialists run within the daily budget' end,
    'at', tk.ticked_at));

  return jsonb_build_object(
    'site', jsonb_build_object('id', s.id, 'name', s.name, 'url', s.url, 'status', s.status, 'repo', case when agency then s.repo end),
    'agency', agency,
    'schedule', jsonb_build_object('everyMinutes', 15, 'lastRun', v_last_run, 'paused', public.god_paused() or s.status = 'paused',
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

revoke all on function public.site_pipeline(uuid) from public, anon, authenticated;
grant execute on function public.site_pipeline(uuid) to authenticated;
