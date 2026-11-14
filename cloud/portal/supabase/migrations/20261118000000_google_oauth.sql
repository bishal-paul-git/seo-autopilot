-- Connect with Google (D56): a customer signs in with Google, presses Allow and picks their Search Console property and
-- GA4 property from lists, instead of creating a service account, a JSON key and repository secrets.
--
-- The Google sign-in itself runs in the Worker `seo-god` (src/god/google-oauth.mjs): the client secret never reaches a
-- browser. This migration holds what the database must enforce:
--   * a one-time `state` per attempt (site, person, 10 minutes, single use) that only someone allowed to connect that
--     site can create, with the PKCE verifier kept server side;
--   * the refresh token in Supabase Vault (as D37 does for GitHub tokens): only the service role reads it, never a browser;
--   * login-CSRF guard: the Worker stores the new token as PENDING; it becomes the site's connection only when the same
--     signed-in person who started the attempt confirms it from the portal (google_confirm). A link someone else started
--     cannot attach a victim's Google account to the other person's site;
--   * the chosen Search Console property must be in the list Google returned AND cover the site's own host; the GA4
--     property must be in the list Google returned.
-- Agency members may connect, choose and disconnect. A client user of the site may connect when nothing is connected, and
-- may change or disconnect only a connection they made themselves (the data is theirs; the agency's is not theirs to undo).

alter table public.integrations drop constraint if exists integrations_provider_check;
alter table public.integrations add constraint integrations_provider_check
  check (provider in ('search_console', 'ga4', 'github', 'crawler', 'bing_webmaster', 'google_sheets', 'other', 'google'));

create table if not exists private.google_oauth (
  state text primary key,
  purpose text not null check (purpose in ('connect', 'list', 'disconnect')),
  site_id uuid not null references public.sites (id) on delete cascade,
  user_id uuid not null,
  verifier text not null,           -- PKCE code verifier; read only by the service role (the Worker)
  expires_at timestamptz not null,
  used_at timestamptz,              -- single use: set when the Worker takes it
  pending jsonb,                    -- connect: { email, scopes, choices } until the person confirms
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists google_oauth_user on private.google_oauth (user_id, created_at);
alter table private.google_oauth enable row level security; -- no policies: only the functions below touch it
revoke all on private.google_oauth from public, anon, authenticated;

-- 'agency' (a member of the site's agency), 'client' (a client user of the site) or null. Takes the person explicitly so
-- the Worker's service-role calls can re-check the person who started an attempt.
create or replace function private.google_role(p_site uuid, p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.sites s join public.org_members m on m.org_id = s.org_id where s.id = p_site and m.user_id = p_user) then 'agency'
    when exists (select 1 from public.sites s join public.client_members m on m.client_id = s.client_id where s.id = p_site and m.user_id = p_user) then 'client'
  end;
$$;

-- p_action: 'connect' (start a sign-in) or 'manage' (refresh the lists, choose properties, disconnect).
create or replace function private.google_may(p_site uuid, p_user uuid, p_action text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case private.google_role(p_site, p_user)
    when 'agency' then true
    when 'client' then
      case when p_action = 'connect' then not exists (select 1 from public.integrations i where i.site_id = p_site and i.provider = 'google' and i.status in ('connected', 'error') and i.detail->>'connectedBy' is distinct from p_user::text)
           else exists (select 1 from public.integrations i where i.site_id = p_site and i.provider = 'google' and i.status in ('connected', 'error') and i.detail->>'connectedBy' = p_user::text) end
    else false end;
$$;

-- Does a Search Console property cover the site's own host? A domain property covers the host and its subdomains; an
-- address prefix must be the same host (www ignored, as private.site_host does).
create or replace function private.gsc_covers(p_site_url text, p_property text)
returns boolean language sql immutable set search_path = '' as $$
  select case when p_property is null or p_property = '' then false
    when p_property like 'sc-domain:%' then
      private.site_host(p_site_url) = lower(substr(p_property, 11))
      or right(private.site_host(p_site_url), length(substr(p_property, 11)) + 1) = '.' || lower(substr(p_property, 11))
    else p_property ~* '^https?://' and private.site_host(p_property) = private.site_host(p_site_url) end;
$$;

-- The best property for the site from Google's list: the domain property first, then https, then http prefixes.
create or replace function private.gsc_pick(p_site_url text, p_choices jsonb)
returns text language sql immutable set search_path = '' as $$
  select c->>'url' from jsonb_array_elements(case when jsonb_typeof(p_choices->'sites') = 'array' then p_choices->'sites' else '[]'::jsonb end) c
   where private.gsc_covers(p_site_url, c->>'url')
   order by case when c->>'url' = 'sc-domain:' || private.site_host(p_site_url) then 0 when c->>'url' like 'sc-domain:%' then 3
                 when c->>'url' like 'https://%' then 1 else 2 end, length(c->>'url')
   limit 1;
$$;

create or replace function private.google_ga4_in(p_choices jsonb, p_id text)
returns boolean language sql immutable set search_path = '' as $$
  select exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_choices->'ga4') = 'array' then p_choices->'ga4' else '[]'::jsonb end) g where g->>'id' = p_id);
$$;

create or replace function private.google_gsc_in(p_choices jsonb, p_url text)
returns boolean language sql immutable set search_path = '' as $$
  select exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_choices->'sites') = 'array' then p_choices->'sites' else '[]'::jsonb end) c where c->>'url' = p_url);
$$;

-- Old attempts and their pending tokens are removed; nothing pending lives longer than a day.
create or replace function private.google_tidy()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets v using private.google_oauth o
   where v.name = 'google_pending:' || o.state and o.created_at < now() - interval '1 hour';
  delete from private.google_oauth where created_at < now() - interval '1 day';
end $$;

create or replace function private.google_remove(p_site uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site);
begin
  delete from vault.secrets where name = 'google_token:' || p_site::text;
  update public.integrations set status = 'revoked', last_error = null, detail = jsonb_build_object('disconnectedAt', now())
   where site_id = p_site and provider = 'google' and scope = 'read';
  insert into public.audit_log (org_id, site_id, actor, action, target) values (v_org, p_site, p_user, 'integration.disconnect', 'google');
  return jsonb_build_object('provider', 'google', 'status', 'revoked');
end $$;

-- What the portal shows. Agency members and the site's client users; never a token. Email and lists go only to people who
-- may manage the connection (a client does not see an agency employee's Google address).
create or replace function public.site_google(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_role text := private.google_role(p_site, v_user); i public.integrations; s public.sites; manage boolean;
begin
  if v_role is null then raise exception 'not allowed'; end if;
  select * into s from public.sites where id = p_site;
  select * into i from public.integrations x where x.site_id = p_site and x.provider = 'google' and x.scope = 'read';
  manage := private.google_may(p_site, v_user, 'manage');
  return jsonb_build_object(
    'connected', coalesce(i.status in ('connected', 'error'), false), 'status', coalesce(i.status, 'unconnected'),
    'email', case when manage then i.detail->>'email' end, 'mine', coalesce(i.detail->>'connectedBy' = v_user::text, false),
    'searchConsole', coalesce(i.detail->'scopes' ? 'https://www.googleapis.com/auth/webmasters.readonly', false),
    'analytics', coalesce(i.detail->'scopes' ? 'https://www.googleapis.com/auth/analytics.readonly', false),
    'connectedAt', i.detail->>'connectedAt', 'gscProperty', i.detail->>'gscProperty', 'ga4Property', i.detail->>'ga4Property',
    'ga4Name', (select g->>'name' from jsonb_array_elements(coalesce(i.detail->'choices'->'ga4', '[]'::jsonb)) g where g->>'id' = i.detail->>'ga4Property' limit 1),
    'choices', case when manage then coalesce(i.detail->'choices', '{}'::jsonb) end,
    'suggested', case when manage then private.gsc_pick(s.url, i.detail->'choices') end,
    'lastOkAt', i.last_ok_at, 'lastError', case when v_role = 'agency' then i.last_error end,
    'canConnect', private.google_may(p_site, v_user, 'connect'), 'canManage', manage, 'role', v_role);
end $$;

-- Start an attempt: connect (a Google sign-in), list (refresh the property lists) or disconnect (revoke at Google).
create or replace function public.google_begin(p_site uuid, p_purpose text default 'connect')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_state text; v_exp timestamptz := now() + interval '10 minutes';
begin
  if v_user is null or p_purpose not in ('connect', 'list', 'disconnect') then raise exception 'not allowed'; end if;
  if not private.google_may(p_site, v_user, case when p_purpose = 'connect' then 'connect' else 'manage' end) then raise exception 'not allowed'; end if;
  if p_purpose <> 'connect' and not exists (select 1 from public.integrations i where i.site_id = p_site and i.provider = 'google' and i.status in ('connected', 'error')) then
    raise exception 'connect Google first'; end if;
  if (select count(*) from private.google_oauth o where o.user_id = v_user and o.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too many attempts: try again in an hour'; end if;
  perform private.google_tidy();
  v_state := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into private.google_oauth (state, purpose, site_id, user_id, verifier, expires_at)
    values (v_state, p_purpose, p_site, v_user, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), v_exp);
  return jsonb_build_object('state', v_state, 'expiresAt', v_exp);
end $$;

-- Worker: the PKCE verifier of an unused, unexpired connect attempt (to build Google's sign-in address). Not consumed.
create or replace function public.google_oauth_peek(p_state text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('verifier', o.verifier) from private.google_oauth o
   where o.state = p_state and o.purpose = 'connect' and o.used_at is null and o.expires_at > now();
$$;

-- Worker: take (use up) an attempt. Returns nothing when it is unknown, used, expired, for another purpose, or when the
-- person who started it may no longer act on the site.
create or replace function public.google_oauth_take(p_state text, p_purpose text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o private.google_oauth;
begin
  update private.google_oauth set used_at = now()
   where state = p_state and purpose = p_purpose and used_at is null and expires_at > now() returning * into o;
  if o.state is null then return null; end if;
  if not private.google_may(o.site_id, o.user_id, case when p_purpose = 'connect' then 'connect' else 'manage' end) then return null; end if;
  return jsonb_build_object('site', o.site_id, 'user', o.user_id, 'verifier', o.verifier, 'siteUrl', (select s.url from public.sites s where s.id = o.site_id));
end $$;

-- Worker: after Google's sign-in, keep the new refresh token as PENDING (Vault) until the person confirms it.
create or replace function public.google_oauth_pending(p_state text, p_refresh_token text, p_email text, p_scopes jsonb, p_choices jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o private.google_oauth; v_name text := 'google_pending:' || p_state;
begin
  select * into o from private.google_oauth where state = p_state and purpose = 'connect' and used_at > now() - interval '15 minutes' and pending is null and confirmed_at is null;
  if o.state is null then raise exception 'this sign-in expired: start again'; end if;
  if p_refresh_token is null or length(p_refresh_token) < 10 then raise exception 'Google returned no refresh token'; end if;
  delete from vault.secrets where name = v_name;
  perform vault.create_secret(p_refresh_token, v_name, 'Pending Google sign-in (SEO Autopilot)');
  update private.google_oauth set pending = jsonb_build_object('email', left(p_email, 320), 'scopes', case when jsonb_typeof(p_scopes) = 'array' then p_scopes else '[]'::jsonb end,
      'choices', coalesce(p_choices, '{}'::jsonb) || jsonb_build_object('listedAt', now())) where state = p_state;
  return jsonb_build_object('site', o.site_id);
end $$;

-- The person who started the sign-in confirms it from the portal; only then does it become the site's connection.
create or replace function public.google_confirm(p_state text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); o private.google_oauth; s public.sites; v_tok text; v_id uuid; old jsonb; ch jsonb; v_gsc text; v_ga4 text;
begin
  select * into o from private.google_oauth where state = p_state and purpose = 'connect' and pending is not null and confirmed_at is null and used_at > now() - interval '15 minutes';
  if o.state is null or v_user is null or o.user_id <> v_user then raise exception 'this Google sign-in is not yours or has expired: press Connect with Google again'; end if;
  if not private.google_may(o.site_id, v_user, 'connect') then raise exception 'not allowed'; end if;
  select * into s from public.sites where id = o.site_id;
  select decrypted_secret into v_tok from vault.decrypted_secrets where name = 'google_pending:' || p_state;
  if v_tok is null then raise exception 'this Google sign-in has expired: press Connect with Google again'; end if;
  select id into v_id from vault.secrets where name = 'google_token:' || o.site_id::text;
  if v_id is null then perform vault.create_secret(v_tok, 'google_token:' || o.site_id::text, 'Google sign-in for one site (SEO Autopilot)');
  else perform vault.update_secret(v_id, v_tok); end if;
  delete from vault.secrets where name = 'google_pending:' || p_state;
  ch := o.pending->'choices';
  select detail into old from public.integrations where site_id = o.site_id and provider = 'google' and scope = 'read';
  -- Keep earlier choices that are still offered; otherwise the property for this site's host, and the only GA4 property.
  v_gsc := case when private.google_gsc_in(ch, old->>'gscProperty') and private.gsc_covers(s.url, old->>'gscProperty') then old->>'gscProperty' else private.gsc_pick(s.url, ch) end;
  v_ga4 := case when private.google_ga4_in(ch, old->>'ga4Property') then old->>'ga4Property'
                when jsonb_array_length(coalesce(ch->'ga4', '[]'::jsonb)) = 1 then ch->'ga4'->0->>'id' end;
  insert into public.integrations (org_id, site_id, provider, scope, status, detail, last_error)
    values (s.org_id, s.id, 'google', 'read', 'connected', jsonb_build_object('email', o.pending->>'email', 'scopes', o.pending->'scopes', 'connectedAt', now(), 'connectedBy', v_user,
      'choices', ch, 'gscProperty', v_gsc, 'ga4Property', v_ga4), null)
    on conflict (site_id, provider, scope) do update set status = 'connected', detail = excluded.detail, last_error = null;
  update private.google_oauth set confirmed_at = now(), pending = null where state = p_state;
  insert into public.audit_log (org_id, site_id, actor, action, target, data) values (s.org_id, s.id, v_user, 'integration.connect', 'google',
    jsonb_build_object('gscProperty', v_gsc, 'ga4Property', v_ga4));
  return public.site_google(s.id) || jsonb_build_object('site', s.id);
end $$;

-- Worker: fresh lists after a refresh. A chosen property that is no longer offered is cleared.
create or replace function public.google_set_choices(p_site uuid, p_choices jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.integrations; s public.sites; ch jsonb := coalesce(p_choices, '{}'::jsonb) || jsonb_build_object('listedAt', now()); v_gsc text; v_ga4 text;
begin
  select * into i from public.integrations where site_id = p_site and provider = 'google' and scope = 'read' and status in ('connected', 'error');
  if i.id is null then raise exception 'Google is not connected for this website'; end if;
  select * into s from public.sites where id = p_site;
  v_gsc := case when private.google_gsc_in(ch, i.detail->>'gscProperty') then i.detail->>'gscProperty' else private.gsc_pick(s.url, ch) end;
  v_ga4 := case when private.google_ga4_in(ch, i.detail->>'ga4Property') then i.detail->>'ga4Property' end;
  update public.integrations set detail = detail || jsonb_build_object('choices', ch, 'gscProperty', v_gsc, 'ga4Property', v_ga4) where id = i.id;
  return jsonb_build_object('gscProperty', v_gsc, 'ga4Property', v_ga4);
end $$;

-- Save the properties the person picked. Each must be in Google's list; Search Console must cover this site's host.
create or replace function public.set_google_properties(p_site uuid, p_gsc text, p_ga4 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); i public.integrations; s public.sites;
begin
  if not private.google_may(p_site, v_user, 'manage') then raise exception 'not allowed'; end if;
  select * into i from public.integrations where site_id = p_site and provider = 'google' and scope = 'read' and status in ('connected', 'error');
  if i.id is null then raise exception 'connect Google first'; end if;
  select * into s from public.sites where id = p_site;
  if nullif(p_gsc, '') is not null and not (private.google_gsc_in(i.detail->'choices', p_gsc) and private.gsc_covers(s.url, p_gsc)) then
    raise exception 'that Search Console property is not one of yours for this website'; end if;
  if nullif(p_ga4, '') is not null and not private.google_ga4_in(i.detail->'choices', p_ga4) then raise exception 'that Analytics property is not in your Google account'; end if;
  update public.integrations set detail = detail || jsonb_build_object('gscProperty', nullif(p_gsc, ''), 'ga4Property', nullif(p_ga4, '')) where id = i.id;
  insert into public.audit_log (org_id, site_id, actor, action, target, data) values (s.org_id, s.id, v_user, 'integration.properties', 'google',
    jsonb_build_object('gscProperty', nullif(p_gsc, ''), 'ga4Property', nullif(p_ga4, '')));
  return public.site_google(p_site);
end $$;

-- Disconnect without the Worker (fallback when it cannot be reached): the token is deleted but not revoked at Google; the
-- portal then tells the person to remove access in their Google account.
create or replace function public.disconnect_google(p_site uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid());
begin
  if not private.google_may(p_site, v_user, 'manage') then raise exception 'not allowed'; end if;
  return private.google_remove(p_site, v_user) || jsonb_build_object('revokedAtGoogle', false);
end $$;

-- Worker: remove after it revoked the token at Google (the attempt it took already checked the person).
create or replace function public.google_oauth_remove(p_site uuid, p_user uuid)
returns jsonb language sql security definer set search_path = '' as $$ select private.google_remove(p_site, p_user); $$;

-- Worker: the refresh token and chosen properties of a connected site, or nothing.
create or replace function public.google_target(p_site uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  -- The Search Console property only while it still covers the site's host (the site's address may have changed since).
  select jsonb_build_object('refreshToken', v.decrypted_secret, 'email', i.detail->>'email',
           'gscProperty', case when private.gsc_covers(s.url, i.detail->>'gscProperty') then i.detail->>'gscProperty' end,
           'ga4Property', i.detail->>'ga4Property', 'siteUrl', s.url)
    from public.integrations i join vault.decrypted_secrets v on v.name = 'google_token:' || p_site::text join public.sites s on s.id = i.site_id
   where i.site_id = p_site and i.provider = 'google' and i.scope = 'read' and i.status in ('connected', 'error');
$$;

-- Worker (planning): does the site have a Google connection to read with? No token leaves the database for this.
create or replace function public.google_connected(p_site uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.integrations i where i.site_id = p_site and i.provider = 'google' and i.scope = 'read' and i.status in ('connected', 'error')
                   and (i.detail->>'gscProperty' is not null or i.detail->>'ga4Property' is not null));
$$;

revoke all on function private.google_role(uuid, uuid), private.google_may(uuid, uuid, text), private.gsc_covers(text, text), private.gsc_pick(text, jsonb),
  private.google_ga4_in(jsonb, text), private.google_gsc_in(jsonb, text), private.google_tidy(), private.google_remove(uuid, uuid) from public, anon, authenticated;
revoke all on function public.site_google(uuid), public.google_begin(uuid, text), public.google_oauth_peek(text), public.google_oauth_take(text, text),
  public.google_oauth_pending(text, text, text, jsonb, jsonb), public.google_confirm(text), public.google_set_choices(uuid, jsonb),
  public.set_google_properties(uuid, text, text), public.disconnect_google(uuid), public.google_oauth_remove(uuid, uuid), public.google_target(uuid), public.google_connected(uuid) from public, anon, authenticated;
grant execute on function public.site_google(uuid), public.google_begin(uuid, text), public.google_confirm(text), public.set_google_properties(uuid, text, text),
  public.disconnect_google(uuid) to authenticated;
grant execute on function public.google_oauth_peek(text), public.google_oauth_take(text, text), public.google_oauth_pending(text, text, text, jsonb, jsonb),
  public.google_set_choices(uuid, jsonb), public.google_oauth_remove(uuid, uuid), public.google_target(uuid), public.google_connected(uuid) to service_role;

-- site_pipeline (D54) with the Google connection (D56): Search Console waits for its first read once a property is chosen,
-- a broken Google connection shows as needing attention, and Analytics and the weekly speed check appear. Same otherwise.
create or replace function public.site_pipeline(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.sites; agency boolean; tok record; snap jsonb; rep record; sj record; tk record; v_last_run timestamptz;
  conns jsonb := '[]'::jsonb; integ jsonb; g record;
begin
  select * into s from public.sites where id = p_site;
  if s.id is null then raise exception 'not allowed'; end if;
  agency := private.is_member(s.org_id);
  if not agency and not private.is_client_viewer(p_site) then raise exception 'not allowed'; end if;
  select t.last_used_at, t.created_at into tok from private.ingest_tokens t where t.site_id = p_site;
  select x.data into snap from public.site_snapshots x where x.site_id = p_site and tok.last_used_at is not null and x.taken_at <= tok.last_used_at order by x.taken_at desc limit 1;
  select m.value, m.created_at, m.source into rep from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'search_console' and m.superseded_at is null limit 1;
  select j.status, j.updated_at, (select left(e.note, 300) from public.job_events e where e.job_id = j.id order by e.at desc, e.id desc offset 1 limit 1) note
    into sj from public.jobs j where j.site_id = p_site and j.kind = 'search_snapshot' order by j.created_at desc limit 1;
  select t.ticked_at, t.outcome into tk from public.god_site_ticks t where t.site_id = p_site;
  v_last_run := (select max(r.started_at) from public.god_runs r);
  select i.status, i.detail into g from public.integrations i where i.site_id = p_site and i.provider = 'google' and i.scope = 'read' and i.status in ('connected', 'error');

  -- Connections, each { key, name, state: connected | waiting | missing | error | off, detail, at }.
  conns := conns || jsonb_build_array(jsonb_build_object('key', 'scan', 'name', 'Website scan',
    'state', case when s.scan_state = 'failed' then 'error' when s.last_snapshot_at is not null or exists (select 1 from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'audit') then 'connected' else 'waiting' end,
    'detail', case when s.scan_state = 'failed' then 'The last scan failed' || case when agency and s.scan_error is not null then ': ' || left(s.scan_error, 200) else '' end
                   else 'Reads every page: titles, links, speed, structured data' end,
    'at', (select max(j.updated_at) from public.jobs j where j.site_id = p_site and j.kind = 'scan' and j.status = 'completed')));
  conns := conns || jsonb_build_array(jsonb_build_object('key', 'github', 'name', 'Daily SEO run (GitHub)',
    'state', case when s.repo is null then 'off' when tok.last_used_at > now() - interval '3 days' then 'connected' when tok.last_used_at is not null then 'error' else 'missing' end,
    'detail', case when s.repo is null then 'Not used for this website'
                   when tok.last_used_at > now() - interval '3 days' then 'Sends Search Console, indexing and keyword data every day'
                   when tok.last_used_at is not null then 'No data for more than 3 days'
                   when agency then 'Add SEO_PORTAL_URL and SEO_PORTAL_TOKEN to ' || s.repo || ' (Connection page)'
                   else 'Your SEO team is connecting it' end,
    'at', tok.last_used_at));
  conns := conns || jsonb_build_array(jsonb_build_object('key', 'search_console', 'name', 'Google Search Console',
    'state', case when rep.created_at > now() - interval '3 days' then 'connected' when g.status = 'error' or sj.status = 'escalated' then 'error'
                   when rep.created_at is not null or g.detail->>'gscProperty' is not null then 'waiting' else 'missing' end,
    'detail', case when rep.created_at is not null then coalesce(rep.value->'totals'->>'clicks', '0') || ' clicks, ' || coalesce(rep.value->'totals'->>'impressions', '0') || ' impressions in 28 days' ||
                     case when rep.value->>'source' = 'github' then ' (from the daily GitHub run)' else '' end
                   when g.status = 'error' then 'The Google connection stopped working: connect with Google again'
                   when sj.status = 'escalated' then case when agency then coalesce(sj.note, 'No access') else 'Waiting for access' end
                   when g.detail->>'gscProperty' is not null then 'Connected with Google; the first read runs at the next planning'
                   when g.status = 'connected' then 'Connected with Google: choose the Search Console property'
                   when s.gsc_allowed then 'Waiting for the first read'
                   else 'Not connected yet' end,
    'at', rep.created_at));
  -- D56: Analytics read through the site's Google connection, and the weekly central speed check.
  conns := conns || coalesce((select jsonb_build_array(jsonb_build_object('key', 'analytics', 'name', 'Google Analytics 4',
      'state', case when m.created_at > now() - interval '3 days' then 'connected' else 'waiting' end,
      'detail', coalesce(m.value->'totals'->>'sessions', '0') || ' visits in 28 days', 'at', m.created_at))
    from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'analytics' and m.superseded_at is null limit 1),
    case when g.detail->>'ga4Property' is not null then jsonb_build_array(jsonb_build_object('key', 'analytics', 'name', 'Google Analytics 4', 'state', 'waiting',
      'detail', 'Connected with Google; the first read runs at the next planning', 'at', null)) else '[]'::jsonb end);
  conns := conns || coalesce((select jsonb_build_array(jsonb_build_object('key', 'speed', 'name', 'Speed checks',
      'state', case when m.created_at > now() - interval '8 days' then 'connected' else 'waiting' end,
      'detail', 'Phone speed of ' || jsonb_array_length(coalesce(m.value->'pages', '[]'::jsonb)) || ' pages, checked every week', 'at', m.created_at))
    from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'speed' and m.superseded_at is null limit 1), '[]'::jsonb);
  -- What the website's own run reports about its other connections (Analytics, PageSpeed, IndexNow, Bing): no secrets.
  integ := case when jsonb_typeof(snap->'integrations') = 'array' then snap->'integrations' else '[]'::jsonb end;
  conns := conns || coalesce((select jsonb_agg(jsonb_build_object('key', 'run:' || lower(regexp_replace(i->>'name', '[^A-Za-z0-9]+', '-', 'g')),
      'name', left(i->>'name', 60), 'state', case when (i->>'ok')::boolean then 'connected' else 'missing' end,
      'detail', case when agency then left(coalesce(i->>'note', ''), 200) when (i->>'ok')::boolean then left(coalesce(i->>'note', ''), 200) else 'Not connected' end,
      'at', tok.last_used_at))
    from jsonb_array_elements(integ) i where jsonb_typeof(i) = 'object' and coalesce(i->>'name', '') <> '' and i->>'name' not in ('Google Search Console', 'AI agents')
      and not (i->>'name' = 'Google Analytics 4' and g.detail->>'ga4Property' is not null)), '[]'::jsonb);
  conns := conns || jsonb_build_array(jsonb_build_object('key', 'agents', 'name', 'AI specialists',
    'state', case when s.status = 'paused' then 'off' when v_last_run > now() - interval '40 minutes' then 'connected' else 'error' end,
    'detail', case when s.status = 'paused' then 'Paused for this website'
                   else 'The SEO director plans every few hours; specialists run within the daily budget' end,
    'at', tk.ticked_at));

  return jsonb_build_object(
    'site', jsonb_build_object('id', s.id, 'name', s.name, 'url', s.url, 'status', s.status, 'repo', case when agency then s.repo end),
    'agency', agency,
    'schedule', jsonb_build_object('everyMinutes', 15, 'lastRun', v_last_run, 'paused', public.god_paused() or s.status = 'paused',
      'lastPlanned', tk.ticked_at, 'nextPlan', tk.ticked_at + interval '6 hours',
      'strategy', (select m.value->>'status' from public.site_memory m where m.site_id = p_site and m.kind = 'strategy' and m.key = 'initial' and m.superseded_at is null limit 1),
      'budgetUsd', case when agency then coalesce((tk.outcome->>'budgetUsd')::numeric, s.daily_budget_usd) end,
      'spentTodayUsd', case when agency then coalesce((select sum(c.usd) from public.job_costs c where c.site_id = p_site and c.at >= date_trunc('day', now())), 0) end),
    'connections', conns,
    'counts', jsonb_build_object(
      'active', (select count(*) from public.jobs j where j.site_id = p_site and j.status in ('queued', 'running', 'awaiting_review', 'authorized')),
      'waiting', (select count(*) from public.jobs j where j.site_id = p_site and j.status = 'awaiting_approval'),
      'stopped', (select count(*) from public.jobs j where j.site_id = p_site and j.status = 'escalated'),
      'done30', (select count(*) from public.jobs j where j.site_id = p_site and j.status = 'completed' and j.updated_at > now() - interval '30 days'),
      'reviews30', (select count(*) from public.reviews r join public.jobs j on j.id = r.job_id where j.site_id = p_site and r.created_at > now() - interval '30 days'),
      'passed30', (select count(*) from public.reviews r join public.jobs j on j.id = r.job_id where j.site_id = p_site and r.verdict = 'pass' and r.created_at > now() - interval '30 days')),
    -- Every agent that has worked on this site: its latest run and how many in 30 days.
    'agents', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('agent', coalesce(j.agent, substring(j.kind from '^agent:(seo-[a-z0-9-]+)$')), 'status', (array_agg(j.status order by j.updated_at desc))[1],
          'title', left((array_agg(j.title order by j.updated_at desc))[1], 160), 'at', max(j.updated_at),
          'runs30', count(*) filter (where j.created_at > now() - interval '30 days')) x
        from public.jobs j where j.site_id = p_site and coalesce(j.agent, substring(j.kind from '^agent:(seo-[a-z0-9-]+)$')) is not null group by coalesce(j.agent, substring(j.kind from '^agent:(seo-[a-z0-9-]+)$'))) t), '[]'::jsonb),
    -- Work in progress and the latest steps, newest first: the live view.
    'live', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('agent', coalesce(j.agent, substring(j.kind from '^agent:(seo-[a-z0-9-]+)$')), 'kind', j.kind, 'title', left(j.title, 160), 'status', j.status, 'at', j.updated_at) x
        from public.jobs j where j.site_id = p_site and j.status in ('queued', 'running', 'awaiting_review', 'authorized', 'awaiting_approval', 'escalated')
        order by j.updated_at desc limit 20) t), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('at', e.at, 'agent', coalesce(j.agent, substring(j.kind from '^agent:(seo-[a-z0-9-]+)$')), 'kind', j.kind, 'title', left(j.title, 120), 'to', e.to_status,
          'note', case when agency then left(e.note, 200) end) x
        from public.job_events e join public.jobs j on j.id = e.job_id where j.site_id = p_site order by e.at desc, e.id desc limit 25) t), '[]'::jsonb));
end $$;

revoke all on function public.site_pipeline(uuid) from public, anon, authenticated;
grant execute on function public.site_pipeline(uuid) to authenticated;
