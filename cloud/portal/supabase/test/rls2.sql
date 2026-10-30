-- Access checks for the second migration (decisions, invites, branding, growth). Run after rls.sql on the same database.
\set ON_ERROR_STOP on
-- Alice (owner, agency A) decides on issue 12 of her site; Bob (agency B) cannot.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
create temp table t_site as select id from public.sites limit 1;
grant select on t_site to public;
do $$ begin
  assert (public.decide_proposal((select id from t_site), 12, 'approve', 'go')->>'decided_email') = 'alice@agency-a.test', 'decision records who';
  perform public.decide_proposal((select id from t_site), 13, 'decline');
  begin perform public.decide_proposal((select id from t_site), 14, 'merge'); raise exception 'bad decision accepted'; exception when raise_exception then if sqlerrm not like 'decision must%' then raise; end if; end;
  assert jsonb_array_length(public.my_sites()->0->'decisions') = 2, 'my_sites lists decisions';
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  begin perform public.decide_proposal((select id from t_site), 12, 'decline'); raise exception 'bob decided'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  assert (select count(*) from public.decisions) = 0, 'bob sees no decisions';
  begin perform public.site_growth((select id from t_site)); raise exception 'bob growth'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
reset role;

-- The site's run (service role, with the site token) fetches pending decisions and acknowledges the applied ones.
set role service_role;
do $$ declare v jsonb; begin
  v := public.sync_decisions((select token from t_new));
  assert jsonb_array_length(v->'decisions') = 2, 'two pending';
  v := public.sync_decisions((select token from t_new), array[(v->'decisions'->0->>'id')::bigint]);
  assert jsonb_array_length(v->'decisions') = 1, 'one left after ack';
  assert (public.sync_decisions('spt_wrong')->>'error') = 'unknown token', 'wrong token';
end $$;
reset role;
set role anon;
do $$ begin begin perform public.sync_decisions((select token from t_new)); raise exception 'anon synced'; exception when insufficient_privilege then null; end; end $$;
reset role;

-- Invitations: an owner invites; a new account with that email joins on sign-up; a member cannot invite.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin perform public.invite_member('Carol@Agency-A.test'); end $$;
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000c', 'carol@agency-a.test');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  assert (select count(*) from public.sites) = 1, 'carol sees the agency site';
  begin perform public.invite_member('dave@x.test', 'member', (select org_id from public.sites limit 1)); raise exception 'member invited into agency A'; exception when raise_exception then if sqlerrm not like 'only an owner%' then raise; end if; end;
  assert jsonb_array_length(public.org_people()) >= 2, 'carol sees her colleagues';
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin assert not exists (select 1 from jsonb_array_elements(public.org_people()) p where p->>'email' like '%agency-a%'), 'bob sees no agency A people'; end $$;
reset role;

-- Branding: only the owner may change it; the client link shows it, with growth rows.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
update public.orgs set brand_color = '#112233'; -- member: RLS lets no row through
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.orgs set brand_name = 'Agency A', brand_color = '#0f9d74' where id = (select org_id from public.sites limit 1);
do $$ begin assert jsonb_array_length(public.site_growth((select id from t_site))) >= 1, 'growth rows'; end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
create temp table t_link3 as select public.create_share_link((select id from t_site)) as token;
grant select on t_link3 to public;
reset role;
set role anon;
do $$ declare v jsonb := public.shared_site((select token from t_link3)); begin
  assert v->'brand'->>'name' = 'Agency A' and v->'brand'->>'color' = '#0f9d74', 'brand on client link';
  assert jsonb_array_length(v->'growth') >= 1 and (v->'growth'->0 ? 'score'), 'growth on client link';
end $$;
reset role;
select 'all second-step access checks passed' as result;
