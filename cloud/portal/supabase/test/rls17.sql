-- Notifications and the monthly work report (20261108120000_notifications_reports.sql, D38). Run after rls16.sql.
\set ON_ERROR_STOP on
-- Alice's agency has work waiting: she is told; Bob's agency never sees Alice's items.
insert into public.jobs (org_id, site_id, kind, title, source, status, risk)
  select org_id, id, 'agent:title-tuner', 'Notify me: titles', 'seo_god', 'awaiting_approval', 'low' from public.sites where id = (select v from ids where k = 'alice_site');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ declare n jsonb := public.my_notifications(); begin
  assert (n->>'unread')::int >= 1, 'something unread for alice';
  assert exists (select 1 from jsonb_array_elements(n->'items') i where i->>'kind' = 'approval'), 'approvals listed';
  assert not exists (select 1 from jsonb_array_elements(n->'items') i where (i->>'site')::uuid = (select v from ids where k = 'bob_site')), 'only her own websites';
  perform public.mark_notifications_seen();
  assert (public.my_notifications()->>'unread')::int = 0, 'seen';
end $$;
reset role;
-- Something new after she looked is unread again.
update public.jobs set updated_at = now() + interval '1 second' where title = 'Notify me: titles';
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ begin assert (public.my_notifications()->>'unread')::int = 1, 'new item unread'; end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b'; set request.jwt.claim.role = 'authenticated';
do $$ declare n jsonb := public.my_notifications(); begin
  assert not exists (select 1 from jsonb_array_elements(n->'items') i where (i->>'site')::uuid = (select v from ids where k = 'alice_site')), 'bob never sees alice''s work';
end $$;
reset role;
-- A client account sees only answers to its own requests, never agency work.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1'; set request.jwt.claim.role = 'authenticated';
do $$ declare n jsonb := public.my_notifications(); begin
  assert not exists (select 1 from jsonb_array_elements(n->'items') i where i->>'kind' <> 'answer'), 'clients see answers only';
end $$;
reset role;
-- Anonymous visitors get nothing.
set role anon; set request.jwt.claim.sub = ''; set request.jwt.claim.role = 'anon';
do $$ begin
  begin perform public.my_notifications(); raise exception 'anon read notifications'; exception when insufficient_privilege then null; end;
  begin perform public.site_work_report((select v from ids where k = 'alice_site')); raise exception 'anon read a report'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- The work report: the agency and the site's client can read it; another agency cannot; nothing internal in it.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ declare r jsonb := public.site_work_report((select v from ids where k = 'alice_site')); begin
  assert r->'site'->>'name' like 'Plumber%' and r->>'month' = to_char(now(), 'YYYY-MM');
  assert jsonb_array_length(r->'advice') >= 1, 'accepted advice this month is listed';
  assert r::text not like '%cost%' and r::text not like '%analysis%' and r::text not like '%budget%' and r::text not like '%github_pat%', 'no internal details';
  assert jsonb_array_length((public.site_work_report((select v from ids where k = 'alice_site'), (now() - interval '2 months')::date))->'advice') = 0, 'another month is empty';
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1'; set request.jwt.claim.role = 'authenticated';
do $$ begin assert (public.site_work_report((select v from ids where k = 'alice_site')))->'site'->>'name' like 'Plumber%', 'the client reads its own site''s report'; end $$;
do $$ begin
  begin perform public.site_work_report((select v from ids where k = 'bob_site')); raise exception 'client read another site''s report'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b'; set request.jwt.claim.role = 'authenticated';
do $$ begin
  begin perform public.site_work_report((select v from ids where k = 'alice_site')); raise exception 'another agency read the report'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
reset role;
\echo all notification and report checks passed
