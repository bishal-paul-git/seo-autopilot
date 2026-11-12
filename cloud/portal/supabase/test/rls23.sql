-- Budgets and alerts (20261116000000_budgets_alerts.sql, D50). Run after rls22.sql.
\set ON_ERROR_STOP on
set role authenticated; set request.jwt.claim.role = 'authenticated';
-- Alice owns agency A: she sets, changes and resets a site's daily budget; it is audited and shown in the overview.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); o jsonb; begin
  perform public.set_site_budget(s, 3.456);
  select x into o from jsonb_array_elements(public.agency_overview()) x where (x->>'id')::uuid = s;
  assert (o->>'budgetUsd')::numeric = 3.46, 'rounded to cents: ' || o::text;
  assert (o->>'canSetBudget')::boolean, 'owner can set it';
  assert o ? 'spendLastMonth' and o ? 'appliedBudgetUsd', 'new overview fields';
  begin perform public.set_site_budget(s, 101); raise exception 'over the cap accepted'; exception when raise_exception then if sqlerrm not like '%between 0 and 100%' then raise; end if; end;
  perform public.set_site_budget(s, null);
  assert (select daily_budget_usd from public.sites where id = s) is null, 'reset to the default';
  assert (select count(*) from public.audit_log where site_id = s and action = 'site.budget') = 2, 'audited';
  assert jsonb_typeof(public.ops_alerts()) = 'array', 'alerts';
end $$;
-- Carol is a member of agency A, not an owner: she sees the overview but cannot set a budget.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  assert not (select (x->>'canSetBudget')::boolean from jsonb_array_elements(public.agency_overview()) x limit 1), 'members cannot set budgets';
  perform public.set_site_budget((select v from ids where k = 'alice_site'), 1); raise exception 'member set a budget';
exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
-- Bob (agency B) cannot touch agency A's budget, and his alerts never name agency A's sites.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin perform public.set_site_budget((select v from ids where k = 'alice_site'), 1); raise exception 'other agency set a budget'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
do $$ begin assert not exists (select 1 from jsonb_array_elements(public.ops_alerts()) a where (a->>'site')::uuid = (select v from ids where k = 'alice_site')), 'no other agency alerts'; end $$;
-- The scheduler's lookup is for the service role only.
do $$ begin perform public.god_site_budget((select v from ids where k = 'alice_site')); raise exception 'signed-in user read the scheduler lookup'; exception when insufficient_privilege then null; end $$;
reset role;
set role anon;
do $$ begin perform public.ops_alerts(); raise exception 'anon called it'; exception when insufficient_privilege then null; end $$;
reset role;
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ begin assert public.god_site_budget((select v from ids where k = 'alice_site')) is null, 'default'; end $$;
reset role;
\echo rls23 ok
