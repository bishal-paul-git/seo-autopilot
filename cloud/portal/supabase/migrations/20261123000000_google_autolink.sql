-- Automatic Google linking (D61). Until now a site got Search Console and GA4 data only after a signed-in user pressed
-- Check access and picked the properties (D56). Now the Worker's free `google_autolink` job does it once a day for every
-- live site without a Search Console binding: it lists what the shared service account can read for the site's host
-- (the D56 listing), picks only an unambiguous property, and binds it HERE, with the same checks as bind_google:
--   * the property must be in the stored list for this site and cover the site's host;
--   * one property, one website across every agency; one Search Console binding per host (the D56 constraints);
--   * a domain another agency also registered needs a platform admin's confirmation (the D34 rule);
--   * a refusal is recorded for the platform admin (google_binding_conflicts and the audit log; daily repeats are not).
-- Who made a binding is kept (bound_via: 'person' or 'auto'). When nothing is bound, the reason is kept so the portal
-- can show "Add our email in Search Console" or "Pick a property". A person who removes a property turns automatic
-- linking off for that website until they pick one again.
-- Run after 20261121000000. Only the Worker (service role) may call google_autolink and google_autolink_due.

alter table public.google_bindings add column if not exists bound_via text not null default 'person';
alter table public.google_bindings drop constraint if exists google_bindings_bound_via_check;
alter table public.google_bindings add constraint google_bindings_bound_via_check check (bound_via in ('person', 'auto'));

-- Why a property may not be bound to this site, or null. The checks bind_google and google_autolink share:
--   unlisted       not in the last list for this site (or, for Search Console, not covering the site's host)
--   other_agency   a Search Console property for a domain another agency registered too, not confirmed by an admin (D34)
--   taken          the property, or for Search Console another property of the same host, is bound to another website
create or replace function private.google_refusal(p_site uuid, p_kind text, p_property text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.sites; ch jsonb; v_held uuid;
begin
  if p_property is null then return null; end if;
  select * into s from public.sites where id = p_site;
  ch := coalesce(private.google_choices(p_site), '{}'::jsonb);
  if p_kind = 'gsc' then
    if not (exists (select 1 from jsonb_array_elements(coalesce(ch->'sites', '[]'::jsonb)) c where c->>'url' = p_property) and private.gsc_covers(s.url, p_property)) then
      return jsonb_build_object('code', 'unlisted'); end if;
    if not s.gsc_allowed and exists (select 1 from public.sites o where o.org_id <> s.org_id and private.site_host(o.url) = private.site_host(s.url)) then
      return jsonb_build_object('code', 'other_agency', 'reason', 'domain also registered in another agency'); end if;
    select site_id into v_held from public.google_bindings where (property = p_property or (kind = 'gsc' and host = private.site_host(s.url))) and site_id <> p_site limit 1;
  else
    if not exists (select 1 from jsonb_array_elements(coalesce(ch->'ga4', '[]'::jsonb)) g where g->>'id' = p_property) then return jsonb_build_object('code', 'unlisted'); end if;
    select site_id into v_held from public.google_bindings where property = p_property and site_id <> p_site limit 1;
  end if;
  if v_held is not null then return jsonb_build_object('code', 'taken', 'reason', 'already connected to another website', 'held', v_held); end if;
  return null;
end $$;

-- bind_google (D56) with the shared checks; same messages, same order (both lists first, then Search Console's
-- conflicts, then GA4's). Unbinding Search Console by a person turns automatic linking off for the site (D61).
create or replace function public.bind_google(p_site uuid, p_gsc text, p_ga4 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_role text := private.google_role(p_site, v_user); s public.sites; rg jsonb; ra jsonb; v_off boolean;
  v_gsc text := nullif(trim(coalesce(p_gsc, '')), ''); v_ga4 text := nullif(trim(coalesce(p_ga4, '')), '');
begin
  if v_role is null then raise exception 'not allowed'; end if;
  select * into s from public.sites where id = p_site;
  rg := private.google_refusal(p_site, 'gsc', v_gsc); ra := private.google_refusal(p_site, 'ga4', v_ga4);
  if rg->>'code' = 'unlisted' then raise exception 'that Search Console property was not found for this website: press Check access first'; end if;
  if ra->>'code' = 'unlisted' then raise exception 'that Analytics property was not found for this website: press Check access first'; end if;
  if rg->>'code' = 'other_agency' then
    perform private.google_conflict(p_site, 'gsc', v_gsc, rg->>'reason', null, v_user);
    return jsonb_build_object('ok', false, 'error', 'This domain is also registered by another agency. The platform admin has been told and will confirm who owns it.');
  end if;
  if rg is not null or ra is not null then
    perform private.google_conflict(p_site, case when rg is not null then 'gsc' else 'ga4' end, case when rg is not null then v_gsc else v_ga4 end,
      'already connected to another website', coalesce(rg->>'held', ra->>'held')::uuid, v_user);
    return jsonb_build_object('ok', false, 'error', 'That property is already connected to another website. The platform admin has been told.');
  end if;
  -- Automatic linking stops when a person removes Search Console, or saves "None" while properties were offered; not
  -- when they save Analytics alone because no Search Console property could be seen yet.
  v_off := v_gsc is null and (exists (select 1 from public.google_bindings where site_id = p_site and kind = 'gsc')
    or jsonb_array_length(coalesce(private.google_choices(p_site)->'sites', '[]'::jsonb)) > 0);
  begin
    if v_gsc is null then delete from public.google_bindings where site_id = p_site and kind = 'gsc';
    else insert into public.google_bindings (org_id, site_id, kind, property, host, bound_by, bound_via) values (s.org_id, s.id, 'gsc', v_gsc, private.site_host(s.url), v_user, 'person')
      on conflict (site_id, kind) do update set property = excluded.property, host = excluded.host, bound_by = excluded.bound_by, bound_via = 'person', bound_at = now(); end if;
    if v_ga4 is null then delete from public.google_bindings where site_id = p_site and kind = 'ga4';
    else insert into public.google_bindings (org_id, site_id, kind, property, bound_by, bound_via) values (s.org_id, s.id, 'ga4', v_ga4, v_user, 'person')
      on conflict (site_id, kind) do update set property = excluded.property, bound_by = excluded.bound_by, bound_via = 'person', bound_at = now(); end if;
  exception when unique_violation then -- a race with another site: the constraint decides
    perform private.google_conflict(p_site, 'gsc', coalesce(v_gsc, v_ga4), 'already connected to another website', null, v_user);
    return jsonb_build_object('ok', false, 'error', 'That property is already connected to another website. The platform admin has been told.');
  end;
  update public.integrations set status = case when v_gsc is not null or v_ga4 is not null then 'connected' else 'unconnected' end, last_error = null,
         detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('gscProperty', v_gsc, 'ga4Property', v_ga4, 'boundAt', now(),
           'gscRemovedAt', case when v_off then to_jsonb(now()) when v_gsc is not null then 'null'::jsonb else coalesce(detail->'gscRemovedAt', 'null'::jsonb) end)
   where site_id = p_site and provider = 'google' and scope = 'read';
  insert into public.audit_log (org_id, site_id, actor, action, target, data) values (s.org_id, s.id, v_user, 'google.bind', 'google', jsonb_build_object('gscProperty', v_gsc, 'ga4Property', v_ga4));
  return jsonb_build_object('ok', true) || public.site_google(p_site);
end $$;

-- Worker (planning): should the site be linked automatically now? Live (not paused, as god_due_sites and the portfolio
-- count it), no Search Console binding, not tried today, and not removed by a person.
create or replace function public.google_autolink_due(p_site uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sites s where s.id = p_site and s.status <> 'paused')
     and not exists (select 1 from public.google_bindings b where b.site_id = p_site and b.kind = 'gsc')
     and not exists (select 1 from public.integrations i where i.site_id = p_site and i.provider = 'google' and i.scope = 'read'
                      and (nullif(i.detail->>'gscRemovedAt', '') is not null or (i.detail->'autolink'->>'at')::timestamptz >= date_trunc('day', now())));
$$;

-- A conflict found by automatic linking: recorded like a person's refusal, but once a week per site, property and
-- reason, so a daily retry does not flood the platform admin's list.
create or replace function private.google_auto_conflict(p_site uuid, p_kind text, p_property text, p_reason text, p_held uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.google_binding_conflicts c where c.site_id = p_site and c.kind = p_kind and c.property = left(p_property, 300) and c.reason = p_reason and c.user_id is null and c.at > now() - interval '7 days') then return; end if;
  perform private.google_conflict(p_site, p_kind, p_property, p_reason, p_held, null);
end $$;

-- Worker (service role), from the google_autolink job: keep the lists (this host only, as google_access_seen does), then
-- bind the Worker's pick with the shared checks. Never replaces a binding a person or an earlier run made, and never
-- binds an address-prefix property of another scheme or host (www counts). p_pick: { gsc, ga4, state, reason, ga4Reason }.
-- Returns { state: linked | pick | add_email, linked (Search Console bound now), gscProperty, ga4Property, reason, ga4Reason }.
create or replace function public.google_autolink(p_site uuid, p_choices jsonb, p_pick jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.sites; v_gsc text := nullif(trim(coalesce(p_pick->>'gsc', '')), ''); v_ga4 text := nullif(trim(coalesce(p_pick->>'ga4', '')), '');
  v_has_gsc text; v_has_ga4 text; r jsonb; v_linked boolean := false; v_ga4_linked boolean := false; v_state text; v_reason text; v_ga4_reason text := left(p_pick->>'ga4Reason', 300);
  v_why text; v_out jsonb;
begin
  select * into s from public.sites where id = p_site;
  if s.id is null then raise exception 'site not found'; end if;
  perform public.google_access_seen(p_site, coalesce(p_choices, '{}'::jsonb));
  select property into v_has_gsc from public.google_bindings where site_id = p_site and kind = 'gsc';
  select property into v_has_ga4 from public.google_bindings where site_id = p_site and kind = 'ga4';

  if v_has_gsc is null and v_gsc is not null then
    if not (v_gsc like 'sc-domain:%' or lower(substring(v_gsc from '^(https?://[^/:]+)')) = lower(substring(s.url from '^(https?://[^/:]+)'))) then
      r := jsonb_build_object('code', 'unlisted');
    else r := private.google_refusal(p_site, 'gsc', v_gsc); end if;
    if r is null then
      begin
        insert into public.google_bindings (org_id, site_id, kind, property, host, bound_by, bound_via) values (s.org_id, s.id, 'gsc', v_gsc, private.site_host(s.url), null, 'auto');
        v_linked := true;
      exception when unique_violation then r := jsonb_build_object('code', 'taken', 'reason', 'already connected to another website'); end;
    end if;
    if r->>'code' in ('other_agency', 'taken') then
      perform private.google_auto_conflict(p_site, 'gsc', v_gsc, r->>'reason', (r->>'held')::uuid);
      v_why := case when r->>'code' = 'other_agency' then 'This domain is also registered by another agency: the platform admin confirms who owns it before it is linked.'
                    else v_gsc || ' is already connected to another website: the platform admin has been told.' end;
    elsif r->>'code' = 'unlisted' then v_why := v_gsc || ' could not be linked automatically: pick a property.';
    end if;
  end if;
  if v_has_ga4 is null and v_ga4 is not null then
    r := private.google_refusal(p_site, 'ga4', v_ga4);
    if r is null then
      begin
        insert into public.google_bindings (org_id, site_id, kind, property, bound_by, bound_via) values (s.org_id, s.id, 'ga4', v_ga4, null, 'auto');
        v_ga4_linked := true;
      exception when unique_violation then r := jsonb_build_object('code', 'taken', 'reason', 'already connected to another website'); end;
    end if;
    if r->>'code' = 'taken' then perform private.google_auto_conflict(p_site, 'ga4', v_ga4, r->>'reason', (r->>'held')::uuid); end if;
    if r is not null then v_ga4_reason := 'The Analytics property is already connected to another website: pick another one.'; end if;
  end if;

  v_has_gsc := coalesce(v_has_gsc, case when v_linked then v_gsc end);
  v_has_ga4 := coalesce(v_has_ga4, case when v_ga4_linked then v_ga4 end);
  v_state := case when v_has_gsc is not null then 'linked'
                  when jsonb_array_length(coalesce(private.google_choices(p_site)->'sites', '[]'::jsonb)) = 0 then 'add_email' else 'pick' end;
  v_reason := case when v_state = 'linked' then null else left(coalesce(v_why, nullif(p_pick->>'reason', ''),
    case when v_state = 'pick' then 'Choose which property belongs to this website.' else 'We cannot see this website in Search Console yet: add our email as a user of the property.' end), 300) end;
  v_out := jsonb_build_object('at', now(), 'state', v_state, 'reason', v_reason, 'ga4Reason', case when v_has_ga4 is null then v_ga4_reason end,
    'gscProperty', v_has_gsc, 'ga4Property', v_has_ga4, 'linked', v_linked, 'ga4Linked', v_ga4_linked);
  update public.integrations set status = case when v_has_gsc is not null or v_has_ga4 is not null then 'connected' else status end,
         detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('autolink', v_out)
           || case when v_linked or v_ga4_linked then jsonb_build_object('gscProperty', v_has_gsc, 'ga4Property', v_has_ga4, 'boundAt', now()) else '{}'::jsonb end
   where site_id = p_site and provider = 'google' and scope = 'read';
  if v_linked or v_ga4_linked then
    insert into public.audit_log (org_id, site_id, actor, action, target, data)
      values (s.org_id, s.id, null, 'google.autolink', 'google', jsonb_build_object('gscProperty', case when v_linked then v_gsc end, 'ga4Property', case when v_ga4_linked then v_ga4 end, 'by', 'auto'));
  end if;
  return v_out;
end $$;

-- The state the portal shows for one site (no secrets): linked (with who linked it), pick (with the reason) or add_email.
create or replace function private.google_link_state(p_site uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with b as (select max(property) filter (where kind = 'gsc') gsc, max(property) filter (where kind = 'ga4') ga4,
                    max(bound_via) filter (where kind = 'gsc') via, max(bound_at) filter (where kind = 'gsc') at
               from public.google_bindings where site_id = p_site),
       i as (select detail from public.integrations where site_id = p_site and provider = 'google' and scope = 'read')
  select jsonb_build_object(
    'state', case when b.gsc is not null then 'linked'
                  when nullif(i.detail->>'gscRemovedAt', '') is not null or jsonb_array_length(coalesce(i.detail->'choices'->'sites', '[]'::jsonb)) > 0 then 'pick'
                  else 'add_email' end,
    'via', b.via, 'gscProperty', b.gsc, 'ga4Property', b.ga4, 'linkedAt', b.at,
    'ga4Name', (select g->>'name' from jsonb_array_elements(coalesce(i.detail->'choices'->'ga4', '[]'::jsonb)) g where g->>'id' = b.ga4 limit 1),
    'reason', case when b.gsc is not null then null
                   when nullif(i.detail->>'gscRemovedAt', '') is not null then 'The Search Console property was removed by a person, so it is not linked automatically: pick one to start reading again.'
                   else i.detail->'autolink'->>'reason' end,
    'ga4Reason', case when b.ga4 is null then i.detail->'autolink'->>'ga4Reason' end,
    'triedAt', i.detail->'autolink'->>'at',
    'hasData', exists (select 1 from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'search_console' and m.superseded_at is null))
  from b left join i on true;
$$;

-- site_google (D56) plus the link state and who made the binding (D61). Same fields otherwise.
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
    'status', coalesce(i.status, 'unconnected'), 'lastOkAt', i.last_ok_at, 'lastError', case when v_role = 'agency' then i.last_error end,
    'link', private.google_link_state(p_site));
end $$;

-- Portfolio (agency members): the Google state of every website they can see, for the per-site state and the banner.
create or replace function public.portfolio_google()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('site', s.id, 'name', s.name, 'url', s.url, 'status', s.status) || jsonb_build_object('link', private.google_link_state(s.id)) order by s.name), '[]'::jsonb)
    from public.sites s where (select auth.uid()) is not null and private.is_member(s.org_id);
$$;

revoke all on function private.google_refusal(uuid, text, text), private.google_auto_conflict(uuid, text, text, text, uuid), private.google_link_state(uuid) from public, anon, authenticated;
revoke all on function public.bind_google(uuid, text, text), public.site_google(uuid), public.google_autolink_due(uuid), public.google_autolink(uuid, jsonb, jsonb), public.portfolio_google() from public, anon, authenticated;
grant execute on function public.bind_google(uuid, text, text), public.site_google(uuid), public.portfolio_google() to authenticated;
grant execute on function public.google_autolink_due(uuid), public.google_autolink(uuid, jsonb, jsonb) to service_role;
