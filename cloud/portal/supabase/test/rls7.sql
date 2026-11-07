-- Cloudflare execution support (20261108030000_cloudflare_execution.sql): pause switch, due-site rotation, lease
-- recovery through the normal retry path, run log, and that none of it is reachable by agencies or clients. After rls6.
\set ON_ERROR_STOP on
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); b uuid := (select v from ids where k = 'bob_site'); j public.jobs; n int; begin
  assert public.god_paused() = false, 'starts unpaused';
  assert public.set_god_paused(true, 'test') = true, 'pause set';
  assert (select paused from public.god_control where id = 1), 'paused';
  perform public.set_god_paused(false);
  -- Rotation: unplanned sites first; a site planned just now is skipped, unless it has an approved job to carry out.
  assert exists (select 1 from public.god_due_sites(10) where id = s), 'never planned: due';
  -- Earlier suites leave approved jobs on this site (correctly making it due); finish them so rotation alone is tested.
  update public.jobs set status = 'completed' where site_id = s and status = 'authorized';
  perform public.record_site_tick(s, '{"jobs": 2}');
  assert not exists (select 1 from public.god_due_sites(10) where id = s), 'just planned: not due';
  assert (select org_id from public.god_site_ticks where site_id = s) = (select org_id from public.sites where id = s), 'tick carries the site org';
  -- Lease recovery: a running job whose lease passed is failed and requeued with a delay, attempt counted.
  j := public.create_job(s, 'scan', 'Read the site', 'seo_god', 'low', false, 2, '{}', 'lease-test:1');
  perform public.transition_job(j.id, 'scoped', 'test'); perform public.transition_job(j.id, 'queued', 'test');
  j := public.claim_job('dead-worker', 60);
  assert j.status = 'running', 'claimed';
  update public.jobs set lease_until = now() - interval '1 minute' where id = j.id;
  n := public.reap_expired_leases();
  assert n >= 1, 'reaped';
  select * into j from public.jobs where idempotency_key = 'lease-test:1';
  assert j.status = 'queued' and j.attempts = 1 and j.not_before > now(), 'back in the queue with a delay';
  assert exists (select 1 from public.job_events where job_id = j.id and actor = 'reaper' and to_status = 'failed'), 'recovery is recorded';
  assert public.reap_expired_leases() = 0, 'nothing else to reap';
  -- Approved work makes a site due again at once.
  j := public.create_job(s, 'strategy_proposal', 'Strategy', 'seo_god', 'high', true, 1, '{}', 'due-test:1');
  update public.jobs set status = 'authorized' where id = j.id; -- simulates the agency approval recorded through approve_job
  assert exists (select 1 from public.god_due_sites(10) where id = s), 'approved work: due again';
  -- Paused sites are never planned.
  update public.sites set status = 'paused' where id = b;
  assert not exists (select 1 from public.god_due_sites(10) where id = b), 'paused site skipped';
  update public.sites set status = 'live' where id = b;
  -- Run log and usage.
  perform public.record_god_run('{"runner": "test", "sitesPlanned": 2, "jobsRun": 3, "invocations": 6, "subrequests": 40, "errors": ["x"]}');
  assert (public.god_usage(1)->>'invocations')::int >= 6 and (public.god_usage(1)->>'runsWithErrors')::int >= 1, 'usage summed';
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ begin
  assert (select count(*) from public.god_site_ticks) = 1, 'agency A sees its own site tick';
  assert (select count(*) from public.god_runs) = 0, 'run log is not readable by agencies';
  begin perform public.set_god_paused(true); raise exception 'staff paused the scheduler'; exception when insufficient_privilege then null; end;
  begin perform public.reap_expired_leases(); raise exception 'staff reaped'; exception when insufficient_privilege then null; end;
  begin perform public.god_due_sites(); raise exception 'staff listed due sites'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b'; set request.jwt.claim.role = 'authenticated';
do $$ begin assert (select count(*) from public.god_site_ticks) = 0, 'agency B sees none of agency A ticks'; end $$;
reset role;
set role anon; set request.jwt.claim.role = 'anon';
do $$ begin begin perform public.god_paused(); raise exception 'anon read the switch'; exception when insufficient_privilege then null; end; end $$;
reset role;
select 'all cloudflare execution checks passed' as result;
