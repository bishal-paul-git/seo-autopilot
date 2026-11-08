-- Email through Supabase SMTP (20261108130000_email.sql, D40). Run after rls17.sql.
\set ON_ERROR_STOP on
-- Pending invitations to people without an account are queued for email once; existing accounts never are.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
select public.invite_member('new.writer@agency-a.test');
do $$ begin
  assert public.my_email_summary(), 'summary on by default';
  perform public.set_email_summary(false);
  begin perform public.email_queue(); raise exception 'a member read the email queue'; exception when insufficient_privilege then null; end;
  begin perform public.email_sent('summary', '00000000-0000-0000-0000-00000000000a'); raise exception 'a member marked email as sent'; exception when insufficient_privilege then null; end;
end $$;
do $$ begin assert not public.my_email_summary(), 'switched off'; end $$;
reset role;
insert into public.client_invites (client_id, email, invited_by) select id, 'boss@client-two.test', '00000000-0000-0000-0000-00000000000a' from public.clients limit 1;
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare q jsonb := public.email_queue(); a jsonb; c jsonb; begin
  select x into a from jsonb_array_elements(q->'invites') x where x->>'email' = 'new.writer@agency-a.test';
  select x into c from jsonb_array_elements(q->'invites') x where x->>'email' = 'boss@client-two.test';
  assert a->>'kind' = 'agency' and a->>'agency' is not null, 'agency invite queued with the agency name';
  assert c->>'kind' = 'client', 'client invite queued';
  assert not exists (select 1 from jsonb_array_elements(q->'invites') x where x->>'email' = 'alice@agency-a.test'), 'existing accounts are never invited by email';
  -- Alice switched her summary off: she is not in the list even with unseen items.
  assert not exists (select 1 from jsonb_array_elements(q->'summaries') s where s->>'user_id' = '00000000-0000-0000-0000-00000000000a'), 'opted out';
  perform public.email_sent('agency', a->>'id'); perform public.email_sent('client', c->>'id');
  q := public.email_queue();
  assert not exists (select 1 from jsonb_array_elements(q->'invites') x where x->>'email' in ('new.writer@agency-a.test', 'boss@client-two.test')), 'emailed once';
end $$;
reset role;
-- Summary back on: Alice is due one, with only her own agency's items; once sent, not again the same day.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
select public.set_email_summary(true);
reset role;
update public.jobs set updated_at = now() + interval '5 seconds' where title = 'Notify me: titles'; -- something unseen
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare s jsonb; begin
  select x into s from jsonb_array_elements(public.email_queue()->'summaries') x where x->>'user_id' = '00000000-0000-0000-0000-00000000000a';
  assert s is not null and s->>'email' = 'alice@agency-a.test', 'alice is due a summary';
  assert jsonb_array_length(s->'items') >= 1, 'with items';
  assert not exists (select 1 from jsonb_array_elements(s->'items') i where (i->>'site')::uuid = (select v from ids where k = 'bob_site')), 'only her own agency';
  perform public.email_sent('summary', s->>'user_id');
  assert not exists (select 1 from jsonb_array_elements(public.email_queue()->'summaries') x where x->>'user_id' = '00000000-0000-0000-0000-00000000000a'), 'at most one a day';
  begin perform public.email_sent('other', 'x'); raise exception 'unknown kind accepted'; exception when raise_exception then if sqlerrm <> 'unknown kind' then raise; end if; end;
end $$;
reset role;
-- The scan secret: the service role can read it (the Worker), nobody else.
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ begin assert public.scan_secret() = 'test-secret', 'service reads the secret'; end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ begin begin perform public.scan_secret(); raise exception 'a member read the scan secret'; exception when insufficient_privilege then null; end; end $$;
reset role;
\echo all email checks passed
