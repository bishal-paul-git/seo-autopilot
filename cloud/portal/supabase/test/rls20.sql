-- Business brief (20261113000000_business_brief.sql, D44). Run after rls19.sql.
\set ON_ERROR_STOP on
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ declare s uuid := (select v from ids where k = 'alice_site'); r jsonb; b jsonb; begin
  r := public.save_brief(s, '{"goals": "  More boiler repair enquiries ", "competitors": "rival.test", "contact_email": ""}');
  assert (r->>'saved')::int = 2, 'two saved, empty one ignored: ' || r::text;
  b := public.site_brief(s);
  assert b->'answers'->>'goals' = 'More boiler repair enquiries', 'trimmed';
  assert b->'answers'->>'competitors' = 'rival.test';
  -- Same value again: nothing new; empty clears it.
  r := public.save_brief(s, '{"goals": "More boiler repair enquiries", "competitors": ""}');
  assert (r->>'saved')::int = 0 and (r->>'cleared')::int = 1, 'unchanged skipped, cleared counted: ' || r::text;
  assert not (public.site_brief(s)->'answers' ? 'competitors'), 'cleared';
  assert (select count(*) from public.site_memory where site_id = s and kind = 'answer' and key = 'goals' and superseded_at is null) = 1, 'one current answer';
  begin perform public.save_brief(s, '{"secret_plan": "x"}'); raise exception 'unknown key saved'; exception when raise_exception then if sqlerrm not like 'unknown field%' then raise; end if; end;
  begin perform public.save_brief(s, jsonb_build_object('goals', repeat('x', 2001))); raise exception 'too long saved'; exception when raise_exception then if sqlerrm not like '%2000%' then raise; end if; end;
  begin perform public.save_brief(s, '"text"'); raise exception 'non-object saved'; exception when raise_exception then if sqlerrm <> 'answers must be an object' then raise; end if; end;
  assert exists (select 1 from public.audit_log where site_id = s and action = 'memory.brief'), 'audited';
end $$;
-- Another agency and a client of the site cannot read or write it; anon cannot call it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin perform public.save_brief((select v from ids where k = 'alice_site'), '{"goals": "hijack"}'); raise exception 'other agency wrote'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
do $$ begin perform public.site_brief((select v from ids where k = 'alice_site')); raise exception 'other agency read'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin perform public.site_brief((select v from ids where k = 'alice_site')); raise exception 'client read'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
reset role;
set role anon;
do $$ begin perform public.site_brief((select v from ids where k = 'alice_site')); raise exception 'anon called it'; exception when insufficient_privilege then null; end $$;
reset role;
do $$ begin assert not exists (select 1 from public.site_memory where value->>'value' = 'hijack'), 'nothing written by outsiders'; end $$;
\echo rls20 ok
