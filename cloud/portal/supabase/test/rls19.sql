-- Live activity (20261112000000_activity.sql, D42). Run after rls18.sql. Read-only; agency members only; nothing from
-- another agency's site; the scheduler's error strings are never returned (only a count).
\set ON_ERROR_STOP on
-- An error string that names another site: it must never reach Alice.
set role service_role; set request.jwt.claim.role = 'service_role';
select public.record_god_run('{"runner": "test", "sitesPlanned": 1, "jobsRun": 1, "errors": ["site bakery.test: secret-marker timeout"]}');
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); a jsonb; jobs_before bigint; begin
  select count(*) into jobs_before from public.jobs;
  a := public.site_activity(s, 500);
  assert jsonb_array_length(a->'events') between 1 and 200, 'events, capped at 200';
  assert not exists (select 1 from jsonb_array_elements(a->'events') e where not exists (select 1 from public.jobs j where j.id = (e->>'job')::uuid and j.site_id = s)), 'only this site''s jobs';
  assert a->'scheduler' ? 'lastRunAt' and (a->'scheduler'->>'runsWithErrorsOfLast4')::int >= 1, 'heartbeat with an error count';
  assert position('secret-marker' in a::text) = 0, 'no Worker error text';
  assert a->'gates' ? 'strategyApproved' and a->'gates' ? 'githubConnected' and a->'gates' ? 'agentRunsEver', 'gates';
  assert jsonb_typeof(a->'workers') = 'array' and jsonb_typeof(a->'working') = 'array', 'workers and working';
  -- People are shown by email only when they belong to the agency; otherwise "a person".
  assert not exists (select 1 from jsonb_array_elements(a->'events') e where e->>'actorKind' = 'user' and e->>'actor' ~ '^[0-9a-f]{8}-'), 'no raw user ids';
  assert (select count(*) from public.jobs) = jobs_before, 'reading changed nothing';
end $$;
-- Bob (agency B) cannot read agency A's site; Carol (a client of that site) cannot read the SEO God's activity.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin perform public.site_activity((select v from ids where k = 'alice_site')); raise exception 'leaked to another agency'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin perform public.site_activity((select v from ids where k = 'alice_site')); raise exception 'leaked to a client'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
reset role;
set role anon;
do $$ begin perform public.site_activity((select v from ids where k = 'alice_site')); raise exception 'anon called it'; exception when insufficient_privilege then null; end $$;
reset role;
\echo rls19 ok
