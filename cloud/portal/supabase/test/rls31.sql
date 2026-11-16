-- Automatic linking retries Analytics (20261125000000_autolink_ga4.sql). Run after rls30.sql.
-- Covers: Search Console linked but no GA4 -> due again the next day (not the same day); GA4 linked -> not due; a
-- person's choice on the Connections page (google.bind) -> never due again for GA4; still nothing for a paused site.
\set ON_ERROR_STOP on
create temp table g4_ids (k text primary key, v uuid);
grant all on g4_ids to authenticated, service_role, anon;
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into g4_ids select 'mason', ((public.create_site('Mason', 'https://mason.test/'))->'site'->>'id')::uuid;
insert into g4_ids select 'tiler', ((public.create_site('Tiler', 'https://tiler.test/'))->'site'->>'id')::uuid;
reset role;
update public.sites set status = 'live' where id in (select v from g4_ids);

-- Both get Search Console from automatic linking today, without Analytics (the Admin API could not be read).
set role service_role; set request.jwt.claim.role = 'service_role'; set request.jwt.claim.sub = '';
do $$ declare r jsonb; begin
  r := public.google_autolink((select v from g4_ids where k = 'mason'), '{"sites":[{"url":"https://mason.test/"}],"ga4":[]}', '{"gsc":"https://mason.test/","ga4Reason":"Analytics could not be read"}');
  assert r->>'state' = 'linked' and r->'ga4Property' = 'null'::jsonb, 'mason: gsc only ' || r::text;
  r := public.google_autolink((select v from g4_ids where k = 'tiler'), '{"sites":[{"url":"https://tiler.test/"}],"ga4":[]}', '{"gsc":"https://tiler.test/"}');
  assert r->>'state' = 'linked', 'tiler: gsc only ' || r::text;
  assert not public.google_autolink_due((select v from g4_ids where k = 'mason')), 'not twice a day';
end $$;
reset role;
update public.integrations set detail = jsonb_set(detail, '{autolink,at}', to_jsonb(now() - interval '1 day')) where site_id in (select v from g4_ids) and provider = 'google';

-- Next day: due again for Analytics; the retry links GA4 and keeps Search Console.
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare site uuid := (select v from g4_ids where k = 'mason'); r jsonb; begin
  assert public.google_autolink_due(site), 'no GA4 yet: due again the next day';
  r := public.google_autolink(site, '{"sites":[{"url":"https://mason.test/"}],"ga4":[{"id":"properties/901","name":"Mason"}]}', '{"gsc":"https://mason.test/","ga4":"properties/901"}');
  assert r->>'ga4Property' = 'properties/901' and (r->>'ga4Linked')::boolean and not (r->>'linked')::boolean and r->>'gscProperty' = 'https://mason.test/', 'GA4 linked on retry: ' || r::text;
end $$;
reset role;
update public.integrations set detail = jsonb_set(detail, '{autolink,at}', to_jsonb(now() - interval '1 day')) where site_id in (select v from g4_ids) and provider = 'google';
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ begin assert not public.google_autolink_due((select v from g4_ids where k = 'mason')), 'both linked: not due'; end $$;
reset role;

-- Tiler: a person chose "Search Console only" on the Connections page: that choice is kept, no daily retry.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare g jsonb := public.bind_google((select v from g4_ids where k = 'tiler'), 'https://tiler.test/', null); begin
  assert (g->>'ok')::boolean, 'person bound: ' || g::text;
end $$;
reset role;
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ begin assert not public.google_autolink_due((select v from g4_ids where k = 'tiler')), 'a person''s choice is kept'; end $$;
reset role;

-- Paused: never due.
delete from public.google_bindings where site_id = (select v from g4_ids where k = 'mason') and kind = 'ga4';
update public.sites set status = 'paused' where id = (select v from g4_ids where k = 'mason');
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ begin assert not public.google_autolink_due((select v from g4_ids where k = 'mason')), 'paused: not due'; end $$;
reset role;
delete from public.sites where id in (select v from g4_ids);
\echo rls31 ok
