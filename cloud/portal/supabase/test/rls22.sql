-- Search Console confirmation list (20261115000000_gsc_sites.sql, D47). Run after rls21.sql. Bob is a platform admin (rls11).
\set ON_ERROR_STOP on
create temp table gsc_n as select count(*) n from public.sites; grant select on gsc_n to authenticated;
set role authenticated; set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ declare g jsonb; n bigint; begin
  select gsc_n.n into n from gsc_n;
  g := public.gsc_sites();
  assert jsonb_array_length(g) = n, 'every website listed for a platform admin';
  assert not exists (select 1 from jsonb_array_elements(g) x where not (x ? 'allowed' and x ? 'conflict' and x ? 'agency')), 'fields';
end $$;
-- An agency owner who is not a platform admin, and anon, cannot list them.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin perform public.gsc_sites(); raise exception 'non-admin listed sites'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
reset role;
set role anon;
do $$ begin perform public.gsc_sites(); raise exception 'anon called it'; exception when insufficient_privilege then null; end $$;
reset role;
\echo rls22 ok
