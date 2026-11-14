-- "Give us read access" (D56): the customer adds the platform's Google service-account email as a user of their Search
-- Console property and GA4 property, presses Check access (the Worker lists what the service account can read for this
-- site's host only) and picks the property. No Google sign-in, no key, no file, no repository secret.
--
-- The shared service account can read every property any customer granted it, so the database decides which site may
-- use which property:
--   * one property can be bound to only ONE site across all agencies (unique constraints), and one site's host can hold
--     only one Search Console binding;
--   * a Search Console property must be one the Worker listed for this site AND cover the site's host;
--   * a domain registered by another agency too needs a platform admin's confirmation (the D34 rule, set_gsc_allowed);
--   * a refused attempt is recorded for the platform admin (google_conflicts on Operations).
-- Sites without a binding keep the D34 path: a platform admin confirms them (set_gsc_allowed) and the lookup of D53 runs.

alter table public.integrations drop constraint if exists integrations_provider_check;
alter table public.integrations add constraint integrations_provider_check
  check (provider in ('search_console', 'ga4', 'github', 'crawler', 'bing_webmaster', 'google_sheets', 'other', 'google'));

create table if not exists public.google_bindings (
  id bigserial primary key,
  org_id uuid not null,
  site_id uuid not null references public.sites (id) on delete cascade,
  kind text not null check (kind in ('gsc', 'ga4')),
  property text not null,
  host text,                           -- gsc: the site's host when bound
  bound_by uuid, bound_at timestamptz not null default now(),
  unique (property),                   -- one property, one website, across every agency
  unique (site_id, kind)
);
create unique index if not exists google_bindings_gsc_host on public.google_bindings (host) where kind = 'gsc';
alter table public.google_bindings enable row level security; -- no policies: read and written only through the functions below
revoke all on public.google_bindings from public, anon, authenticated;

create table if not exists public.google_binding_conflicts (
  id bigserial primary key,
  site_id uuid references public.sites (id) on delete cascade, org_id uuid,
  kind text, property text, reason text, held_by_site uuid, user_id uuid,
  at timestamptz not null default now()
);
alter table public.google_binding_conflicts enable row level security;
revoke all on public.google_binding_conflicts from public, anon, authenticated;

-- 'agency' (a member of the site's agency), 'client' (a client user of the site) or null.
create or replace function private.google_role(p_site uuid, p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.sites s join public.org_members m on m.org_id = s.org_id where s.id = p_site and m.user_id = p_user) then 'agency'
    when exists (select 1 from public.sites s join public.client_members m on m.client_id = s.client_id where s.id = p_site and m.user_id = p_user) then 'client'
  end;
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

-- The best property for the site from a list: the domain property first, then https, then http prefixes.
create or replace function private.gsc_pick(p_site_url text, p_choices jsonb)
returns text language sql immutable set search_path = '' as $$
  select c->>'url' from jsonb_array_elements(case when jsonb_typeof(p_choices->'sites') = 'array' then p_choices->'sites' else '[]'::jsonb end) c
   where private.gsc_covers(p_site_url, c->>'url')
   order by case when c->>'url' = 'sc-domain:' || private.site_host(p_site_url) then 0 when c->>'url' like 'sc-domain:%' then 3
                 when c->>'url' like 'https://%' then 1 else 2 end, length(c->>'url')
   limit 1;
$$;

-- The last lists the Worker returned for this site, with "taken" marking a property bound to another site.
create or replace function private.google_choices(p_site uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'sites', coalesce((select jsonb_agg(c || jsonb_build_object('taken', exists (select 1 from public.google_bindings b where b.property = c->>'url' and b.site_id <> p_site)))
      from jsonb_array_elements(coalesce(i.detail->'choices'->'sites', '[]'::jsonb)) c), '[]'::jsonb),
    'ga4', coalesce((select jsonb_agg(g || jsonb_build_object('taken', exists (select 1 from public.google_bindings b where b.property = g->>'id' and b.site_id <> p_site)))
      from jsonb_array_elements(coalesce(i.detail->'choices'->'ga4', '[]'::jsonb)) g), '[]'::jsonb),
    'checkedAt', i.detail->'choices'->>'checkedAt')
  from public.integrations i where i.site_id = p_site and i.provider = 'google' and i.scope = 'read';
$$;

create or replace function private.google_conflict(p_site uuid, p_kind text, p_property text, p_reason text, p_held uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.google_binding_conflicts (site_id, org_id, kind, property, reason, held_by_site, user_id)
    values (p_site, private.site_org(p_site), p_kind, left(p_property, 300), p_reason, p_held, p_user);
  insert into public.audit_log (org_id, site_id, actor, action, target, data)
    values (private.site_org(p_site), p_site, p_user, 'google.conflict', left(p_property, 300), jsonb_build_object('kind', p_kind, 'reason', p_reason));
end $$;

-- A site's address changed: its Search Console binding no longer applies (like the D34 confirmation reset).
create or replace function private.sites_google_reset()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.url is distinct from old.url then delete from public.google_bindings where site_id = new.id and kind = 'gsc'; end if;
  return new;
end $$;
drop trigger if exists sites_google_reset on public.sites;
create trigger sites_google_reset after update of url on public.sites for each row execute function private.sites_google_reset();

-- Worker, as the signed-in user: may this person check this site? Returns its address (never other sites').
create or replace function public.google_access_site(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text := private.google_role(p_site, (select auth.uid()));
begin
  if v_role is null then raise exception 'not allowed'; end if;
  return (select jsonb_build_object('site', s.id, 'url', s.url, 'role', v_role) from public.sites s where s.id = p_site);
end $$;

-- Worker (service role): keep what the service account can read for this site, filtered again to the site's host.
create or replace function public.google_access_seen(p_site uuid, p_choices jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.sites; v_sites jsonb; v_ga4 jsonb;
begin
  select * into s from public.sites where id = p_site;
  if s.id is null then raise exception 'site not found'; end if;
  v_sites := coalesce((select jsonb_agg(jsonb_build_object('url', left(c->>'url', 300), 'level', c->>'level')) from jsonb_array_elements(case when jsonb_typeof(p_choices->'sites') = 'array' then p_choices->'sites' else '[]'::jsonb end) c
    where private.gsc_covers(s.url, c->>'url')), '[]'::jsonb);
  v_ga4 := coalesce((select jsonb_agg(jsonb_build_object('id', g->>'id', 'name', left(g->>'name', 120), 'account', left(g->>'account', 120))) from jsonb_array_elements(case when jsonb_typeof(p_choices->'ga4') = 'array' then p_choices->'ga4' else '[]'::jsonb end) g
    where g->>'id' ~ '^properties/[0-9]+$'), '[]'::jsonb);
  insert into public.integrations (org_id, site_id, provider, scope, status, detail)
    values (s.org_id, s.id, 'google', 'read', 'unconnected', jsonb_build_object('choices', jsonb_build_object('sites', v_sites, 'ga4', v_ga4, 'checkedAt', now())))
    on conflict (site_id, provider, scope) do update set detail = coalesce(public.integrations.detail, '{}'::jsonb) || excluded.detail;
  return private.google_choices(p_site) || jsonb_build_object('suggested', private.gsc_pick(s.url, jsonb_build_object('sites', v_sites)),
    'gscProperty', (select property from public.google_bindings where site_id = p_site and kind = 'gsc'),
    'ga4Property', (select property from public.google_bindings where site_id = p_site and kind = 'ga4'));
end $$;

-- What the portal shows: the bound properties, the last check's lists (this site's host only), the state. No secrets.
create or replace function public.site_google(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text := private.google_role(p_site, (select auth.uid())); i public.integrations; s public.sites; ch jsonb;
begin
  if v_role is null then raise exception 'not allowed'; end if;
  select * into s from public.sites where id = p_site;
  select * into i from public.integrations x where x.site_id = p_site and x.provider = 'google' and x.scope = 'read';
  ch := coalesce(private.google_choices(p_site), jsonb_build_object('sites', '[]'::jsonb, 'ga4', '[]'::jsonb, 'checkedAt', null));
  return jsonb_build_object('role', v_role, 'canManage', true,
    'gscProperty', (select property from public.google_bindings where site_id = p_site and kind = 'gsc'),
    'ga4Property', (select property from public.google_bindings where site_id = p_site and kind = 'ga4'),
    'ga4Name', (select g->>'name' from jsonb_array_elements(ch->'ga4') g where g->>'id' = (select property from public.google_bindings where site_id = p_site and kind = 'ga4') limit 1),
    'choices', ch, 'suggested', private.gsc_pick(s.url, ch),
    'status', coalesce(i.status, 'unconnected'), 'lastOkAt', i.last_ok_at, 'lastError', case when v_role = 'agency' then i.last_error end);
end $$;

-- Bind (or, with null, unbind) the site's Search Console and GA4 properties. Each must be in the last check's list for
-- this site; Search Console must cover the site's host. A property or host already bound elsewhere is refused and
-- recorded for the platform admin. Returns { ok: false, error } for a refusal so the record is kept.
create or replace function public.bind_google(p_site uuid, p_gsc text, p_ga4 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_role text := private.google_role(p_site, v_user); s public.sites; ch jsonb; v_held uuid; v_kind text;
  v_gsc text := nullif(trim(coalesce(p_gsc, '')), ''); v_ga4 text := nullif(trim(coalesce(p_ga4, '')), '');
begin
  if v_role is null then raise exception 'not allowed'; end if;
  select * into s from public.sites where id = p_site;
  ch := coalesce(private.google_choices(p_site), '{}'::jsonb);
  if v_gsc is not null and not (exists (select 1 from jsonb_array_elements(coalesce(ch->'sites', '[]'::jsonb)) c where c->>'url' = v_gsc) and private.gsc_covers(s.url, v_gsc)) then
    raise exception 'that Search Console property was not found for this website: press Check access first'; end if;
  if v_ga4 is not null and not exists (select 1 from jsonb_array_elements(coalesce(ch->'ga4', '[]'::jsonb)) g where g->>'id' = v_ga4) then
    raise exception 'that Analytics property was not found for this website: press Check access first'; end if;
  -- The D34 rule: a domain another agency also registered is used only after a platform admin confirmed this site.
  if v_gsc is not null and not s.gsc_allowed and exists (select 1 from public.sites o where o.org_id <> s.org_id and private.site_host(o.url) = private.site_host(s.url)) then
    perform private.google_conflict(p_site, 'gsc', v_gsc, 'domain also registered in another agency', null, v_user);
    return jsonb_build_object('ok', false, 'error', 'This domain is also registered by another agency. The platform admin has been told and will confirm who owns it.');
  end if;
  select site_id into v_held from public.google_bindings where (property = v_gsc or (kind = 'gsc' and v_gsc is not null and host = private.site_host(s.url))) and site_id <> p_site limit 1;
  v_kind := 'gsc';
  if v_held is null then select site_id into v_held from public.google_bindings where property = v_ga4 and site_id <> p_site limit 1; v_kind := 'ga4'; end if;
  if v_held is not null then
    perform private.google_conflict(p_site, v_kind, case when v_kind = 'gsc' then v_gsc else v_ga4 end, 'already connected to another website', v_held, v_user);
    return jsonb_build_object('ok', false, 'error', 'That property is already connected to another website. The platform admin has been told.');
  end if;
  begin
    if v_gsc is null then delete from public.google_bindings where site_id = p_site and kind = 'gsc';
    else insert into public.google_bindings (org_id, site_id, kind, property, host, bound_by) values (s.org_id, s.id, 'gsc', v_gsc, private.site_host(s.url), v_user)
      on conflict (site_id, kind) do update set property = excluded.property, host = excluded.host, bound_by = excluded.bound_by, bound_at = now(); end if;
    if v_ga4 is null then delete from public.google_bindings where site_id = p_site and kind = 'ga4';
    else insert into public.google_bindings (org_id, site_id, kind, property, bound_by) values (s.org_id, s.id, 'ga4', v_ga4, v_user)
      on conflict (site_id, kind) do update set property = excluded.property, bound_by = excluded.bound_by, bound_at = now(); end if;
  exception when unique_violation then -- a race with another site: the constraint decides
    perform private.google_conflict(p_site, 'gsc', coalesce(v_gsc, v_ga4), 'already connected to another website', null, v_user);
    return jsonb_build_object('ok', false, 'error', 'That property is already connected to another website. The platform admin has been told.');
  end;
  update public.integrations set status = case when v_gsc is not null or v_ga4 is not null then 'connected' else 'unconnected' end, last_error = null,
         detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('gscProperty', v_gsc, 'ga4Property', v_ga4, 'boundAt', now())
   where site_id = p_site and provider = 'google' and scope = 'read';
  insert into public.audit_log (org_id, site_id, actor, action, target, data) values (s.org_id, s.id, v_user, 'google.bind', 'google', jsonb_build_object('gscProperty', v_gsc, 'ga4Property', v_ga4));
  return jsonb_build_object('ok', true) || public.site_google(p_site);
end $$;

-- Worker: the bound properties of a site (Search Console only while it still covers the site's host), or nothing.
create or replace function public.google_target(p_site uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when count(*) = 0 then null else jsonb_build_object(
      'gscProperty', max(b.property) filter (where b.kind = 'gsc' and private.gsc_covers(s.url, b.property)),
      'ga4Property', max(b.property) filter (where b.kind = 'ga4')) end
    from public.google_bindings b join public.sites s on s.id = b.site_id where b.site_id = p_site;
$$;

-- Worker (planning): has the site a bound property to read?
create or replace function public.google_bound(p_site uuid)
returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.google_bindings where site_id = p_site) $$;

-- Platform admins: refused bindings (Operations), and releasing a binding after checking who owns the property.
create or replace function public.google_conflicts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', c.at, 'kind', c.kind, 'property', c.property, 'reason', c.reason,
      'site', (select s.name from public.sites s where s.id = c.site_id), 'agency', (select o.name from public.orgs o where o.id = c.org_id),
      'heldBy', (select s.name from public.sites s where s.id = c.held_by_site)) order by c.at desc)
    from (select * from public.google_binding_conflicts order by at desc limit 50) c), '[]'::jsonb);
end $$;

create or replace function public.release_google_binding(p_property text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.google_bindings;
begin
  if not private.is_platform_admin() then raise exception 'not allowed'; end if;
  delete from public.google_bindings where property = p_property returning * into b;
  if b.id is null then raise exception 'no website uses that property'; end if;
  update public.integrations set status = case when exists (select 1 from public.google_bindings x where x.site_id = b.site_id) then 'connected' else 'unconnected' end
   where site_id = b.site_id and provider = 'google' and scope = 'read';
  insert into public.audit_log (org_id, site_id, actor, action, target) values (b.org_id, b.site_id, (select auth.uid()), 'google.release', b.property);
  return jsonb_build_object('released', b.property, 'site', b.site_id);
end $$;

revoke all on function private.google_role(uuid, uuid), private.gsc_covers(text, text), private.gsc_pick(text, jsonb), private.google_choices(uuid),
  private.google_conflict(uuid, text, text, text, uuid, uuid), private.sites_google_reset() from public, anon, authenticated;
revoke all on function public.google_access_site(uuid), public.google_access_seen(uuid, jsonb), public.site_google(uuid), public.bind_google(uuid, text, text),
  public.google_target(uuid), public.google_bound(uuid), public.google_conflicts(), public.release_google_binding(text) from public, anon, authenticated;
grant execute on function public.google_access_site(uuid), public.site_google(uuid), public.bind_google(uuid, text, text), public.google_conflicts(), public.release_google_binding(text) to authenticated;
grant execute on function public.google_access_seen(uuid, jsonb), public.google_target(uuid), public.google_bound(uuid) to service_role;

-- site_pipeline (D54) with the bound Google properties (D56): Search Console waits for its first read once a property is
-- bound, a lost access shows as needing attention, and Analytics and the weekly speed check appear. Same otherwise.
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
                   when g.status = 'error' then 'Search Console access was removed: add the email again and press Check access'
                   when sj.status = 'escalated' then case when agency then coalesce(sj.note, 'No access') else 'Waiting for access' end
                   when g.detail->>'gscProperty' is not null then 'Access given; the first read runs at the next planning'
                   when g.status = 'connected' then 'Choose the Search Console property on Connections'
                   when s.gsc_allowed then 'Waiting for the first read'
                   else 'Not connected yet' end,
    'at', rep.created_at));
  -- D56: Analytics for the bound GA4 property, and the weekly central speed check.
  conns := conns || coalesce((select jsonb_build_array(jsonb_build_object('key', 'analytics', 'name', 'Google Analytics 4',
      'state', case when m.created_at > now() - interval '3 days' then 'connected' else 'waiting' end,
      'detail', coalesce(m.value->'totals'->>'sessions', '0') || ' visits in 28 days', 'at', m.created_at))
    from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'analytics' and m.superseded_at is null limit 1),
    case when g.detail->>'ga4Property' is not null then jsonb_build_array(jsonb_build_object('key', 'analytics', 'name', 'Google Analytics 4', 'state', 'waiting',
      'detail', 'Access given; the first read runs at the next planning', 'at', null)) else '[]'::jsonb end);
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
