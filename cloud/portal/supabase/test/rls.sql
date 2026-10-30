-- Access checks for the portal schema. Run after shim.sql and the migration; any failed check raises and stops.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'alice@agency-a.test'), ('00000000-0000-0000-0000-00000000000b', 'bob@agency-b.test');
do $$ begin assert (select count(*) from public.orgs) = 2, 'each signup gets an org'; end $$;

-- Alice adds a website and gets a token and a client link.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
create temp table t_alice as select public.create_site('Plumber', 'https://plumber.test/', 'acme/plumber') as r;
do $$ begin assert (select (r->>'token') like 'spt_%' from t_alice), 'token returned once'; end $$;
create temp table t_link as select public.create_share_link(((select r from t_alice)->'site'->>'id')::uuid, 'client') as token;
grant select on t_alice, t_link to public; -- the test's own temp tables, read later under other roles
do $$ begin assert (select count(*) from public.sites) = 1, 'alice sees her site'; end $$;
-- Writing directly is not allowed: snapshots come only through ingest_snapshot.
do $$ begin
  begin insert into public.site_snapshots (site_id, data) values (((select r from t_alice)->'site'->>'id')::uuid, '{}'); raise exception 'insert should fail';
  exception when insufficient_privilege then null; end;
  begin perform public.ingest_snapshot((select r->>'token' from t_alice), '{}'); raise exception 'ingest should be service role only';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- The ingest function (service role) adds a snapshot with the token; a wrong token is refused.
set role service_role;
do $$ begin
  assert (public.ingest_snapshot((select r->>'token' from t_alice), '{"version":1,"keywords":[]}')->>'ok') = 'true', 'ingest ok';
  assert (public.ingest_snapshot('spt_wrong', '{}')->>'error') = 'unknown token', 'wrong token refused';
  assert (public.ingest_snapshot((select r->>'token' from t_alice), '[]')->>'error') is not null, 'array refused';
end $$;
reset role;

-- Bob, in another agency, sees nothing of Alice's and cannot make links or tokens for her site.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from public.sites) = 0, 'bob sees no sites';
  assert (select count(*) from public.site_snapshots) = 0, 'bob sees no snapshots';
  assert (select count(*) from public.share_links) = 0, 'bob sees no links';
  assert (select count(*) from public.orgs) = 1, 'bob sees only his org';
  assert jsonb_array_length(public.my_sites()) = 0, 'bob my_sites empty';
  begin perform public.create_share_link(((select r from t_alice)->'site'->>'id')::uuid); raise exception 'should fail'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.rotate_site_token(((select r from t_alice)->'site'->>'id')::uuid); raise exception 'should fail'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  update public.sites set name = 'hijack'; -- RLS: touches no rows
end $$;
reset role;
do $$ begin assert (select name from public.sites) = 'Plumber', 'bob could not rename'; end $$;

-- A client with the link (anon) sees the site's latest snapshot; a revoked or unknown link shows nothing; anon reads no tables.
set role anon;
do $$ begin
  assert (public.shared_site((select token from t_link))->'site'->>'name') = 'Plumber', 'link works';
  assert (public.shared_site((select token from t_link))->'data'->>'version') = '1', 'latest snapshot';
  assert public.shared_site('nope') is null, 'unknown link';
  begin perform count(*) from public.sites; raise exception 'anon read sites'; exception when insufficient_privilege then null; end;
  begin perform count(*) from private.ingest_tokens; raise exception 'anon read tokens'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.share_links set revoked_at = now();
do $$ begin assert jsonb_array_length(public.my_sites()) = 1 and (public.my_sites()->0->'data'->>'version') = '1', 'alice my_sites'; end $$;
reset role;
set role anon;
do $$ begin assert public.shared_site((select token from t_link)) is null, 'revoked link'; end $$;
reset role;

-- Rotating the token stops the old one.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
create temp table t_new as select public.rotate_site_token(((select r from t_alice)->'site'->>'id')::uuid) as token;
grant select on t_new to public;
reset role;
set role service_role;
do $$ begin
  assert (public.ingest_snapshot((select r->>'token' from t_alice), '{}')->>'error') = 'unknown token', 'old token dead';
  assert (public.ingest_snapshot((select token from t_new), '{}')->>'ok') = 'true', 'new token works';
end $$;
reset role;
select 'all portal access checks passed' as result;
