-- Connect with Google (20261118000000_google_oauth.sql, D56). Run after rls24.sql.
-- Covers: who may start a sign-in, single-use and expiring state, the pending token that only its starter can confirm
-- (login CSRF), Vault storage the browser never sees, the property pickers' validation, client users, disconnect.
\set ON_ERROR_STOP on
create temp table g_state (k text primary key, v text);
grant all on g_state to authenticated, service_role, anon;
-- Test-only probe of the Vault stand-in (the API roles cannot read Vault).
create function public.t_vault_has(n text) returns boolean language sql security definer set search_path = '' as $$ select exists (select 1 from vault.decrypted_secrets where name = n) $$;
grant execute on function public.t_vault_has(text) to service_role;
insert into g_state select 'host', private.site_host(url) from public.sites where id = (select v from ids where k = 'alice_site');

-- Helper checks on the coverage rule (superuser: these are private).
do $$ begin
  assert private.gsc_covers('https://www.plumber.test/', 'sc-domain:plumber.test'), 'domain property covers www';
  assert private.gsc_covers('https://blog.plumber.test/', 'sc-domain:plumber.test'), 'domain property covers a subdomain';
  assert private.gsc_covers('https://plumber.test/a', 'https://www.plumber.test/'), 'prefix with www';
  assert not private.gsc_covers('https://plumber.test/', 'sc-domain:notplumber.test'), 'suffix without a dot is another domain';
  assert not private.gsc_covers('https://plumber.test/', 'https://bakery.test/'), 'another host';
  assert not private.gsc_covers('https://plumber.test/', 'sc-domain:blog.plumber.test'), 'a subdomain property does not cover the parent';
  assert not private.gsc_covers('https://plumber.test/', 'android-app://x'), 'other schemes';
  assert private.gsc_pick('https://plumber.test/', '{"sites":[{"url":"https://bakery.test/"},{"url":"http://plumber.test/"},{"url":"https://plumber.test/"},{"url":"sc-domain:plumber.test"}]}') = 'sc-domain:plumber.test', 'domain first';
  assert private.gsc_pick('https://plumber.test/', '{"sites":[{"url":"http://plumber.test/"},{"url":"https://www.plumber.test/"}]}') = 'https://www.plumber.test/', 'https before http';
  assert private.gsc_pick('https://plumber.test/', '{"sites":[{"url":"https://bakery.test/"}]}') is null, 'nothing for another site';
end $$;

-- Outsiders and anonymous callers cannot start a sign-in; Alice (agency) can.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin perform public.google_begin((select v from ids where k = 'alice_site'), 'connect'); raise exception 'bob started'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
do $$ begin perform public.site_google((select v from ids where k = 'alice_site')); raise exception 'bob read'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin perform public.google_begin((select v from ids where k = 'alice_site'), 'list'); raise exception 'list before connect'; exception when raise_exception then if sqlerrm <> 'connect Google first' then raise; end if; end $$;
do $$ begin perform public.google_begin((select v from ids where k = 'alice_site'), 'steal'); raise exception 'bad purpose'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
insert into g_state select 'alice', public.google_begin((select v from ids where k = 'alice_site'), 'connect')->>'state';
do $$ declare g jsonb := public.site_google((select v from ids where k = 'alice_site')); begin
  assert length((select v from g_state where k = 'alice')) = 64, 'a long random state';
  assert not (g->>'connected')::boolean and (g->>'canConnect')::boolean and g->>'role' = 'agency', 'not connected yet: ' || g::text;
end $$;
-- The browser can never read the attempts table or call the Worker's functions.
do $$ begin perform 1 from private.google_oauth; raise exception 'read the table'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.google_oauth_peek((select v from g_state where k = 'alice')); raise exception 'peeked'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.google_target((select v from ids where k = 'alice_site')); raise exception 'read the token'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.google_oauth_pending((select v from g_state where k = 'alice'), 'forged-refresh-token', 'x@y.test', '[]', '{}'); raise exception 'forged'; exception when insufficient_privilege then null; end $$;
reset role;
set role anon; set request.jwt.claim.role = 'anon'; set request.jwt.claim.sub = '';
do $$ begin perform public.google_begin((select v from ids where k = 'alice_site'), 'connect'); raise exception 'anon started'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.site_google((select v from ids where k = 'alice_site')); raise exception 'anon read'; exception when insufficient_privilege then null; end $$;
reset role;

-- The Worker: peek (not consumed), take once, a second take or another purpose gets nothing; then store the pending token.
set role service_role; set request.jwt.claim.role = 'service_role'; set request.jwt.claim.sub = '';
do $$ declare st text := (select v from g_state where k = 'alice'); site uuid := (select v from ids where k = 'alice_site'); t jsonb; host text := (select v from g_state where k = 'host'); begin
  assert length(public.google_oauth_peek(st)->>'verifier') >= 43, 'PKCE verifier';
  assert public.google_oauth_peek('nope') is null, 'unknown state';
  assert public.google_oauth_take(st, 'list') is null, 'wrong purpose';
  t := public.google_oauth_take(st, 'connect');
  assert (t->>'site')::uuid = site and t->>'user' = '00000000-0000-0000-0000-00000000000a' and t ? 'verifier', 'taken: ' || t::text;
  assert public.google_oauth_take(st, 'connect') is null, 'single use';
  assert public.google_oauth_peek(st) is null, 'no second sign-in with the same state';
  perform public.google_oauth_pending(st, 'refresh-token-alice-0123456789', 'owner@plumber.test',
    '["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly", "https://www.googleapis.com/auth/analytics.readonly"]',
    jsonb_build_object('sites', jsonb_build_array(jsonb_build_object('url', 'https://bakery.test/', 'level', 'siteOwner'), jsonb_build_object('url', 'https://' || host || '/', 'level', 'siteFullUser'), jsonb_build_object('url', 'sc-domain:' || host, 'level', 'siteOwner')),
      'ga4', jsonb_build_array(jsonb_build_object('id', 'properties/111', 'name', 'Plumber web', 'account', 'Plumber'))));
  assert public.t_vault_has('google_pending:' || st), 'pending in Vault';
  assert not exists (select 1 from public.integrations where site_id = site and provider = 'google'), 'not connected until confirmed';
  assert public.google_target(site) is null, 'no token for the Worker yet';
  begin perform public.google_oauth_pending(st, 'refresh-token-second-0123456789', 'x@y.test', '[]', '{}'); raise exception 'stored twice'; exception when raise_exception then if sqlerrm not like 'this sign-in expired%' then raise; end if; end;
end $$;
-- An expired attempt cannot be taken.
reset role;
insert into private.google_oauth (state, purpose, site_id, user_id, verifier, expires_at) values ('expired-state', 'connect', (select v from ids where k = 'alice_site'), '00000000-0000-0000-0000-00000000000a', 'v', now() - interval '1 minute');
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ begin assert public.google_oauth_take('expired-state', 'connect') is null, 'expired'; assert public.google_oauth_peek('expired-state') is null, 'expired peek'; end $$;
reset role;

-- Login CSRF: Bob's attempt cannot be confirmed by Alice (her Google account would land on Bob's site).
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into g_state select 'bob', public.google_begin((select v from ids where k = 'bob_site'), 'connect')->>'state';
reset role;
set role service_role; set request.jwt.claim.role = 'service_role'; set request.jwt.claim.sub = '';
do $$ begin perform public.google_oauth_take((select v from g_state where k = 'bob'), 'connect');
  perform public.google_oauth_pending((select v from g_state where k = 'bob'), 'refresh-token-victim-0123456789', 'victim@x.test', '["https://www.googleapis.com/auth/webmasters.readonly"]', '{}'); end $$;
reset role;
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin perform public.google_confirm((select v from g_state where k = 'bob')); raise exception 'confirmed another person''s attempt'; exception when raise_exception then if sqlerrm not like 'this Google sign-in is not yours%' then raise; end if; end $$;
-- Alice confirms her own: connected, the property for her host chosen, the only GA4 property chosen, token moved.
do $$ declare site uuid := (select v from ids where k = 'alice_site'); g jsonb; host text; begin
  g := public.google_confirm((select v from g_state where k = 'alice'));
  host := (select v from g_state where k = 'host');
  assert (g->>'connected')::boolean and g->>'email' = 'owner@plumber.test' and (g->>'searchConsole')::boolean and (g->>'analytics')::boolean, 'connected: ' || g::text;
  assert g->>'gscProperty' = 'sc-domain:' || host and g->>'ga4Property' = 'properties/111' and g->>'ga4Name' = 'Plumber web', 'auto-picked: ' || g::text;
  assert jsonb_array_length(g->'choices'->'sites') = 3 and (g->>'mine')::boolean, 'lists for the manager';
  assert not (g::text like '%refresh-token%'), 'never the token';
  begin perform public.google_confirm((select v from g_state where k = 'alice')); raise exception 'confirmed twice'; exception when raise_exception then if sqlerrm not like 'this Google sign-in is not yours%' then raise; end if; end;
  -- Pickers: only listed properties; Search Console only for this site's host.
  begin perform public.set_google_properties(site, 'https://bakery.test/', null); raise exception 'other host saved'; exception when raise_exception then if sqlerrm not like 'that Search Console property%' then raise; end if; end;
  begin perform public.set_google_properties(site, 'http://' || host || '/', null); raise exception 'unlisted saved'; exception when raise_exception then if sqlerrm not like 'that Search Console property%' then raise; end if; end;
  begin perform public.set_google_properties(site, null, 'properties/999'); raise exception 'other GA4 saved'; exception when raise_exception then if sqlerrm not like 'that Analytics property%' then raise; end if; end;
  g := public.set_google_properties(site, 'https://' || host || '/', '');
  assert g->>'gscProperty' = 'https://' || host || '/' and g->'ga4Property' = 'null'::jsonb, 'saved: ' || g::text;
  perform public.set_google_properties(site, 'sc-domain:' || host, 'properties/111');
end $$;
-- The site's client user sees the state but not the agency's Google address or lists, and cannot change or undo it.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ declare site uuid := (select v from ids where k = 'alice_site'); g jsonb := public.site_google(site); begin
  assert (g->>'connected')::boolean and g->>'role' = 'client' and g->'email' = 'null'::jsonb and g->'choices' = 'null'::jsonb, 'client view: ' || g::text;
  assert not (g->>'canManage')::boolean and not (g->>'canConnect')::boolean and g->'lastError' = 'null'::jsonb, 'client cannot act on the agency''s connection';
  begin perform public.set_google_properties(site, null, null); raise exception 'client changed it'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.disconnect_google(site); raise exception 'client disconnected'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.google_begin(site, 'connect'); raise exception 'client replaced it'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
reset role;
-- The Worker reads the token and properties; refreshed lists keep a choice still offered and clear one that is not.
set role service_role; set request.jwt.claim.role = 'service_role'; set request.jwt.claim.sub = '';
do $$ declare site uuid := (select v from ids where k = 'alice_site'); t jsonb := public.google_target(site); r jsonb; begin
  assert public.google_connected(site) and not public.google_connected((select v from ids where k = 'bob_site')), 'planning sees the connection';
  assert t->>'refreshToken' = 'refresh-token-alice-0123456789' and t->>'ga4Property' = 'properties/111' and t->>'gscProperty' like 'sc-domain:%', 'target: ' || t::text;
  r := public.google_set_choices(site, jsonb_build_object('sites', jsonb_build_array(jsonb_build_object('url', t->>'gscProperty')), 'ga4', '[]'::jsonb));
  assert r->>'gscProperty' = t->>'gscProperty' and r->'ga4Property' = 'null'::jsonb, 'refresh: ' || r::text;
  reset role;
  update public.sites set url = 'https://moved.test/' where id = site;
  assert public.google_target(site)->'gscProperty' = 'null'::jsonb, 'a property for the old address is not read after the address changes';
  update public.sites set url = 'https://' || (select v from g_state where k = 'host') || '/' where id = site;
  set role service_role;
  perform public.record_integration_status(site, 'google', false, 'invalid_grant');
  assert (select status from public.integrations where site_id = site and provider = 'google') = 'error', 'a failed refresh shows';
  assert public.google_target(site) is not null, 'still readable to retry';
end $$;
reset role;
-- The pipeline shows the Google connection as needing attention; Alice disconnects through the Worker path.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare c jsonb; begin
  select x into c from jsonb_array_elements(public.site_pipeline((select v from ids where k = 'alice_site'))->'connections') x where x->>'key' = 'search_console';
  assert c->>'state' = 'error' and c->>'detail' like 'The Google connection stopped working%', 'pipeline: ' || c::text;
end $$;
insert into g_state select 'alice-off', public.google_begin((select v from ids where k = 'alice_site'), 'disconnect')->>'state';
reset role;
set role service_role; set request.jwt.claim.role = 'service_role'; set request.jwt.claim.sub = '';
do $$ declare site uuid := (select v from ids where k = 'alice_site'); t jsonb; begin
  assert public.google_oauth_take((select v from g_state where k = 'alice-off'), 'connect') is null, 'a disconnect state is not a sign-in';
  t := public.google_oauth_take((select v from g_state where k = 'alice-off'), 'disconnect');
  perform public.google_oauth_remove((t->>'site')::uuid, (t->>'user')::uuid);
  assert public.google_target(site) is null and not public.t_vault_has('google_token:' || site), 'token deleted';
  assert (select status from public.integrations where site_id = site and provider = 'google') = 'revoked', 'revoked';
  assert not exists (select 1 from public.integrations where site_id = site and provider = 'google' and detail ? 'email'), 'no email kept';
end $$;
reset role;
-- Nothing connected now: the client user may connect their own Google, and then manage only that.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
insert into g_state select 'carol', public.google_begin((select v from ids where k = 'alice_site'), 'connect')->>'state';
do $$ begin perform public.google_begin((select v from ids where k = 'bob_site'), 'connect'); raise exception 'client of another site'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
reset role;
set role service_role; set request.jwt.claim.role = 'service_role'; set request.jwt.claim.sub = '';
do $$ begin perform public.google_oauth_take((select v from g_state where k = 'carol'), 'connect');
  perform public.google_oauth_pending((select v from g_state where k = 'carol'), 'refresh-token-carol-0123456789', 'carol@client-a.test', '["https://www.googleapis.com/auth/webmasters.readonly"]', '{"sites":[],"ga4":[]}'); end $$;
reset role;
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ declare site uuid := (select v from ids where k = 'alice_site'); g jsonb; begin
  g := public.google_confirm((select v from g_state where k = 'carol'));
  assert (g->>'mine')::boolean and (g->>'canManage')::boolean and g->>'email' = 'carol@client-a.test' and not (g->>'analytics')::boolean, 'client connected: ' || g::text;
  assert g->'gscProperty' = 'null'::jsonb, 'nothing to pick from';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare g jsonb := public.site_google((select v from ids where k = 'alice_site')); begin
  assert (g->>'canManage')::boolean and not (g->>'mine')::boolean and g->>'email' = 'carol@client-a.test', 'the agency still manages it';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ declare g jsonb := public.disconnect_google((select v from ids where k = 'alice_site')); begin
  assert g->>'status' = 'revoked' and not (g->>'revokedAtGoogle')::boolean, 'fallback disconnect: ' || g::text;
end $$;
reset role;
drop function public.t_vault_has(text);
\echo rls25 ok
