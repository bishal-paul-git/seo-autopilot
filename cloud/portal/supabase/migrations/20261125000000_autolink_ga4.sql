-- D61 follow-up: automatic linking also retries Analytics. Before this, google_autolink_due was false as soon as Search
-- Console was linked, so a site whose first attempt could not read GA4 (for example, the Analytics Admin API was not yet
-- enabled) was never tried again. Now it is due, at most once a day, while either link is missing. Unchanged: live sites
-- only, never after a person removed the Search Console property, and never once a person chose the properties on the
-- Connections page (google.bind in the audit log): a person's choice, including "no Analytics", is kept.
create or replace function public.google_autolink_due(p_site uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sites s where s.id = p_site and s.status <> 'paused')
     and (not exists (select 1 from public.google_bindings b where b.site_id = p_site and b.kind = 'gsc')
          or (not exists (select 1 from public.google_bindings b where b.site_id = p_site and b.kind = 'ga4')
              and not exists (select 1 from public.audit_log a where a.site_id = p_site and a.action = 'google.bind')))
     and not exists (select 1 from public.integrations i where i.site_id = p_site and i.provider = 'google' and i.scope = 'read'
                      and (nullif(i.detail->>'gscRemovedAt', '') is not null or (i.detail->'autolink'->>'at')::timestamptz >= date_trunc('day', now())));
$$;
revoke all on function public.google_autolink_due(uuid) from public, anon, authenticated;
grant execute on function public.google_autolink_due(uuid) to service_role;
