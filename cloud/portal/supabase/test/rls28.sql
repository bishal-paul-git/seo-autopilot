-- Invite requests from the landing page (20261121000000_invite_requests.sql, D59). Run after rls27.sql.
-- Covers: anon can submit but never read; input checks and length limits; the honeypot stores nothing; one row per email
-- and the same answer for a repeat, an existing user or a robot; at most 20 new requests an hour; the list and the
-- decisions for platform admins only (Bob, since rls11.sql); "invited" lets that email sign up into its own agency;
-- admins get a notification for each new request, members do not.
\set ON_ERROR_STOP on
delete from public.invite_requests;

-- Anon submits. The answer never says whether the email was known.
set role anon; set request.jwt.claim.role = 'anon'; set request.jwt.claim.sub = '';
do $$ declare a jsonb; b jsonb; c jsonb; begin
  a := public.request_invite('  Dana   Owner ', ' Dana@Shop.TEST ', 'shop.test', '2-5', 'We run three shops.' || chr(7));
  assert (a->>'ok')::boolean, 'stored: ' || a::text;
  b := public.request_invite('Someone else', 'dana@shop.test', 'other.test', '100+', 'overwrite?');
  assert b = a, 'a repeat gets the same answer';
  c := public.request_invite('Alice', 'alice@agency-a.test', 'agency-a.test', '1');
  assert c = a, 'an existing user gets the same answer';
  assert public.request_invite('Bot', 'bot@spam.test', 'spam.test', '1', null, 'http://spam.test') = a, 'a robot gets the same answer';
  begin perform 1 from public.invite_requests; raise exception 'anon read the requests'; exception when insufficient_privilege then null; end;
  begin insert into public.invite_requests (name, email, company, sites) values ('x', 'x@x.test', 'x', '1'); raise exception 'anon wrote directly'; exception when insufficient_privilege then null; end;
  begin perform public.invite_requests_list(); raise exception 'anon listed the requests'; exception when insufficient_privilege then null; end;
  begin perform public.decide_invite_request(1, 'invited'); raise exception 'anon decided'; exception when insufficient_privilege then null; end;
end $$;
-- Input checks: each refused with a plain message, nothing stored.
do $$ declare bad text[][] := array[
    array['', 'e1@x.test', 'x.test', '1', 'name'], array[repeat('n', 101), 'e2@x.test', 'x.test', '1', 'name'],
    array['N', 'not-an-email', 'x.test', '1', 'email'], array['N', 'a@b', 'x.test', '1', 'email'], array['N', repeat('e', 250) || '@x.test', 'x.test', '1', 'email'],
    array['N', 'e3@x.test', ' ', '1', 'company'], array['N', 'e4@x.test', repeat('c', 201), '1', 'company'],
    array['N', 'e5@x.test', 'x.test', '7', 'websites'], array['N', 'e6@x.test', 'x.test', '', 'websites']]; i int; begin
  for i in 1 .. array_length(bad, 1) loop
    begin perform public.request_invite(bad[i][1], bad[i][2], bad[i][3], bad[i][4]); raise exception 'accepted bad %', bad[i][5];
    exception when invalid_parameter_value then assert sqlerrm ilike '%' || bad[i][5] || '%' or (bad[i][5] = 'websites' and sqlerrm ilike '%how many%'), sqlerrm; end;
  end loop;
  begin perform public.request_invite('N', 'e7@x.test', 'x.test', '1', repeat('x', 1001)); raise exception 'accepted a long note';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ declare r public.invite_requests; begin
  assert (select count(*) from public.invite_requests) = 2, 'only Dana and Alice stored (no robot, no bad input): ' || (select count(*) from public.invite_requests);
  select * into r from public.invite_requests where email = 'dana@shop.test';
  assert r.name = 'Dana Owner' and r.company = 'shop.test' and r.sites = '2-5' and r.note = 'We run three shops.' and r.repeats = 1 and r.status = 'new', 'trimmed, first answer kept, repeat counted: ' || row_to_json(r)::text;
end $$;

-- At most 20 new requests an hour across the service; a repeat of a known email is still answered.
set role anon; set request.jwt.claim.role = 'anon';
do $$ declare i int; begin
  for i in 3 .. 20 loop perform public.request_invite('Person ' || i, 'p' || i || '@flood.test', 'flood.test', '1'); end loop;
  begin perform public.request_invite('One more', 'p21@flood.test', 'flood.test', '1'); raise exception 'the 21st request in an hour was stored';
  exception when sqlstate 'PT429' then assert sqlerrm like '%try again later%', sqlerrm; end;
  assert (public.request_invite('Dana', 'dana@shop.test', 'shop.test', '2-5')->>'ok')::boolean, 'a repeat is not a new row';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.invite_requests) = 20, '20 rows';
  update public.invite_requests set created_at = now() - interval '2 hours' where email like '%@flood.test';
end $$;
set role anon; set request.jwt.claim.role = 'anon';
do $$ begin assert (public.request_invite('Later', 'later@shop.test', 'later.test', '6-20')->>'ok')::boolean, 'an hour later new requests are taken again'; end $$;
reset role;

-- An agency member (Alice) cannot list or decide, and gets no notification for requests.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  begin perform public.invite_requests_list(); raise exception 'a member listed the requests'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.decide_invite_request((select 1::bigint), 'invited'); raise exception 'a member decided'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform 1 from public.invite_requests; raise exception 'a member read the table'; exception when insufficient_privilege then null; end;
  assert not exists (select 1 from jsonb_array_elements(public.my_notifications()->'items') n where n->>'kind' = 'invite_request'), 'no notification for a member';
end $$;
reset role;

-- The platform admin (Bob) lists them, newest first within "new", sees who already has an account, and decides.
create temp table ir_ids (k text primary key, v bigint);
grant all on ir_ids to authenticated;
insert into ir_ids select 'dana', id from public.invite_requests where email = 'dana@shop.test';
insert into ir_ids select 'alice', id from public.invite_requests where email = 'alice@agency-a.test';
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ declare l jsonb := public.invite_requests_list(); d jsonb; n jsonb; begin
  assert jsonb_array_length(l) = 21, 'all requests: ' || jsonb_array_length(l);
  assert l->0->>'email' = 'later@shop.test', 'newest new first: ' || (l->0)::text;
  select x into d from jsonb_array_elements(l) x where x->>'email' = 'dana@shop.test';
  assert d->>'name' = 'Dana Owner' and d->>'sites' = '2-5' and (d->>'repeats')::int = 2 and not (d->>'hasAccount')::boolean, 'Dana: ' || d::text;
  assert (select (x->>'hasAccount')::boolean from jsonb_array_elements(l) x where x->>'email' = 'alice@agency-a.test'), 'Alice already has an account';
  n := public.my_notifications();
  assert exists (select 1 from jsonb_array_elements(n->'items') i where i->>'kind' = 'invite_request' and i->>'title' like 'Invite request: Dana Owner · shop.test · 2-5 websites%'), 'admin notified: ' || (n->'items')::text;
  d := public.decide_invite_request((select v from ir_ids where k = 'dana'), 'invited');
  assert d->>'status' = 'invited' and d->>'email' = 'dana@shop.test', 'invited: ' || d::text;
  assert public.decide_invite_request((select v from ir_ids where k = 'alice'), 'declined')->>'status' = 'declined', 'declined';
  begin perform public.decide_invite_request((select v from ir_ids where k = 'alice'), 'maybe'); raise exception 'odd decision accepted'; exception when raise_exception then if sqlerrm not like 'decision must be%' then raise; end if; end;
  begin perform public.decide_invite_request(-1, 'invited'); raise exception 'missing request decided'; exception when raise_exception then if sqlerrm <> 'no such request' then raise; end if; end;
  assert not exists (select 1 from jsonb_array_elements(public.my_notifications()->'items') i where i->>'kind' = 'invite_request' and i->>'title' like '%Dana%'), 'decided requests leave the notifications';
  assert (select x->>'decidedBy' from jsonb_array_elements(public.invite_requests_list()) x where x->>'email' = 'dana@shop.test') = 'bob@agency-b.test', 'who decided is shown';
end $$;
reset role;

-- A declined request does not reopen when the person asks again.
set role anon; set request.jwt.claim.role = 'anon';
do $$ begin perform public.request_invite('Alice', 'alice@agency-a.test', 'agency-a.test', '1'); end $$;
reset role;
do $$ begin assert (select status from public.invite_requests where email = 'alice@agency-a.test') = 'declined', 'still declined'; end $$;

-- "Invited" lets that email sign up (invite-only stays on), into its own new agency; others are still refused.
do $$ begin assert private.invite_only(), 'invite-only is on for this check'; end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000f281', 'Dana@Shop.test');
do $$ begin
  assert exists (select 1 from public.org_members where user_id = '00000000-0000-0000-0000-00000000f281' and role = 'owner'), 'Dana owns a new agency';
  assert (select count(*) from public.org_members where org_id = (select org_id from public.org_members where user_id = '00000000-0000-0000-0000-00000000f281')) = 1, 'alone in it';
  begin insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000f282', 'later@shop.test'); raise exception 'a request still waiting let someone sign up';
  exception when raise_exception then if sqlerrm <> 'sign-up is by invitation only' then raise; end if; end;
end $$;
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin assert (select (x->>'hasAccount')::boolean from jsonb_array_elements(public.invite_requests_list()) x where x->>'email' = 'dana@shop.test'), 'Dana has an account now'; end $$;
reset role;
\echo rls28 ok
