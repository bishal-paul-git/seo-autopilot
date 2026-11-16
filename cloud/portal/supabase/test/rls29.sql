-- Automatic Google linking (20261123000000_google_autolink.sql, D61). Run after rls28.sql.
-- Covers: only the Worker may call it; when a site is due (live, unbound, once a day, not after a person removed it);
-- a clear pick is bound with bound_via 'auto' and audited; the same checks as bind_google (listed, host, scheme, one
-- property per website, one binding per host, the D34 rule) with refusals recorded once; ambiguity and "nothing seen"
-- kept as reasons; a person's binding is never replaced; the link state on site_google and portfolio_google, per agency;
-- bind_google still refuses as before.
\set ON_ERROR_STOP on
create temp table al_ids (k text primary key, v uuid);
grant all on al_ids to authenticated, service_role, anon;

-- Sites: agency A (Alice) has roofer (www), slate, none, a second roofer on the same host, and cross; agency B (Bob) cross too.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into al_ids select 'roofer', ((public.create_site('Roofer', 'https://www.roofer.test/'))->'site'->>'id')::uuid;
insert into al_ids select 'slate', ((public.create_site('Slate', 'https://slate.test/'))->'site'->>'id')::uuid;
insert into al_ids select 'none', ((public.create_site('Nothing yet', 'https://none.test/'))->'site'->>'id')::uuid;
insert into al_ids select 'twin', ((public.create_site('Roofer again', 'https://roofer.test/'))->'site'->>'id')::uuid;
insert into al_ids select 'cross_a', ((public.create_site('Cross A', 'https://cross.test/'))->'site'->>'id')::uuid;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into al_ids select 'cross_b', ((public.create_site('Cross B', 'https://www.cross.test/'))->'site'->>'id')::uuid;
reset role;
update public.sites set status = 'live' where id in (select v from al_ids);

-- Only the Worker: the browser and anonymous callers cannot link or ask whether a site is due.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin perform public.google_autolink((select v from al_ids where k = 'roofer'), '{}', '{}'); raise exception 'browser linked'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.google_autolink_due((select v from al_ids where k = 'roofer')); raise exception 'browser asked'; exception when insufficient_privilege then null; end $$;
reset role;
set role anon; set request.jwt.claim.role = 'anon'; set request.jwt.claim.sub = '';
do $$ begin perform public.google_autolink((select v from al_ids where k = 'roofer'), '{}', '{}'); raise exception 'anon linked'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.portfolio_google(); raise exception 'anon portfolio'; exception when insufficient_privilege then null; end $$;
reset role;

set role service_role; set request.jwt.claim.role = 'service_role'; set request.jwt.claim.sub = '';
-- Due: live and unbound; not a paused site.
do $$ begin
  assert public.google_autolink_due((select v from al_ids where k = 'roofer')), 'roofer due';
end $$;
reset role;
update public.sites set status = 'paused' where id = (select v from al_ids where k = 'none');
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ begin assert not public.google_autolink_due((select v from al_ids where k = 'none')), 'paused: not due'; end $$;
reset role;
update public.sites set status = 'live' where id = (select v from al_ids where k = 'none');

-- A clear pick: the domain property and the only GA4 property are linked automatically. Other hosts are dropped again.
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare site uuid := (select v from al_ids where k = 'roofer'); r jsonb; begin
  r := public.google_autolink(site,
    '{"sites":[{"url":"sc-domain:roofer.test","level":"siteRestrictedUser"},{"url":"https://www.roofer.test/","level":"siteOwner"},{"url":"https://bakery.test/","level":"siteOwner"}],"ga4":[{"id":"properties/501","name":"Roofer web","account":"Roofer"}]}',
    '{"gsc":"sc-domain:roofer.test","ga4":"properties/501","state":"linked"}');
  assert r->>'state' = 'linked' and (r->>'linked')::boolean and r->>'gscProperty' = 'sc-domain:roofer.test' and r->>'ga4Property' = 'properties/501', 'linked: ' || r::text;
  assert not public.google_autolink_due(site), 'bound: no longer due';
  assert public.google_target(site)->>'gscProperty' = 'sc-domain:roofer.test', 'the Worker reads it';
  -- Again (a second run): nothing changes, nothing is "newly" linked.
  r := public.google_autolink(site, '{"sites":[{"url":"sc-domain:roofer.test"},{"url":"https://www.roofer.test/"}],"ga4":[{"id":"properties/501","name":"Roofer web"}]}', '{"gsc":"sc-domain:roofer.test","state":"linked"}');
  assert r->>'state' = 'linked' and not (r->>'linked')::boolean and r->>'ga4Property' = 'properties/501', 'kept: ' || r::text;
end $$;
reset role;
do $$ declare site uuid := (select v from al_ids where k = 'roofer'); begin
  assert (select bound_via = 'auto' and bound_by is null from public.google_bindings where site_id = site and kind = 'gsc'), 'recorded as automatic';
  assert (select count(*) from public.google_bindings where site_id = site and bound_via = 'auto') = 2, 'both automatic';
  assert (select count(*) from public.audit_log where site_id = site and action = 'google.autolink' and actor is null and data->>'by' = 'auto') = 1, 'audited once';
  assert (select detail->'choices'->'sites' from public.integrations where site_id = site and provider = 'google')::text not like '%bakery%', 'only this host kept';
end $$;

-- The portal: Alice sees "linked automatically"; the portfolio lists her sites only.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare g jsonb := public.site_google((select v from al_ids where k = 'roofer')); p jsonb := public.portfolio_google(); begin
  assert g->'link'->>'state' = 'linked' and g->'link'->>'via' = 'auto' and g->'link'->>'gscProperty' = 'sc-domain:roofer.test' and g->'link'->>'ga4Name' = 'Roofer web', 'site_google link: ' || (g->'link')::text;
  assert g->>'gscProperty' = 'sc-domain:roofer.test' and g->>'status' = 'connected', 'D56 fields unchanged: ' || g::text;
  assert exists (select 1 from jsonb_array_elements(p) x where (x->>'site')::uuid = (select v from al_ids where k = 'roofer') and x->'link'->>'state' = 'linked'), 'portfolio: roofer linked';
  assert not exists (select 1 from jsonb_array_elements(p) x where (x->>'site')::uuid = (select v from al_ids where k = 'cross_b')), 'not agency B''s site';
end $$;
reset role;

-- Same checks as bind_google. Slate: a property not in the list, and a prefix of another host form (www), are refused;
-- the GA4 property of another website is refused and the refusal recorded; nothing is bound and the reason is kept.
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare site uuid := (select v from al_ids where k = 'slate'); r jsonb; begin
  r := public.google_autolink(site, '{"sites":[{"url":"https://www.slate.test/"},{"url":"http://slate.test/"}],"ga4":[{"id":"properties/501","name":"Roofer web"}]}', '{"gsc":"sc-domain:slate.test","ga4":"properties/501"}');
  assert r->>'state' = 'pick' and not (r->>'linked')::boolean and r->>'reason' like 'sc-domain:slate.test could not be linked automatically%' and r->'gscProperty' = 'null'::jsonb, 'unlisted refused: ' || r::text;
  assert r->'ga4Property' = 'null'::jsonb and r->>'ga4Reason' like '%already connected to another website%', 'GA4 of another website refused: ' || r::text;
  r := public.google_autolink(site, '{"sites":[{"url":"https://www.slate.test/"}],"ga4":[]}', '{"gsc":"https://www.slate.test/"}');
  assert r->>'state' = 'pick' and r->'gscProperty' = 'null'::jsonb, 'www prefix for a non-www site is not bound automatically: ' || r::text;
  -- Ambiguous (the Worker found several): nothing bound, its reason kept for "Pick a property".
  r := public.google_autolink(site, '{"sites":[{"url":"https://www.slate.test/"},{"url":"http://slate.test/"}],"ga4":[]}', '{"gsc":null,"state":"pick","reason":"Several Search Console properties could belong to slate.test: pick the right one."}');
  assert r->>'state' = 'pick' and r->>'reason' like 'Several Search Console properties%', 'ambiguous: ' || r::text;
  assert not exists (select 1 from public.google_bindings where site_id = site), 'nothing bound on slate';
  assert not public.google_autolink_due(site), 'tried today: not due again';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.google_binding_conflicts where site_id = (select v from al_ids where k = 'slate') and kind = 'ga4' and user_id is null) = 1, 'GA4 refusal recorded';
end $$;

-- Nothing seen: "Add our email in Search Console". The next day it is due again.
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare site uuid := (select v from al_ids where k = 'none'); r jsonb; begin
  r := public.google_autolink(site, '{"sites":[],"ga4":[]}', '{"gsc":null,"state":"add_email","reason":"We cannot see none.test in Search Console yet: add our email as a user of the property."}');
  assert r->>'state' = 'add_email' and r->>'reason' like 'We cannot see none.test%', 'add email: ' || r::text;
  assert not public.google_autolink_due(site), 'not twice a day';
end $$;
reset role;
update public.integrations set detail = jsonb_set(detail, '{autolink,at}', to_jsonb(now() - interval '1 day')) where site_id = (select v from al_ids where k = 'none') and provider = 'google';
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ begin assert public.google_autolink_due((select v from al_ids where k = 'none')), 'due again the next day'; end $$;
reset role;

-- One Search Console binding per host: a second website on roofer.test cannot take it; recorded once a week, not daily.
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare site uuid := (select v from al_ids where k = 'twin'); r jsonb; begin
  r := public.google_autolink(site, '{"sites":[{"url":"sc-domain:roofer.test"}],"ga4":[]}', '{"gsc":"sc-domain:roofer.test"}');
  assert r->>'state' = 'pick' and r->>'reason' like '%already connected to another website%', 'taken: ' || r::text;
  r := public.google_autolink(site, '{"sites":[{"url":"https://roofer.test/"}],"ga4":[]}', '{"gsc":"https://roofer.test/"}');
  assert r->>'state' = 'pick' and r->'gscProperty' = 'null'::jsonb, 'another property of the same host: refused';
  r := public.google_autolink(site, '{"sites":[{"url":"sc-domain:roofer.test"}],"ga4":[{"id":"properties/501","name":"Roofer web"}]}', '{"gsc":"sc-domain:roofer.test"}');
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.google_binding_conflicts where site_id = (select v from al_ids where k = 'twin') and property = 'sc-domain:roofer.test') = 1, 'recorded once, not on every run';
  assert (select count(*) from public.google_binding_conflicts where site_id = (select v from al_ids where k = 'twin')) = 2, 'both refusals recorded';
  assert not exists (select 1 from public.google_bindings where site_id = (select v from al_ids where k = 'twin')), 'twin unbound';
end $$;

-- The D34 rule: a domain two agencies registered is not linked without a platform admin's confirmation.
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare r jsonb; begin
  r := public.google_autolink((select v from al_ids where k = 'cross_a'), '{"sites":[{"url":"sc-domain:cross.test"}],"ga4":[]}', '{"gsc":"sc-domain:cross.test"}');
  assert r->>'state' = 'pick' and r->>'reason' like 'This domain is also registered by another agency%', 'D34: ' || r::text;
end $$;
reset role;
do $$ begin
  assert (select reason from public.google_binding_conflicts where site_id = (select v from al_ids where k = 'cross_a')) = 'domain also registered in another agency', 'D34 recorded for the admin';
end $$;
update public.sites set gsc_allowed = true where id = (select v from al_ids where k = 'cross_a'); -- the admin confirmed (set_gsc_allowed)
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare r jsonb := public.google_autolink((select v from al_ids where k = 'cross_a'), '{"sites":[{"url":"sc-domain:cross.test"}],"ga4":[]}', '{"gsc":"sc-domain:cross.test"}'); begin
  assert r->>'state' = 'linked' and (r->>'linked')::boolean, 'confirmed by the admin: linked ' || r::text;
end $$;
reset role;

-- A person's choice wins: removing turns automatic linking off; picking again is a person's binding.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare site uuid := (select v from al_ids where k = 'roofer'); g jsonb; begin
  g := public.bind_google(site, null, null);
  assert (g->>'ok')::boolean and g->'link'->>'state' = 'pick' and g->'link'->>'reason' like 'The Search Console property was removed by a person%', 'removed: ' || (g->'link')::text;
end $$;
reset role;
update public.integrations set detail = jsonb_set(detail, '{autolink,at}', to_jsonb(now() - interval '1 day')) where site_id = (select v from al_ids where k = 'roofer') and provider = 'google';
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ begin assert not public.google_autolink_due((select v from al_ids where k = 'roofer')), 'removed by a person: never re-linked automatically'; end $$;
reset role;
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare site uuid := (select v from al_ids where k = 'roofer'); g jsonb; begin
  -- bind_google keeps its D56 refusals after the rewrite.
  begin perform public.bind_google(site, 'https://bakery.test/', null); raise exception 'other host bound'; exception when raise_exception then if sqlerrm not like 'that Search Console property was not found%' then raise; end if; end;
  begin perform public.bind_google(site, null, 'properties/999'); raise exception 'other GA4 bound'; exception when raise_exception then if sqlerrm not like 'that Analytics property was not found%' then raise; end if; end;
  g := public.bind_google(site, 'https://www.roofer.test/', 'properties/501');
  assert (g->>'ok')::boolean and g->'link'->>'state' = 'linked' and g->'link'->>'via' = 'person', 'picked by a person: ' || (g->'link')::text;
  g := public.bind_google((select v from al_ids where k = 'twin'), null, 'properties/501');
  assert not (g->>'ok')::boolean and g->>'error' like 'That property is already connected%', 'still one property per website';
end $$;
reset role;
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare site uuid := (select v from al_ids where k = 'roofer'); r jsonb; begin
  r := public.google_autolink(site, '{"sites":[{"url":"sc-domain:roofer.test"},{"url":"https://www.roofer.test/"}],"ga4":[]}', '{"gsc":"sc-domain:roofer.test"}');
  assert r->>'gscProperty' = 'https://www.roofer.test/' and not (r->>'linked')::boolean, 'a person''s binding is never replaced: ' || r::text;
end $$;
reset role;
do $$ begin
  assert (select bound_via from public.google_bindings where site_id = (select v from al_ids where k = 'roofer') and kind = 'gsc') = 'person', 'still the person''s';
end $$;

-- Bob sees his own site's state (D34 refusal is not his to see as a reason beyond "pick"), never Alice's sites.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ declare p jsonb := public.portfolio_google(); begin
  assert exists (select 1 from jsonb_array_elements(p) x where (x->>'site')::uuid = (select v from al_ids where k = 'cross_b') and x->'link'->>'state' = 'add_email'), 'Bob: his site ' || p::text;
  assert not exists (select 1 from jsonb_array_elements(p) x where (x->>'site')::uuid in (select v from al_ids where k <> 'cross_b')), 'Bob: none of Alice''s';
end $$;
reset role;
delete from public.sites where id in (select v from al_ids);
\echo rls29 ok
