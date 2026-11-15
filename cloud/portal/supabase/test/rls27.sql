-- Portfolio and per-change scorecard (20261120000000_portfolio_scorecard.sql, D58). Run after rls26.sql.
-- Covers: one row per website of the caller's own agencies (never another agency's, never for a client user or anon),
-- clicks over 28 days and the like-for-like change from the daily history, pages not indexed (redirects excluded),
-- stale data, approvals waiting, 7-day spend, win/loss counts (superseded advice not counted), "needs attention" first,
-- the per-site scorecard list for members only, and pruning of superseded scorecard copies.
\set ON_ERROR_STOP on

-- Setup (superuser): agency A's site with a snapshot, 56 days of history (clicks halved), an inspection with two pages
-- not indexed and one redirect, three scorecard entries (a win, a loss, a superseded loss) and an old superseded copy.
create temp table p_exp (k text primary key, v numeric);
grant all on p_exp to authenticated;
do $$ declare site uuid := (select v from ids where k = 'alice_site'); org uuid; d jsonb := '{}'::jsonb; i int; j uuid; begin
  select org_id into org from public.sites where id = site;
  insert into public.jobs (org_id, site_id, kind, title, source, risk, status) values (org, site, 'scan', 'Portfolio test', 'seo_god', 'low', 'completed') returning id into j;
  for i in 0..55 loop d := d || jsonb_build_object(to_char(date '2026-11-12' - i, 'YYYY-MM-DD'), jsonb_build_array(case when i < 28 then 10 else 20 end, 500, 8.1)); end loop;
  update public.site_memory set superseded_at = now() where site_id = site and kind = 'report' and key in ('search_console', 'history', 'inspect') and superseded_at is null;
  insert into public.site_memory (org_id, site_id, kind, key, value, basis, source, created_by) values
    (org, site, 'report', 'search_console', jsonb_build_object('generatedAt', now(), 'property', 'sc-domain:alice.test', 'to', '2026-11-12', 'totals', jsonb_build_object('clicks', 280, 'impressions', 14000)), 'verified', 'search console', 'test'),
    (org, site, 'report', 'history', jsonb_build_object('daily', d), 'verified', 'search console', 'test'),
    (org, site, 'report', 'inspect', jsonb_build_object('generatedAt', now(), 'results', jsonb_build_object(
       'https://a.test/', jsonb_build_object('verdict', 'PASS', 'coverage', 'Submitted and indexed'),
       'https://a.test/x', jsonb_build_object('verdict', 'NEUTRAL', 'coverage', 'Crawled - currently not indexed'),
       'https://a.test/y', jsonb_build_object('verdict', 'NEUTRAL', 'coverage', 'Discovered - currently not indexed'),
       'https://a.test/old', jsonb_build_object('verdict', 'NEUTRAL', 'coverage', 'Page with redirect'))), 'verified', 'search console url inspection', 'test'),
    (org, site, 'scorecard', 'job:w', '{"job": "w", "label": "win", "changedAt": "2026-10-01", "pages": ["https://a.test/x"], "windows": {}}', 'verified', 'search console', 'test'),
    (org, site, 'scorecard', 'job:l', '{"job": "l", "label": "loss", "changedAt": "2026-10-05", "pages": ["https://a.test/y"], "windows": {}}', 'verified', 'search console', 'test'),
    (org, site, 'scorecard', 'job:s', '{"job": "s", "label": "loss", "supersededBy": "l", "changedAt": "2026-09-20", "pages": ["https://a.test/y"], "windows": {}}', 'verified', 'scorecard', 'test'),
    (org, site, 'scorecard', 'job:w', '{"job": "w", "label": "too_early"}', 'verified', 'scorecard', 'test');
  update public.site_memory set superseded_at = now() - interval '20 days' where site_id = site and kind = 'scorecard' and value->>'label' = 'too_early';
  insert into public.job_costs (org_id, site_id, job_id, usd, at) values (org, site, j, 0.25, now() - interval '2 days'), (org, site, j, 9, now() - interval '9 days');
  insert into p_exp values ('spend7', (select sum(usd) from public.job_costs where site_id = site and at > now() - interval '7 days'));
end $$;

-- Alice (agency A): her websites, the numbers, and her busiest website first.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare p jsonb := public.portfolio(); r jsonb; c jsonb; begin
  assert jsonb_array_length(p->'sites') = (select count(*) from public.sites s where private.is_member(s.org_id)), 'one row per website of her agencies: ' || (p->'sites')::text;
  assert not exists (select 1 from jsonb_array_elements(p->'sites') x where (x->>'site')::uuid = (select v from ids where k = 'bob_site')), 'never agency B''s website';
  select x into r from jsonb_array_elements(p->'sites') x where (x->>'site')::uuid = (select v from ids where k = 'alice_site');
  assert (r->>'clicks28')::int = 280 and (r->>'clicksNow')::int = 280 and (r->>'clicksBefore')::int = 560 and (r->>'clicksChange')::numeric = -0.5, 'clicks and change: ' || r::text;
  assert (r->>'notIndexed')::int = 2 and (r->>'inspected')::int = 4, 'not indexed, redirect excluded: ' || r::text;
  assert (r->'scorecard'->>'win')::int = 1 and (r->'scorecard'->>'loss')::int = 1, 'win/loss, superseded advice not counted: ' || (r->'scorecard')::text;
  assert (r->>'spend7Usd')::numeric = (select v from p_exp where k = 'spend7') and (r->>'spend7Usd')::numeric < 9, '7-day spend only: ' || (r->>'spend7Usd');
  assert (r->>'waiting')::int >= 1 and r->'stale' is not null and r->>'status' in ('live', 'paused'), 'waiting, stale, status';
  assert r->'reasons' @> '["clicks down 50%", "1 change lost traffic", "2 pages not indexed"]'::jsonb and (r->>'attention')::int > 0, 'reasons: ' || (r->'reasons')::text;
  assert (select bool_and(coalesce((a->>'attention')::int, 0) >= coalesce((b->>'attention')::int, 0)) from jsonb_array_elements(p->'sites') with ordinality a(a, i)
            join jsonb_array_elements(p->'sites') with ordinality b(b, j) on j = i + 1 where a->>'status' = b->>'status'), 'needs attention first';
  assert not p ? 'scorecard', 'no list without a website';
  c := public.portfolio((select v from ids where k = 'alice_site'));
  assert jsonb_array_length(c->'sites') = 1 and jsonb_array_length(c->'scorecard') = 3, 'her website''s scorecard: ' || (c->'scorecard')::text;
  assert (c->'scorecard'->0->>'changedAt') = '2026-10-05' and c->'scorecard'->0->>'key' = 'job:l', 'newest change first';
end $$;

-- Bob (agency B, platform admin): none of agency A's websites, and no scorecard for them.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert not exists (select 1 from jsonb_array_elements(public.portfolio()->'sites') x where (x->>'site')::uuid = (select v from ids where k = 'alice_site')), 'other agency hidden';
  begin perform public.portfolio((select v from ids where k = 'alice_site')); raise exception 'read another agency''s scorecard'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
-- A client user of agency A's website is not an agency member: no rows, no scorecard.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin
  assert jsonb_array_length(public.portfolio()->'sites') = 0, 'client: no portfolio';
  begin perform public.portfolio((select v from ids where k = 'alice_site')); raise exception 'client read the scorecard'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform 1 from public.site_memory where kind = 'scorecard'; exception when insufficient_privilege then null; end;
  assert not exists (select 1 from public.site_memory where kind = 'scorecard'), 'client: no scorecard rows through the table';
end $$;
reset role;
set role anon; set request.jwt.claim.role = 'anon'; set request.jwt.claim.sub = '';
do $$ begin perform public.portfolio(); raise exception 'anon read the portfolio'; exception when insufficient_privilege then null; end $$;
reset role;

-- Superseded scorecard copies are pruned after 14 days with the derived reports; the current entries stay.
delete from public.agency_digests;
set role service_role; set request.jwt.claim.role = 'service_role'; set request.jwt.claim.sub = '';
do $$ begin assert (public.record_daily_digests(50, 0)->>'pruned')::int >= 1, 'pruned'; end $$;
reset role;
do $$ declare site uuid := (select v from ids where k = 'alice_site'); begin
  assert not exists (select 1 from public.site_memory where site_id = site and kind = 'scorecard' and superseded_at is not null), 'old copy pruned';
  assert (select count(*) from public.site_memory where site_id = site and kind = 'scorecard' and superseded_at is null) = 3, 'current entries kept';
end $$;
\echo rls27 ok
