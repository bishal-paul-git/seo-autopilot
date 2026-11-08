-- Security fixes (20261108080000_security_fixes.sql), one check per finding. Run after rls11.sql.
\set ON_ERROR_STOP on
-- 1. Search Console: only for sites a platform admin confirmed; never for a domain registered in another agency;
--    the confirmation is cleared when the address changes; members cannot set it themselves.
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ begin assert public.gsc_allowed((select v from ids where k = 'alice_site')) = false, 'off by default'; end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ begin
  begin update public.sites set gsc_allowed = true where id = (select v from ids where k = 'alice_site'); raise exception 'member enabled Search Console'; exception when insufficient_privilege then null; end;
  begin perform public.set_gsc_allowed((select v from ids where k = 'alice_site'), true); raise exception 'member used the admin function'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.gsc_allowed((select v from ids where k = 'alice_site')); raise exception 'member read the service check'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Bob is a platform admin since rls11.sql.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b'; set request.jwt.claim.role = 'authenticated';
do $$ begin assert (public.set_gsc_allowed((select v from ids where k = 'alice_site'), true))->>'allowed' = 'true', 'admin confirms'; end $$;
reset role;
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); b uuid := (select v from ids where k = 'bob_site'); old text; begin
  assert public.gsc_allowed(s), 'allowed after confirmation';
  -- Another agency registers the same domain (www and case differences included): the shared account stops for both.
  select url into old from public.sites where id = b;
  update public.sites set url = replace(upper((select url from public.sites where id = s)), 'HTTPS://', 'https://www.') where id = b;
  assert not public.gsc_allowed(s), 'refused while the domain is also in another agency';
  update public.sites set url = old where id = b;
  assert public.gsc_allowed(s), 'allowed again once it is not';
  -- Changing the address clears the confirmation.
  update public.sites set url = 'https://elsewhere.test/' where id = s;
  assert not public.gsc_allowed(s) and (select gsc_allowed_at from public.sites where id = s) is null, 'address change clears it';
end $$;
reset role;
-- With the same domain in another agency, even a platform admin cannot allow it.
set role service_role; set request.jwt.claim.role = 'service_role';
update public.sites set url = 'https://www.Elsewhere.test/' where id = (select v from ids where k = 'bob_site');
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b'; set request.jwt.claim.role = 'authenticated';
do $$ begin
  begin perform public.set_gsc_allowed((select v from ids where k = 'alice_site'), true); raise exception 'allowed a shared domain'; exception when raise_exception then if sqlerrm not like 'this domain is also registered%' then raise; end if; end;
end $$;
reset role;
set role service_role; set request.jwt.claim.role = 'service_role';
update public.sites set url = 'https://bakery.test/' where id = (select v from ids where k = 'bob_site');
reset role;

-- 2. Jobs from agency staff: at most $5, gated when they carry a budget, priority clamped, 100 a day per person.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); j public.jobs; begin
  begin perform public.create_job(s, 'agent:seo-strategist', 'x', 'agency', 'low', false, 1, '{}', null, null, '{}', 1000); raise exception 'unbounded budget'; exception when raise_exception then if sqlerrm not like 'a job created by agency staff can carry at most%' then raise; end if; end;
  j := public.create_job(s, 'agent:seo-strategist', 'Look at Leeds', 'agency', 'low', false, -7, '{}', null, null, '{}', 2);
  assert j.requires_approval and j.budget_usd = 2 and j.priority = 1, 'budgeted work needs approval; priority clamped';
  j := public.create_job(s, 'audit', 'Free audit', 'agency', 'low', false, 3, '{}', null, null, '{}', 0);
  assert not j.requires_approval, 'free low-risk work is not gated';
end $$;
reset role;
-- The service role (the planner) is not limited by the staff cap.
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ begin assert (public.create_job((select v from ids where k = 'alice_site'), 'agent:seo-reporter', 'planned', 'seo_god', 'low', false, 3, '{}', null, null, '{}', 10)).budget_usd = 10, 'planner budgets unchanged'; end $$;
reset role;
select 'all security fix checks passed' as result;
