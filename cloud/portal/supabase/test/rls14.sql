-- Invite-only sign-up (20261108100000_invite_only.sql, owner decision Q8). Run after the last suite.
\set ON_ERROR_STOP on
-- Strangers cannot create an account; nothing is half-created.
do $$ declare n int := (select count(*) from public.orgs); begin
  begin insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'stranger@nowhere.test'); raise exception 'stranger signed up';
  exception when raise_exception then if sqlerrm <> 'sign-up is by invitation only' then raise; end if; end;
  assert not exists (select 1 from auth.users where email = 'stranger@nowhere.test'), 'no account';
  assert (select count(*) from public.orgs) = n, 'no workspace';
end $$;
-- An agency invite still works: the invited person signs up with that email and joins the inviting agency.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
select public.invite_member('New.Colleague@Agency-A.test');
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e2', 'new.colleague@agency-a.test');
do $$ begin
  assert exists (select 1 from public.org_members m join public.org_members a on a.org_id = m.org_id
    where m.user_id = '00000000-0000-0000-0000-0000000000e2' and a.user_id = '00000000-0000-0000-0000-00000000000a'), 'joined the inviting agency';
  assert (select accepted_at is not null from public.invites where email = 'new.colleague@agency-a.test'), 'invite accepted';
end $$;
-- A used invite does not let a second account in with the same address (the first already exists), nor anyone else.
do $$ begin
  begin insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e3', 'other@agency-a.test'); raise exception 'uninvited colleague signed up';
  exception when raise_exception then if sqlerrm <> 'sign-up is by invitation only' then raise; end if; end;
end $$;
-- A client invite still works.
set role service_role; set request.jwt.claim.role = 'service_role';
insert into public.client_invites (client_id, email, invited_by) select id, 'owner@client-new.test', '00000000-0000-0000-0000-00000000000a' from public.clients limit 1;
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e4', 'owner@client-new.test');
do $$ begin assert exists (select 1 from public.client_members where user_id = '00000000-0000-0000-0000-0000000000e4'), 'client joined'; end $$;
-- Existing users are untouched (sign-in does not insert into auth.users).
do $$ begin assert (select count(*) from auth.users where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')) = 2; end $$;
-- Only a platform admin (Bob, since rls11.sql) or the service role can open sign-up; members cannot.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ begin
  begin perform public.set_invite_only(false); raise exception 'member opened sign-up'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
do $$ begin
  begin perform 1 from private.platform_settings; raise exception 'member read platform settings'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b'; set request.jwt.claim.role = 'authenticated';
select public.set_invite_only(false);
reset role;
-- Open: a new person gets their own workspace, as before.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e5', 'founder@new-agency.test');
do $$ begin assert exists (select 1 from public.org_members where user_id = '00000000-0000-0000-0000-0000000000e5' and role = 'owner'), 'own workspace'; end $$;
set role service_role; set request.jwt.claim.role = 'service_role';
select public.set_invite_only(true);
reset role;
do $$ begin
  begin insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e6', 'late@nowhere.test'); raise exception 'closed again but stranger got in';
  exception when raise_exception then if sqlerrm <> 'sign-up is by invitation only' then raise; end if; end;
end $$;
\echo all invite-only checks passed
