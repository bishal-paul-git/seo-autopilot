-- Daily digest and stale data (20261119000000_daily_digest.sql, D57). Run after rls25.sql.
-- Covers: the digest per agency (waiting work and how long, stopped work, failures, freshness, spend), recorded once a
-- day by the service role only, shown as a notification to the agency's members (never to another agency or a client
-- user), stale data and refused inspection in the alerts and for platform admins, and pruning of old derived reports.
\set ON_ERROR_STOP on
create temp table d_ids (k text primary key, v text);
grant all on d_ids to authenticated, service_role, anon;
insert into d_ids select 'org', org_id::text from public.sites where id = (select v from ids where k = 'alice_site');

-- Setup (superuser): agency A's site gets an old scan, an old Search Console snapshot, a refused inspection, an approval
-- waiting 4 days, a failure today and yesterday's spend.
do $$ declare site uuid := (select v from ids where k = 'alice_site'); org uuid := (select v from d_ids where k = 'org')::uuid; j uuid; begin
  update public.sites set status = 'live', gsc_allowed = true where id = site; -- Search Console in use (the D34 path)
  update public.site_memory set superseded_at = now() where site_id = site and kind = 'report' and key in ('audit', 'search_console', 'inspect') and superseded_at is null;
  insert into public.site_memory (org_id, site_id, kind, key, value, basis, source, created_by) values
    (org, site, 'report', 'audit', jsonb_build_object('generatedAt', now() - interval '4 days'), 'verified', 'scan', 'test'),
    (org, site, 'report', 'search_console', jsonb_build_object('generatedAt', now() - interval '3 days'), 'verified', 'search console', 'test'),
    (org, site, 'report', 'inspect', jsonb_build_object('generatedAt', now(), 'blocked', jsonb_build_object('reason', 'needs Full permission')), 'verified', 'search console url inspection', 'test'),
    -- an old superseded snapshot (pruned) and an old superseded audit (kept: the monthly report reads it)
    (org, site, 'report', 'history', '{}'::jsonb, 'verified', 'x', 'test'), (org, site, 'report', 'audit', '{}'::jsonb, 'verified', 'x', 'test');
  update public.site_memory set superseded_at = now() - interval '20 days' where site_id = site and kind = 'report' and key in ('history', 'audit') and value = '{}'::jsonb;
  insert into public.jobs (org_id, site_id, kind, title, source, risk, requires_approval, status, updated_at)
    values (org, site, 'agent:seo-strategist', 'Digest test: waiting', 'seo_god', 'medium', true, 'awaiting_approval', now() - interval '4 days');
  insert into public.jobs (org_id, site_id, kind, title, source, risk, status) values (org, site, 'scan', 'Digest test: failed', 'seo_god', 'low', 'queued') returning id into j;
  insert into public.job_events (job_id, org_id, actor_kind, actor, from_status, to_status, note) values (j, org, 'system', 'test', 'running', 'failed', 'boom');
  insert into public.job_costs (org_id, site_id, job_id, usd, at) values (org, site, j, 0.42, date_trunc('day', now()) - interval '12 hours');
end $$;

-- Freshness: a connected site with a 3-day-old snapshot and a 4-day-old scan is stale on both.
do $$ declare f jsonb := private.site_freshness((select v from ids where k = 'alice_site')); begin
  assert (f->>'googleConnected')::boolean, 'connected: ' || f::text;
  assert f->'stale' @> '["search_console", "scan"]'::jsonb and (f->>'inspectBlocked')::boolean, 'stale and blocked: ' || f::text;
end $$;

-- Nobody but the service role records digests or reads the table.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin perform public.record_daily_digests(50, 0); raise exception 'member recorded'; exception when insufficient_privilege then null; end $$;
do $$ begin perform 1 from public.agency_digests; raise exception 'read the table'; exception when insufficient_privilege then null; end $$;
do $$ begin assert jsonb_array_length(public.agency_digests(7)) = 0, 'nothing yet'; end $$;
reset role;
set role anon; set request.jwt.claim.role = 'anon'; set request.jwt.claim.sub = '';
do $$ begin perform public.record_daily_digests(50, 0); raise exception 'anon recorded'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.agency_digests(7); raise exception 'anon read'; exception when insufficient_privilege then null; end $$;
reset role;

-- The service role records one digest per agency per day; a second call the same day does nothing; old reports pruned.
set role service_role; set request.jwt.claim.role = 'service_role'; set request.jwt.claim.sub = '';
do $$ declare r jsonb; begin
  r := public.record_daily_digests(50, 0);
  assert (r->>'recorded')::int = (select count(distinct org_id) from public.sites), 'one per agency: ' || r::text;
  assert (r->>'pruned')::int >= 1, 'old derived report pruned: ' || r::text;
  assert (public.record_daily_digests(50, 0)->>'recorded')::int = 0, 'once a day';
  assert (public.record_daily_digests(50, 24)->>'recorded')::int = 0 and public.record_daily_digests(50, 24) ? 'waiting', 'waits for the hour';
end $$;
reset role;
do $$ declare site uuid := (select v from ids where k = 'alice_site'); d jsonb; s jsonb; begin
  assert not exists (select 1 from public.site_memory where site_id = site and key = 'history' and value = '{}'::jsonb), 'superseded history pruned';
  assert exists (select 1 from public.site_memory where site_id = site and key = 'audit' and value = '{}'::jsonb), 'superseded audit kept';
  select digest into d from public.agency_digests where org_id = (select v from d_ids where k = 'org')::uuid;
  assert (d->>'attention')::boolean, 'needs attention';
  assert (d->'totals'->>'waiting')::int >= 1 and (d->'totals'->>'oldestWaitingDays')::int >= 4, 'waiting and how long: ' || (d->'totals')::text;
  assert (d->'totals'->>'failed24h')::int >= 1 and (d->'totals'->>'staleSites')::int >= 1 and (d->'totals'->>'inspectBlocked')::int >= 1, 'failures, stale, blocked';
  assert (d->'totals'->>'spentYesterdayUsd')::numeric >= 0.42, 'spend yesterday';
  assert d->>'title' like '%waiting for a decision (oldest%days)%' and d->>'title' like '%with stale data%' and d->>'title' like '%AI spend yesterday%', 'title: ' || (d->>'title');
  select x into s from jsonb_array_elements(d->'sites') x where (x->>'site')::uuid = site;
  assert s->'freshness'->'stale' @> '["scan"]'::jsonb and s ? 'budgetUsd', 'per site: ' || s::text;
end $$;

-- Alice (agency A) sees the digest in her notifications and in her alerts; Bob (agency B) sees none of agency A's.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare n jsonb := public.my_notifications(); a jsonb := public.ops_alerts(); begin
  assert exists (select 1 from jsonb_array_elements(n->'items') x where x->>'kind' = 'digest' and x->>'page' = 'ops' and x->>'title' like '%waiting for a decision%'), 'digest notification: ' || n::text;
  assert exists (select 1 from jsonb_array_elements(a) x where x->>'kind' = 'stale_data' and x->'stale' @> '["scan"]'::jsonb), 'stale alert: ' || a::text;
  assert exists (select 1 from jsonb_array_elements(a) x where x->>'kind' = 'inspect_blocked'), 'inspection alert';
  assert exists (select 1 from jsonb_array_elements(a) x where x->>'kind' = 'waiting_long'), 'long wait still alerted';
  assert jsonb_array_length(public.agency_digests(7)) >= 1, 'her agency digest';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ declare n jsonb := public.my_notifications(); begin
  assert not exists (select 1 from jsonb_array_elements(n->'items') x where x->>'kind' = 'digest' and x->>'siteName' = (select coalesce(o.brand_name, o.name) from public.orgs o where o.id = (select v from d_ids where k = 'org')::uuid)), 'no other agency digest';
  assert not exists (select 1 from jsonb_array_elements(public.agency_digests(7)) x where (x->>'org')::uuid = (select v from d_ids where k = 'org')::uuid), 'no other agency digest list';
  assert not exists (select 1 from jsonb_array_elements(public.ops_alerts()) a where (a->>'site')::uuid = (select v from ids where k = 'alice_site')), 'no other agency alerts';
  -- Bob is a platform admin (rls11): platform health names stale websites across agencies, nothing else about them.
  assert exists (select 1 from jsonb_array_elements(public.platform_health(1)->'stale') x where (x->>'site')::uuid = (select v from ids where k = 'alice_site') and x ? 'stale' and not x ? 'freshness'), 'admin sees stale sites';
end $$;
-- A client user of agency A's site never gets the agency digest.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin
  assert not exists (select 1 from jsonb_array_elements(public.my_notifications()->'items') x where x->>'kind' = 'digest'), 'client: no digest';
  assert jsonb_array_length(public.agency_digests(7)) = 0, 'client: no digest list';
end $$;
reset role;
-- A quiet day is recorded but raises no notification.
do $$ declare org uuid := (select v from d_ids where k = 'org')::uuid; begin
  update public.agency_digests set attention = false where org_id = org;
end $$;
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin assert not exists (select 1 from jsonb_array_elements(public.my_notifications()->'items') x where x->>'kind' = 'digest'), 'quiet digest is not a notification'; end $$;
reset role;
\echo rls26 ok
