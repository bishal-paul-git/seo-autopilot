-- Strategy draft adopted with one approval (20261108090000_strategy_draft.sql): the worker can send ungated work to
-- the agency, but never decide it. Run after rls12.sql.
\set ON_ERROR_STOP on
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); j public.jobs; begin
  j := public.create_job(s, 'strategy_proposal', 'Draft the strategy', 'seo_god', 'medium', false, 2, '{}', 'd35:draft');
  assert not j.requires_approval, 'drafting is ungated';
  perform public.transition_job(j.id, 'scoped', 'seo-god'); perform public.transition_job(j.id, 'queued', 'seo-god');
  perform public.claim_job('w'); -- claims the oldest queued job; make sure it is ours
  update public.jobs set status = 'queued', lease_owner = null where status = 'running' and id <> j.id;
  if (select status from public.jobs where id = j.id) <> 'running' then perform public.transition_job(j.id, 'running', 'w'); end if;
  perform public.transition_job(j.id, 'awaiting_review', 'w');
  perform public.record_review(j.id, 'quality-gate@1', 'pass');
  perform public.transition_job(j.id, 'awaiting_approval', 'quality-gate@1', 'waiting for the agency to adopt it');
  begin perform public.transition_job(j.id, 'authorized', 'w'); raise exception 'worker adopted its own draft'; exception when raise_exception then if sqlerrm not like 'only an agency approval%' then raise; end if; end;
  begin perform public.transition_job(j.id, 'rejected', 'w'); raise exception 'worker rejected'; exception when raise_exception then if sqlerrm not like 'only an agency approval%' then raise; end if; end;
  insert into ids values ('draft_job', j.id);
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ begin assert (public.approve_job((select v from ids where k = 'draft_job'), 'approve', 'adopt')).status = 'authorized', 'the agency adopts it with one approval'; end $$;
reset role;
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare j public.jobs; begin
  -- Ungated work that never waited for the agency is still authorized by the worker after review, as before.
  j := public.create_job((select v from ids where k = 'alice_site'), 'agent:seo-reporter', 'Report', 'seo_god', 'medium', false, 3, '{}', 'd35:plain');
  update public.jobs set status = 'awaiting_review' where id = j.id;
  perform public.record_review(j.id, 'quality-gate@1', 'pass');
  assert (public.transition_job(j.id, 'authorized', 'quality-gate@1')).status = 'authorized', 'reviewed ungated work proceeds';
end $$;
reset role;
select 'all strategy draft checks passed' as result;
