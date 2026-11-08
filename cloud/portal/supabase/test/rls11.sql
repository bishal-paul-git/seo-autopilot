-- Operations (20261108070000_operations.sql). Each agency sees only its own sites. Platform health and the global pause
-- switch are for platform admins only, a list that only the service role can change. Run after rls10.sql.
\set ON_ERROR_STOP on
-- Agency A: its own sites, with what needs a person.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ declare o jsonb := public.agency_overview(); a jsonb; begin
  assert jsonb_array_length(o) >= 1, 'agency A sees its sites';
  assert not exists (select 1 from jsonb_array_elements(o) x where (x->>'id')::uuid = (select v from ids where k = 'bob_site')), 'never agency B''s site';
  select x into a from jsonb_array_elements(o) x where (x->>'id')::uuid = (select v from ids where k = 'alice_site');
  assert (a->>'escalated')::int >= 1 and a ? 'spendMonth' and a ? 'lastPlanned' and a ? 'requests', 'counts and spend per site';
  begin perform public.platform_health(); raise exception 'agency member read platform health'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.set_platform_paused(true, 'x'); raise exception 'agency member paused everyone'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000000a'); raise exception 'made themselves admin'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- A client account: no agency overview rows, no platform functions.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1'; set request.jwt.claim.role = 'authenticated';
do $$ begin
  assert public.agency_overview() = '[]'::jsonb, 'clients get nothing';
  begin perform public.platform_health(); raise exception 'client read platform health'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
reset role;
-- The service role names a platform admin.
set role service_role; set request.jwt.claim.role = 'service_role';
insert into public.platform_admins (user_id, note) values ('00000000-0000-0000-0000-00000000000b', 'operator');
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b'; set request.jwt.claim.role = 'authenticated';
do $$ declare h jsonb; begin
  h := public.platform_health(7);
  assert h ? 'runs' and h ? 'usage' and h->'control' ? 'paused', 'admin sees platform health';
  assert (public.set_platform_paused(true, ' maintenance '))->>'reason' = 'maintenance', 'admin pauses with a reason';
  assert (public.platform_health()->'control'->>'paused')::boolean and public.platform_health()->'control'->>'by' = 'bob@agency-b.test', 'who paused is recorded';
  perform public.set_platform_paused(false);
end $$;
reset role;
set role anon; set request.jwt.claim.role = 'anon';
do $$ begin begin perform public.agency_overview(); raise exception 'anon read the overview'; exception when insufficient_privilege then null; end; end $$;
reset role;
select 'all operations checks passed' as result;
