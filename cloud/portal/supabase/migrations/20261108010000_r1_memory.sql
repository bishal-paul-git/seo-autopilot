-- Site memory writes for workers (service role): a new value for the same (site, kind, key) supersedes the old one, so
-- history is kept and the current view is "superseded_at is null". Reads by kind for the worker. Not applied anywhere.
create or replace function public.remember(p_site uuid, p_items jsonb, p_actor text default 'seo-god')
returns int language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site); it jsonb; n int := 0;
begin
  if v_org is null then raise exception 'site not found'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then raise exception 'items must be an array of at most 500'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    update public.site_memory set superseded_at = now()
      where site_id = p_site and kind = it->>'kind' and key = it->>'key' and superseded_at is null and value is distinct from it->'value';
    if not exists (select 1 from public.site_memory where site_id = p_site and kind = it->>'kind' and key = it->>'key' and superseded_at is null) then
      insert into public.site_memory (org_id, site_id, kind, key, value, basis, confidence, source, created_by)
        values (v_org, p_site, it->>'kind', it->>'key', coalesce(it->'value', 'null'::jsonb), it->>'basis', nullif(it->>'confidence', '')::numeric, it->>'source', p_actor);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

create or replace function public.recall(p_site uuid, p_kind text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', m.kind, 'key', m.key, 'value', m.value, 'basis', m.basis, 'confidence', m.confidence, 'source', m.source, 'at', m.created_at) order by m.kind, m.key), '[]'::jsonb)
  from public.site_memory m where m.site_id = p_site and m.superseded_at is null and (p_kind is null or m.kind = p_kind);
$$;

revoke all on function public.remember(uuid, jsonb, text), public.recall(uuid, text) from public, anon, authenticated;
grant execute on function public.remember(uuid, jsonb, text), public.recall(uuid, text) to service_role;
