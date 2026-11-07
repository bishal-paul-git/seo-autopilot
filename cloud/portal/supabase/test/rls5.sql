-- Site memory: service-only writes that supersede, history kept, private per site. Run after rls4.sql.
\set ON_ERROR_STOP on
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); b uuid := (select v from ids where k = 'bob_site'); begin
  assert public.remember(s, '[{"kind":"identity","key":"business_name","value":{"value":"Plumber Ltd"},"basis":"stated","confidence":0.9,"source":"https://plumber.test/"}]') = 1, 'stored';
  assert public.remember(s, '[{"kind":"identity","key":"business_name","value":{"value":"Plumber Ltd"},"basis":"stated","confidence":0.9,"source":"https://plumber.test/"}]') = 0, 'same value: no new row';
  assert public.remember(s, '[{"kind":"identity","key":"business_name","value":{"value":"Plumber & Sons"},"basis":"answered","confidence":1,"source":"onboarding answer"}]') = 1, 'new value supersedes';
  assert jsonb_array_length(public.recall(s, 'identity')) = 1 and public.recall(s, 'identity')->0->'value'->>'value' = 'Plumber & Sons', 'current value only';
  assert (select count(*) from public.site_memory where site_id = s) = 2, 'history kept';
  assert public.recall(b) = '[]'::jsonb, 'other site sees nothing';
  begin perform public.remember(s, '[{"kind":"secret","key":"k","value":1,"basis":"stated"}]'); raise exception 'bad kind'; exception when check_violation then null; end;
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1'; set request.jwt.claim.role = 'authenticated';
do $$ begin
  begin perform public.remember((select v from ids where k = 'alice_site'), '[]'); raise exception 'client wrote memory'; exception when insufficient_privilege then null; end;
  begin perform public.recall((select v from ids where k = 'alice_site')); raise exception 'client read memory'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin assert (select count(*) from public.site_memory) = 0, 'agency B reads none of agency A memory'; end $$;
reset role;
select 'all site memory checks passed' as result;
