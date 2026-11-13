-- D54: the live pipeline and connections pages, and the bridge from each website's own GitHub run to the agents.
-- 1. A daily snapshot pushed from a website's GitHub run (seo-daily, `portal --push`) no longer un-pauses a paused site:
--    the owner pauses sites to stop the hosted agents spending, and a push must not undo that.
-- 2. The same push now also gives the hosted agents that website's Search Console data (totals, pages, queries and which
--    page each query lands on), read with the website's own key in its own repository. A site whose GitHub run is
--    connected therefore needs no extra Search Console access for the hosted service account.
-- 3. site_pipeline(): what the pipeline and connections pages show, for agency members and the site's client users.
--    Clients see status, names and times; never costs, budgets, repository names or error text.

-- The search report the agents read (same shape as the hosted search_snapshot job, D47/D52), built from a pushed
-- snapshot. Null when the snapshot carries no search data (then the agents' current report is left as it is).
create or replace function private.search_report_from_snapshot(p_site uuid, p_data jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  with base as (select rtrim(s.url, '/') b from public.sites s where s.id = p_site),
  cur as (select case when jsonb_typeof(p_data->'period'->'cur') = 'object' then p_data->'period'->'cur' else '{}'::jsonb end c),
  kw as (select k from jsonb_array_elements(case when jsonb_typeof(p_data->'keywords') = 'array' then p_data->'keywords' else '[]'::jsonb end) k
         where jsonb_typeof(k) = 'object' and coalesce(k->>'q', '') <> ''),
  pg as (select p from jsonb_array_elements(case when jsonb_typeof(p_data->'pages') = 'array' then p_data->'pages' else '[]'::jsonb end) p
         where jsonb_typeof(p) = 'object' and coalesce(p->>'path', '') <> '' and coalesce((p->>'i')::numeric, 0) > 0)
  select case when coalesce((select (c->>'impressions')::numeric from cur), 0) <= 0 and not exists (select 1 from kw) then null else jsonb_build_object(
    'property', 'github run', 'source', 'github', 'days', 28, 'generatedAt', now(),
    'from', p_data->'period'->'window'->>'start', 'to', p_data->'period'->'window'->>'end',
    'totals', (select jsonb_build_object('clicks', coalesce((c->>'clicks')::numeric, 0), 'impressions', coalesce((c->>'impressions')::numeric, 0),
                 'ctr', coalesce((c->>'ctr')::numeric, 0), 'position', coalesce((c->>'position')::numeric, 0)) from cur),
    'pages', coalesce((select jsonb_agg(x order by (x->>'impressions')::numeric desc) from (
        select jsonb_build_object('url', (select b from base) || (p->>'path'), 'clicks', coalesce((p->>'c')::numeric, 0), 'impressions', (p->>'i')::numeric,
          'ctr', round(coalesce((p->>'c')::numeric, 0) / (p->>'i')::numeric, 4), 'position', null) x from pg order by (p->>'i')::numeric desc limit 250) t), '[]'::jsonb),
    'queries', coalesce((select jsonb_agg(x order by (x->>'impressions')::numeric desc) from (
        select jsonb_build_object('query', left(k->>'q', 200), 'clicks', coalesce((k->>'c')::numeric, 0), 'impressions', coalesce((k->>'i')::numeric, 0),
          'ctr', case when coalesce((k->>'i')::numeric, 0) > 0 then round(coalesce((k->>'c')::numeric, 0) / (k->>'i')::numeric, 4) else 0 end,
          'position', (k->>'pos')::numeric) x from kw order by coalesce((k->>'i')::numeric, 0) desc limit 100) t), '[]'::jsonb),
    -- Each tracked query with the page Search Console shows for it: the pairing the agents may cite (D52).
    'pairs', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('url', (select b from base) || (k->>'page'), 'query', left(k->>'q', 200), 'clicks', coalesce((k->>'c')::numeric, 0),
          'impressions', coalesce((k->>'i')::numeric, 0), 'ctr', case when coalesce((k->>'i')::numeric, 0) > 0 then round(coalesce((k->>'c')::numeric, 0) / (k->>'i')::numeric, 4) else 0 end,
          'position', (k->>'pos')::numeric) x from kw where coalesce(k->>'page', '') like '/%' order by coalesce((k->>'i')::numeric, 0) desc limit 250) t), '[]'::jsonb),
    'complete', jsonb_build_object('pages', false, 'queries', false)) end;
$$;

create or replace function public.ingest_snapshot(p_token text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_site uuid; v_at timestamptz := now(); v_report jsonb;
begin
  select t.site_id into v_site from private.ingest_tokens t where t.token_hash = private.hash_token(p_token);
  if v_site is null then return jsonb_build_object('error', 'unknown token'); end if;
  if jsonb_typeof(p_data) <> 'object' then return jsonb_build_object('error', 'snapshot must be an object'); end if;
  if pg_column_size(p_data) > 4 * 1024 * 1024 then return jsonb_build_object('error', 'snapshot larger than 4 MB'); end if;
  insert into public.site_snapshots (site_id, taken_at, data) values (v_site, v_at, p_data);
  -- A paused site stays paused (D54); any other site is live once it reports.
  update public.sites set status = case when status = 'paused' then 'paused' else 'live' end, last_snapshot_at = v_at where id = v_site;
  update private.ingest_tokens set last_used_at = v_at where site_id = v_site;
  delete from public.site_snapshots where site_id = v_site and id not in (select id from public.site_snapshots where site_id = v_site order by taken_at desc limit 120);
  v_report := private.search_report_from_snapshot(v_site, p_data);
  if v_report is not null then
    perform public.remember(v_site, jsonb_build_array(jsonb_build_object('kind', 'report', 'key', 'search_console', 'value', v_report,
      'basis', 'verified', 'source', 'search console (the website''s own GitHub run)')), 'github-push');
  end if;
  return jsonb_build_object('ok', true, 'site', v_site, 'at', v_at, 'searchForAgents', v_report is not null);
end;
$$;

-- What the pipeline and connections pages show. Members get everything below; client users of the site get the same
-- picture without costs, budgets, repository names or error messages.
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
        select jsonb_build_object('agent', j.agent, 'status', (array_agg(j.status order by j.updated_at desc))[1],
          'title', left((array_agg(j.title order by j.updated_at desc))[1], 160), 'at', max(j.updated_at),
          'runs30', count(*) filter (where j.created_at > now() - interval '30 days')) x
        from public.jobs j where j.site_id = p_site and j.agent is not null group by j.agent) t), '[]'::jsonb),
    -- Work in progress and the latest steps, newest first: the live view.
    'live', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('agent', j.agent, 'kind', j.kind, 'title', left(j.title, 160), 'status', j.status, 'at', j.updated_at) x
        from public.jobs j where j.site_id = p_site and j.status in ('queued', 'running', 'awaiting_review', 'authorized', 'awaiting_approval', 'escalated')
        order by j.updated_at desc limit 20) t), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('at', e.at, 'agent', j.agent, 'kind', j.kind, 'title', left(j.title, 120), 'to', e.to_status,
          'note', case when agency then left(e.note, 200) end) x
        from public.job_events e join public.jobs j on j.id = e.job_id where j.site_id = p_site order by e.at desc, e.id desc limit 25) t), '[]'::jsonb));
end $$;

revoke all on function private.search_report_from_snapshot(uuid, jsonb), public.site_pipeline(uuid) from public, anon, authenticated;
grant execute on function public.site_pipeline(uuid) to authenticated;
grant execute on function public.ingest_snapshot(text, jsonb) to service_role;
