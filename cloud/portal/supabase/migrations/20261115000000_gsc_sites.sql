-- Search Console confirmation in the portal (D47). Platform admins confirm which websites the shared Google service
-- account may read (D34: a domain one agency added must not be read with access its real owner granted to another).
-- Until now that took a SQL call to set_gsc_allowed; this lists the websites so the Operations page can offer a button.
-- Read-only; platform admins only; no change to set_gsc_allowed or its checks.
create or replace function public.gsc_sites()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'url', s.url, 'status', s.status, 'allowed', s.gsc_allowed, 'allowedAt', s.gsc_allowed_at,
      'conflict', exists (select 1 from public.sites o where o.org_id <> s.org_id and private.site_host(o.url) = private.site_host(s.url)),
      'agency', (select o.name from public.orgs o where o.id = s.org_id)) order by s.name)
    from public.sites s), '[]'::jsonb);
end $$;
revoke all on function public.gsc_sites() from public, anon, authenticated;
grant execute on function public.gsc_sites() to authenticated;
