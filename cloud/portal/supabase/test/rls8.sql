-- Agency console (20261108040000_agency_console.sql): one read for the SEO God page, answering onboarding questions,
-- retrying escalated work. Members of the site's agency only; other agencies and client viewers refused; the job
-- lifecycle still applies (gated work cannot be queued without a standing approval). Run after rls7.sql.
\set ON_ERROR_STOP on
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); j public.jobs; begin
  perform public.remember(s, '[{"kind":"question","key":"goals","value":{"question":"What should search bring you?","why":"sets the objective"},"basis":"inferred"},
                               {"kind":"question","key":"competitors","value":{"question":"Who are your competitors?","why":"research starts there"},"basis":"inferred"},
                               {"kind":"strategy","key":"initial","value":{"status":"proposed","approval":"agency","firstSteps":[{"title":"Fix missing titles"}]},"basis":"inferred"}]');
  j := public.create_job(s, 'agent:seo-reporter', 'Weekly report', 'seo_god', 'low', false, 3, '{}', 'console-test:retry');
  update public.jobs set status = 'escalated', attempts = 3, error = 'provider timeout' where id = j.id;
  j := public.create_job(s, 'agent:seo-technical-fixer', 'Fix redirects', 'seo_god', 'high', true, 2, '{}', 'console-test:gated');
  update public.jobs set status = 'escalated', attempts = 3, error = 'boom' where id = j.id;
  insert into ids values ('retry_job', (select id from public.jobs where idempotency_key = 'console-test:retry')), ('gated_job', (select id from public.jobs where idempotency_key = 'console-test:gated'));
end $$;
reset role;

-- Agency A, member of the site's org.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); c jsonb; begin
  c := public.god_console(s);
  assert c->'strategy'->>'status' = 'proposed', 'strategy shown';
  assert jsonb_array_length(c->'questions') = 2, 'two open questions';
  assert jsonb_array_length(c->'escalated') >= 2, 'escalations shown';
  assert c ? 'waiting' and c ? 'recent' and c->'costs' ? 'today', 'all sections present';
  perform public.answer_question(s, 'goals', '  More boiler repair enquiries  ');
  c := public.god_console(s);
  assert jsonb_array_length(c->'questions') = 1, 'answered question closes';
  assert (select c2->>'value' from jsonb_array_elements(c->'answers') c2 where c2->>'key' = 'goals') = 'More boiler repair enquiries', 'answer stored, trimmed';
  perform public.answer_question(s, 'goals', 'More bookings');
  assert (select count(*) from public.site_memory where site_id = s and kind = 'answer' and key = 'goals') = 2 and (select count(*) from public.site_memory where site_id = s and kind = 'answer' and key = 'goals' and superseded_at is null) = 1, 'a new answer supersedes, history kept';
  begin perform public.answer_question(s, 'not_a_question', 'x'); raise exception 'answered an unknown question'; exception when raise_exception then if sqlerrm not like 'no such question%' then raise; end if; end;
  begin perform public.answer_question(s, 'competitors', ''); raise exception 'empty answer'; exception when raise_exception then if sqlerrm not like 'answer must be%' then raise; end if; end;
  begin perform public.answer_question(s, 'competitors', repeat('x', 2001)); raise exception 'long answer'; exception when raise_exception then if sqlerrm not like 'answer must be%' then raise; end if; end;
  -- Retry: escalated low-risk work goes back to the queue with fresh attempts.
  assert (public.retry_job((select v from ids where k = 'retry_job'), 'provider is back')).status = 'queued', 'retried';
  assert (select attempts from public.jobs where id = (select v from ids where k = 'retry_job')) = 0, 'fresh attempts';
  begin perform public.retry_job((select v from ids where k = 'retry_job')); raise exception 'retried a queued job'; exception when raise_exception then if sqlerrm not like 'only escalated%' then raise; end if; end;
  -- Gated work with no standing approval cannot be queued, even by the agency's retry.
  begin perform public.retry_job((select v from ids where k = 'gated_job')); raise exception 'queued gated work without approval'; exception when raise_exception then if sqlerrm not like '%approval%' then raise; end if; end;
  assert (select status from public.jobs where id = (select v from ids where k = 'gated_job')) = 'escalated', 'still escalated';
  assert exists (select 1 from public.audit_log where action = 'memory.answer') and exists (select 1 from public.audit_log where action = 'job.retry'), 'audited';
end $$;
reset role;

-- Agency B and a client viewer of agency A's site: refused everywhere.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b'; set request.jwt.claim.role = 'authenticated';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); begin
  begin perform public.god_console(s); raise exception 'agency B read the console'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.answer_question(s, 'competitors', 'x'); raise exception 'agency B answered'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.retry_job((select v from ids where k = 'gated_job')); raise exception 'agency B retried'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1'; set request.jwt.claim.role = 'authenticated';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); begin
  begin perform public.god_console(s); raise exception 'client read the console'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.answer_question(s, 'competitors', 'x'); raise exception 'client answered'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
reset role;
set role anon; set request.jwt.claim.role = 'anon';
do $$ begin begin perform public.god_console((select v from ids where k = 'alice_site')); raise exception 'anon read the console'; exception when insufficient_privilege then null; end; end $$;
reset role;
select 'all agency console checks passed' as result;
