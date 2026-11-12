-- Agent pages (20261114000000_agent_pages.sql, D46). Run after rls20.sql. Read-only; agency members only.
\set ON_ERROR_STOP on
-- Give one existing reporter job the output shape the runner writes (D45): what it read and what it said.
update public.jobs set outputs = jsonb_build_object('proposal', jsonb_build_object('agent', 'seo-reporter', 'summary', 'Two pages lack titles.',
    'recommendations', jsonb_build_array(jsonb_build_object('title', 'Add titles'), jsonb_build_object('title', '<img src=x onerror=alert(1)>')),
    'knowledge', jsonb_build_array('knowledge/seo-reporting.md')), 'evidence', jsonb_build_array('read: knowledge/seo-reporting.md'))
 where id = (select id from public.jobs where site_id = (select v from ids where k = 'alice_site') and kind = 'agent:seo-reporter' order by created_at limit 1);
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); st jsonb; r jsonb; one jsonb; n bigint; begin
  select count(*) into n from public.jobs;
  st := public.site_agent_stats(s);
  assert exists (select 1 from jsonb_array_elements(st) x where x->>'agent' = 'seo-reporter' and (x->>'runs')::int >= 1 and x ? 'costMonth' and x ? 'reviewsPassed'), 'reporter has a line: ' || st::text;
  r := public.agent_runs(s, 'seo-reporter', 500);
  assert jsonb_array_length(r) between 1 and 100, 'runs, capped';
  assert not exists (select 1 from jsonb_array_elements(r) x where not exists (select 1 from public.jobs j where j.id = (x->>'job')::uuid and j.site_id = s)), 'only this site';
  select x into one from jsonb_array_elements(r) x where x->'knowledge' ? 'knowledge/seo-reporting.md';
  assert one is not null and one->>'summary' = 'Two pages lack titles.' and (one->>'recommendations')::int = 2, 'what it read and said';
  assert exists (select 1 from jsonb_array_elements(r) x where jsonb_array_length(x->'reviews') >= 1), 'review verdicts included';
  assert jsonb_array_length(public.agent_runs(s, 'seo-nobody')) = 0, 'unknown agent: nothing';
  begin perform public.agent_runs(s, 'not-an-agent''; drop table x'); raise exception 'bad name accepted'; exception when raise_exception then if sqlerrm <> 'unknown agent' then raise; end if; end;
  assert (select count(*) from public.jobs) = n, 'reading changed nothing';
end $$;
-- Another agency, a client of the site and anon cannot read it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin perform public.agent_runs((select v from ids where k = 'alice_site'), 'seo-reporter'); raise exception 'other agency read runs'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
do $$ begin perform public.site_agent_stats((select v from ids where k = 'alice_site')); raise exception 'other agency read stats'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin perform public.agent_runs((select v from ids where k = 'alice_site'), 'seo-reporter'); raise exception 'client read runs'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
reset role;
set role anon;
do $$ begin perform public.site_agent_stats((select v from ids where k = 'alice_site')); raise exception 'anon called it'; exception when insufficient_privilege then null; end $$;
reset role;
\echo rls21 ok
