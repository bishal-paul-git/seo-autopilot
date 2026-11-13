-- Pipeline, connections and the GitHub run to agents bridge (20261117000000_pipeline_connections.sql, D54). Run after rls23.sql.
\set ON_ERROR_STOP on
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
create temp table t_pipe as select public.create_site('Pipe Co', 'https://pipe.test/', 'acme/pipe') as r;
reset role;
grant select on t_pipe to authenticated, service_role, anon;
-- A push from a paused site keeps it paused and hands its Search Console data to the agents.
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare site uuid := ((select r from t_pipe)->'site'->>'id')::uuid; o jsonb; m jsonb; begin
  update public.sites set status = 'paused' where id = site;
  o := public.ingest_snapshot((select r->>'token' from t_pipe), '{"version":1,
    "period":{"cur":{"clicks":12,"impressions":900,"ctr":0.0133,"position":9.4},"window":{"start":"2026-10-01","end":"2026-10-28"}},
    "keywords":[{"q":"boiler repair leeds","c":7,"i":400,"pos":8.1,"page":"/boiler-repair"},{"q":"boiler service","c":1,"i":90,"pos":14,"page":null}],
    "pages":[{"path":"/boiler-repair","c":9,"i":600},{"path":"/old","c":0,"i":0}],
    "integrations":[{"name":"Google Analytics 4","ok":false,"note":"Not connected: set ga4PropertyId"},{"name":"IndexNow","ok":true,"note":"Pings Bing and Yandex"}]}');
  assert (o->>'ok')::boolean and (o->>'searchForAgents')::boolean, 'pushed: ' || o::text;
  assert (select status from public.sites where id = site) = 'paused', 'a push does not un-pause';
  select value into m from public.site_memory where site_id = site and kind = 'report' and key = 'search_console' and superseded_at is null;
  assert m->>'source' = 'github' and (m->'totals'->>'clicks')::numeric = 12, 'totals: ' || m::text;
  assert jsonb_array_length(m->'pages') = 1 and m->'pages'->0->>'url' = 'https://pipe.test/boiler-repair', 'pages with impressions, full URLs';
  assert jsonb_array_length(m->'queries') = 2 and jsonb_array_length(m->'pairs') = 1 and m->'pairs'->0->>'query' = 'boiler repair leeds', 'pairs only where a page is named';
  -- A snapshot with no search data leaves the agents' report alone.
  o := public.ingest_snapshot((select r->>'token' from t_pipe), '{"version":1,"keywords":[]}');
  assert not (o->>'searchForAgents')::boolean, 'nothing to hand over';
  assert (select count(*) from public.site_memory where site_id = site and kind = 'report' and key = 'search_console' and superseded_at is null) = 1, 'report kept';
  update public.sites set status = 'live' where id = site;
end $$;
reset role;
-- Production jobs carry the specialist only in their kind: it still counts as that specialist.
set role service_role; set request.jwt.claim.role = 'service_role';
insert into public.jobs (org_id, site_id, kind, title, source, risk, requires_approval, status)
  select s.org_id, s.id, 'agent:seo-reporter', 'Monthly report', 'seo_god', 'low', false, 'completed' from public.sites s where s.id = ((select r from t_pipe)->'site'->>'id')::uuid;
reset role;
-- Alice (agency A) sees the whole pipeline of her site, with repository, budget and connection details.
set role authenticated; set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare p jsonb := public.site_pipeline(((select r from t_pipe)->'site'->>'id')::uuid); c jsonb; begin
  assert (p->>'agency')::boolean and p->'site'->>'repo' = 'acme/pipe', 'agency view';
  assert p->'schedule'->>'everyMinutes' = '15' and p->'schedule' ? 'budgetUsd', 'schedule';
  select x into c from jsonb_array_elements(p->'connections') x where x->>'key' = 'github';
  assert c->>'state' = 'connected', 'github run connected: ' || c::text;
  select x into c from jsonb_array_elements(p->'connections') x where x->>'key' = 'search_console';
  assert c->>'state' = 'connected' and c->>'detail' like '12 clicks, 900 impressions%GitHub run%', 'search console: ' || c::text;
  assert exists (select 1 from jsonb_array_elements(p->'connections') x where x->>'name' = 'IndexNow' and x->>'state' = 'connected'), 'run integrations listed';
  assert exists (select 1 from jsonb_array_elements(p->'connections') x where x->>'name' = 'Google Analytics 4' and x->>'detail' like 'Not connected: set%'), 'agency sees the setup note';
  assert exists (select 1 from jsonb_array_elements(p->'agents') a where a->>'agent' = 'seo-reporter' and a->>'status' = 'completed'), 'agent from the job kind: ' || (p->'agents')::text;
  assert jsonb_typeof(p->'live') = 'array' and jsonb_typeof(p->'events') = 'array' and jsonb_typeof(p->'agents') = 'array', 'lists';
end $$;
-- The site's client user sees the pipeline without repository, budget, spend or notes.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ declare p jsonb := public.site_pipeline((select v from ids where k = 'alice_site')); begin
  assert not (p->>'agency')::boolean, 'client view';
  assert p->'site'->'repo' = 'null'::jsonb and p->'schedule'->'budgetUsd' = 'null'::jsonb and p->'schedule'->'spentTodayUsd' = 'null'::jsonb, 'no money or repository';
  assert not exists (select 1 from jsonb_array_elements(p->'events') e where e->'note' <> 'null'::jsonb), 'no notes';
end $$;
-- The client cannot open a site that is not theirs; Bob (agency B) cannot open agency A's site.
do $$ begin perform public.site_pipeline(((select r from t_pipe)->'site'->>'id')::uuid); raise exception 'client opened another site'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin perform public.site_pipeline((select v from ids where k = 'alice_site')); raise exception 'other agency'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
reset role;
set role anon;
do $$ begin perform public.site_pipeline((select v from ids where k = 'alice_site')); raise exception 'anon called it'; exception when insufficient_privilege then null; end $$;
reset role;
\echo rls24 ok
