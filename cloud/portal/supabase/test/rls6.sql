-- Scheduler support (20261108020000_r1_scheduler.sql): costs per charge, spend per site and day, outputs kept,
-- service-only functions, agencies read only their own costs, paused sites are not planned. Run after rls5.sql.
\set ON_ERROR_STOP on
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); b uuid := (select v from ids where k = 'bob_site'); j public.jobs; n int; begin
  j := public.create_job(s, 'agent:seo-reporter', 'Weekly report', 'seo_god', 'low', false, 3, '{}', 'sched-test:1', null, '{}', 0.5);
  assert j.budget_usd = 0.5, 'budget stored';
  j := public.record_job_output(j.id, '{"proposal": {"x": 1}}', 0.2, 'run 1');
  j := public.record_job_output(j.id, null, 0.15, 'run 2');
  assert j.cost_usd = 0.35 and j.outputs->'proposal'->>'x' = '1', 'cost adds up; outputs kept when none given';
  assert (select count(*) from public.job_costs where job_id = j.id) = 2, 'one row per charge';
  assert public.site_spend(s, now() - interval '1 hour') = 0.35, 'spend today';
  assert public.site_spend(s, now() + interval '1 hour') = 0, 'nothing in the future';
  assert public.site_spend(b, now() - interval '1 hour') = 0, 'other site spent nothing';
  begin perform public.record_job_output(j.id, null, -1); raise exception 'negative cost'; exception when raise_exception then if sqlerrm not like '%negative%' then raise; end if; end;
  assert exists (select 1 from public.site_jobs(s) x where x.id = j.id) and not exists (select 1 from public.site_jobs(b) x where x.id = j.id), 'jobs listed per site';
  assert public.remember(s, '[{"kind":"report","key":"audit","value":{"generatedAt":"2026-11-08T00:00:00Z"},"basis":"verified"}]') = 1, 'report kind allowed';
  select count(*) into n from public.god_sites(); assert n >= 2, 'sites listed';
  update public.sites set status = 'paused' where id = b;
  assert not exists (select 1 from public.god_sites() g where g.id = b), 'paused site is not planned';
  update public.sites set status = 'live' where id = b;
end $$;
reset role;
-- Agency staff read their own costs only; nobody but the service role calls the scheduler functions.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ begin
  assert (select count(*) from public.job_costs) = 2, 'agency A sees its costs';
  begin perform public.site_spend((select v from ids where k = 'alice_site'), now()); raise exception 'staff called site_spend'; exception when insufficient_privilege then null; end;
  begin perform public.record_job_output((select id from public.jobs limit 1), null, 0); raise exception 'staff recorded output'; exception when insufficient_privilege then null; end;
  begin perform public.god_sites(); raise exception 'staff listed all sites'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b'; set request.jwt.claim.role = 'authenticated';
do $$ begin assert (select count(*) from public.job_costs) = 0, 'agency B sees none of agency A costs'; end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1'; set request.jwt.claim.role = 'authenticated';
do $$ begin assert (select count(*) from public.job_costs) = 0, 'a client viewer sees no costs'; end $$;
reset role;
select 'all scheduler checks passed' as result;
