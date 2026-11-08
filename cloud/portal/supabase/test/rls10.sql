-- Learning in the agency console (20261108060000_learning.sql): lessons and experiments shown to agency members only.
-- Run after rls9.sql.
\set ON_ERROR_STOP on
set role service_role; set request.jwt.claim.role = 'service_role';
select public.remember((select v from ids where k = 'alice_site'), '[
  {"kind":"experiment","key":"exp:j1","value":{"agent":"seo-snippet-optimizer","status":"open","openedAt":"2026-11-01T00:00:00Z","items":[{"url":"plumber.test/x","status":"resolved","baseline":["title-missing"]}]},"basis":"verified"},
  {"kind":"lesson","key":"agent:seo-snippet-optimizer","value":{"text":"seo-snippet-optimizer: 1 of 1 checked recommendations were fixed by later scans."},"basis":"inferred","confidence":0.4}]');
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ declare c jsonb := public.god_console((select v from ids where k = 'alice_site')); begin
  assert c->'lessons'->0->>'text' like 'seo-snippet-optimizer: 1 of 1%', 'lesson shown';
  assert c->'experiments'->0->'items'->0->>'status' = 'resolved', 'experiment shown';
  assert c ? 'waiting' and c ? 'strategy' and c ? 'costs', 'earlier sections unchanged';
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1'; set request.jwt.claim.role = 'authenticated';
do $$ begin begin perform public.god_console((select v from ids where k = 'alice_site')); raise exception 'client read lessons'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end; end $$;
reset role;
select 'all learning checks passed' as result;
