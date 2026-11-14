-- Give us read access (20261118000000_google_access.sql, D56). Run after rls24.sql.
-- Covers: who may check and bind, the Worker's lists filtered to the site's host, validation of the picks, one property
-- and one host per website across every agency, refusals recorded for the platform admin (Bob is one, rls11.sql), the
-- D34 rule for a domain two agencies registered, the address-change reset, client users, and the pipeline state.
\set ON_ERROR_STOP on
create temp table g_ids (k text primary key, v text);
grant all on g_ids to authenticated, service_role, anon;
insert into g_ids select 'host', private.site_host(url) from public.sites where id = (select v from ids where k = 'alice_site');

-- The coverage rule (superuser: these are private).
do $$ begin
  assert private.gsc_covers('https://www.plumber.test/', 'sc-domain:plumber.test'), 'domain property covers www';
  assert private.gsc_covers('https://blog.plumber.test/', 'sc-domain:plumber.test'), 'domain property covers a subdomain';
  assert private.gsc_covers('https://plumber.test/a', 'https://www.plumber.test/'), 'prefix with www';
  assert not private.gsc_covers('https://plumber.test/', 'sc-domain:notplumber.test'), 'suffix without a dot is another domain';
  assert not private.gsc_covers('https://plumber.test/', 'https://bakery.test/'), 'another host';
  assert not private.gsc_covers('https://plumber.test/', 'sc-domain:blog.plumber.test'), 'a subdomain property does not cover the parent';
  assert private.gsc_pick('https://plumber.test/', '{"sites":[{"url":"https://bakery.test/"},{"url":"http://plumber.test/"},{"url":"https://plumber.test/"},{"url":"sc-domain:plumber.test"}]}') = 'sc-domain:plumber.test', 'domain first';
  assert private.gsc_pick('https://plumber.test/', '{"sites":[{"url":"http://plumber.test/"},{"url":"https://www.plumber.test/"}]}') = 'https://www.plumber.test/', 'https before http';
end $$;

-- Outsiders and anonymous callers get nothing; the browser cannot read the bindings or call the Worker's functions.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin perform public.google_access_site((select v from ids where k = 'alice_site')); raise exception 'bob checked'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
do $$ begin perform public.site_google((select v from ids where k = 'alice_site')); raise exception 'bob read'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
do $$ begin perform public.bind_google((select v from ids where k = 'alice_site'), null, null); raise exception 'bob bound'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare r jsonb := public.google_access_site((select v from ids where k = 'alice_site')); begin assert r->>'role' = 'agency' and r->>'url' like 'http%', 'alice may check: ' || r::text; end $$;
do $$ begin perform 1 from public.google_bindings; raise exception 'read bindings'; exception when insufficient_privilege then null; end $$;
do $$ begin perform 1 from public.google_binding_conflicts; raise exception 'read conflicts'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.google_access_seen((select v from ids where k = 'alice_site'), '{}'); raise exception 'forged a list'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.google_target((select v from ids where k = 'alice_site')); raise exception 'worker function'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.google_conflicts(); raise exception 'not an admin'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
do $$ begin perform public.release_google_binding('x'); raise exception 'not an admin'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
-- Nothing checked yet: a pick is refused.
do $$ begin perform public.bind_google((select v from ids where k = 'alice_site'), 'sc-domain:' || (select v from g_ids where k = 'host'), null); raise exception 'bound unchecked';
  exception when raise_exception then if sqlerrm not like 'that Search Console property was not found%' then raise; end if; end $$;
reset role;
set role anon; set request.jwt.claim.role = 'anon'; set request.jwt.claim.sub = '';
do $$ begin perform public.site_google((select v from ids where k = 'alice_site')); raise exception 'anon read'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.google_access_site((select v from ids where k = 'alice_site')); raise exception 'anon checked'; exception when insufficient_privilege then null; end $$;
reset role;

-- The Worker stores what the service account can read; other hosts and malformed ids are dropped again here.
set role service_role; set request.jwt.claim.role = 'service_role'; set request.jwt.claim.sub = '';
do $$ declare site uuid := (select v from ids where k = 'alice_site'); host text := (select v from g_ids where k = 'host'); r jsonb; begin
  r := public.google_access_seen(site, jsonb_build_object(
    'sites', jsonb_build_array(jsonb_build_object('url', 'https://bakery.test/', 'level', 'siteOwner'), jsonb_build_object('url', 'https://' || host || '/', 'level', 'siteFullUser'), jsonb_build_object('url', 'sc-domain:' || host, 'level', 'siteOwner')),
    'ga4', jsonb_build_array(jsonb_build_object('id', 'properties/111', 'name', 'Plumber web', 'account', 'Plumber'), jsonb_build_object('id', 'bad', 'name', 'x'))));
  assert jsonb_array_length(r->'sites') = 2 and not (r::text like '%bakery%'), 'only this host: ' || r::text;
  assert jsonb_array_length(r->'ga4') = 1 and r->>'suggested' = 'sc-domain:' || host and not (r->'sites'->0->>'taken')::boolean, 'ga4 ids checked; domain suggested';
  assert not public.google_bound(site) and public.google_target(site) is null, 'nothing bound yet';
end $$;
reset role;

-- Alice picks: only listed properties, Search Console only for her host; then binds both.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare site uuid := (select v from ids where k = 'alice_site'); host text := (select v from g_ids where k = 'host'); g jsonb; begin
  begin perform public.bind_google(site, 'https://bakery.test/', null); raise exception 'other host bound'; exception when raise_exception then if sqlerrm not like 'that Search Console property was not found%' then raise; end if; end;
  begin perform public.bind_google(site, 'http://' || host || '/', null); raise exception 'unlisted bound'; exception when raise_exception then if sqlerrm not like 'that Search Console property was not found%' then raise; end if; end;
  begin perform public.bind_google(site, null, 'properties/999'); raise exception 'other GA4 bound'; exception when raise_exception then if sqlerrm not like 'that Analytics property was not found%' then raise; end if; end;
  g := public.bind_google(site, 'sc-domain:' || host, 'properties/111');
  assert (g->>'ok')::boolean and g->>'gscProperty' = 'sc-domain:' || host and g->>'ga4Property' = 'properties/111' and g->>'ga4Name' = 'Plumber web', 'bound: ' || g::text;
  assert g->>'status' = 'connected', 'connected';
end $$;
-- The pipeline: Search Console waits for its first read, Analytics too.
do $$ declare c jsonb; p jsonb := public.site_pipeline((select v from ids where k = 'alice_site')); begin
  select x into c from jsonb_array_elements(p->'connections') x where x->>'key' = 'search_console';
  assert c->>'state' in ('waiting', 'connected'), 'pipeline: ' || c::text;
  assert exists (select 1 from jsonb_array_elements(p->'connections') x where x->>'key' = 'analytics'), 'analytics listed';
end $$;
-- A second site of the same agency on the same host cannot take the property, nor another property of that host.
insert into g_ids select 'twin', (public.create_site('Plumber Two', (select url from public.sites where id = (select v from ids where k = 'alice_site'))))->'site'->>'id';
reset role;
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare host text := (select v from g_ids where k = 'host'); r jsonb; begin
  r := public.google_access_seen((select v::uuid from g_ids where k = 'twin'), jsonb_build_object('sites', jsonb_build_array(jsonb_build_object('url', 'sc-domain:' || host), jsonb_build_object('url', 'https://' || host || '/')), 'ga4', jsonb_build_array(jsonb_build_object('id', 'properties/111', 'name', 'Plumber web'))));
  assert (r->'sites'->0->>'taken')::boolean and (r->'ga4'->0->>'taken')::boolean, 'taken shown: ' || r::text;
end $$;
reset role;
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare twin uuid := (select v::uuid from g_ids where k = 'twin'); host text := (select v from g_ids where k = 'host'); g jsonb; begin
  g := public.bind_google(twin, 'sc-domain:' || host, null);
  assert not (g->>'ok')::boolean and g->>'error' like 'That property is already connected to another website%', 'same property refused: ' || g::text;
  g := public.bind_google(twin, 'https://' || host || '/', null);
  assert not (g->>'ok')::boolean, 'another property of the same host refused';
  g := public.bind_google(twin, null, 'properties/111');
  assert not (g->>'ok')::boolean, 'same GA4 property refused';
  assert public.site_google(twin)->'gscProperty' = 'null'::jsonb, 'nothing bound on the twin';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.google_binding_conflicts where site_id = (select v::uuid from g_ids where k = 'twin')) = 3, 'refusals recorded';
  assert (select count(*) from public.audit_log where action = 'google.conflict') >= 3, 'and audited';
  -- The constraints hold even without the function (a race).
  begin insert into public.google_bindings (org_id, site_id, kind, property) select org_id, id, 'ga4', 'properties/111' from public.sites where id = (select v::uuid from g_ids where k = 'twin'); raise exception 'duplicate property';
  exception when unique_violation then null; end;
end $$;

-- Another agency on the same domain: the D34 rule refuses it and tells the admin; the admin can see and release.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into g_ids select 'squat', (public.create_site('Squatter', 'https://' || (select v from g_ids where k = 'host') || '/'))->'site'->>'id';
reset role;
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ begin perform public.google_access_seen((select v::uuid from g_ids where k = 'squat'), jsonb_build_object('sites', jsonb_build_array(jsonb_build_object('url', 'http://' || (select v from g_ids where k = 'host') || '/')), 'ga4', '[]'::jsonb)); end $$;
reset role;
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ declare g jsonb; c jsonb; begin
  g := public.bind_google((select v::uuid from g_ids where k = 'squat'), 'http://' || (select v from g_ids where k = 'host') || '/', null);
  assert not (g->>'ok')::boolean and g->>'error' like 'This domain is also registered by another agency%', 'cross-agency refused: ' || g::text;
  c := public.google_conflicts(); -- Bob is a platform admin (rls11.sql)
  assert c->0->>'reason' = 'domain also registered in another agency' and c->0->>'site' = 'Squatter', 'admin sees it: ' || (c->0)::text;
end $$;
delete from public.sites where id = (select v::uuid from g_ids where k = 'squat');
reset role;
delete from public.sites where id = (select v::uuid from g_ids where k = 'squat');

-- Worker view; the address changes: the Search Console binding is dropped.
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare site uuid := (select v from ids where k = 'alice_site'); t jsonb := public.google_target(site); begin
  assert public.google_bound(site) and t->>'gscProperty' like 'sc-domain:%' and t->>'ga4Property' = 'properties/111', 'target: ' || t::text;
end $$;
reset role;
do $$ declare site uuid := (select v from ids where k = 'alice_site'); old text := (select url from public.sites where id = site); begin
  update public.sites set url = 'https://moved.test/' where id = site;
  assert not exists (select 1 from public.google_bindings where site_id = site and kind = 'gsc') and exists (select 1 from public.google_bindings where site_id = site and kind = 'ga4'), 'gsc dropped on address change';
  update public.sites set url = old where id = site;
end $$;

-- The site's client user sees the state and may bind for their own site; the admin can release a binding.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ declare site uuid := (select v from ids where k = 'alice_site'); g jsonb := public.site_google(site); begin
  assert g->>'role' = 'client' and g->'lastError' = 'null'::jsonb and g->>'ga4Property' = 'properties/111', 'client view: ' || g::text;
  g := public.bind_google(site, 'https://' || (select v from g_ids where k = 'host') || '/', 'properties/111');
  assert (g->>'ok')::boolean and g->>'gscProperty' like 'https://%', 'client bound their own property';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ declare r jsonb := public.release_google_binding('properties/111'); begin assert r->>'released' = 'properties/111', 'released'; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare g jsonb := public.bind_google((select v from ids where k = 'alice_site'), null, null); begin
  assert (g->>'ok')::boolean and g->'gscProperty' = 'null'::jsonb and g->>'status' = 'unconnected', 'unbound: ' || g::text;
end $$;
reset role;
delete from public.sites where id = (select v::uuid from g_ids where k = 'twin');
\echo rls25 ok
