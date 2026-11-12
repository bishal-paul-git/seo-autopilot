-- Business brief (D44): the onboarding questions are asked once, as one optional form when a website is added (and
-- editable later), instead of one by one on the SEO God page. Answers are the same site_memory 'answer' rows the
-- planner already reads, so an answer here closes the matching question and is written into the strategy when the agency
-- approves it (D43). Agency members only; a fixed list of keys; 2,000 characters each; every save is audited.
create or replace function private.brief_keys()
returns text[] language sql immutable set search_path = '' as $$
  select array['goals', 'conversions', 'target_locations', 'services_priority', 'competitors', 'brand_voice', 'restrictions', 'publishing_access', 'contact_phone', 'contact_email'];
$$;

create or replace function public.site_brief(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site);
begin
  if v_org is null or not private.is_member(v_org) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'answers', coalesce((select jsonb_object_agg(m.key, m.value->>'value') from public.site_memory m
                          where m.site_id = p_site and m.kind = 'answer' and m.superseded_at is null and m.key = any (private.brief_keys())), '{}'::jsonb),
    -- What the scan could not find on the site itself: the fields worth filling first.
    'asked', coalesce((select jsonb_agg(m.key order by m.key) from public.site_memory m
                        where m.site_id = p_site and m.kind = 'question' and m.superseded_at is null and m.key = any (private.brief_keys())), '[]'::jsonb),
    'scanned', exists (select 1 from public.site_memory m where m.site_id = p_site and m.kind in ('identity', 'brand') and m.superseded_at is null));
end $$;

-- Saves the whole form at once: a value replaces the earlier answer, an empty value clears it, unknown keys are refused.
create or replace function public.save_brief(p_site uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site); k text; v text; saved int := 0; cleared int := 0;
begin
  if v_org is null or not private.is_member(v_org) then raise exception 'not allowed'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'answers must be an object'; end if;
  for k, v in select key, trim(coalesce(value #>> '{}', '')) from jsonb_each(p_answers) loop
    if not (k = any (private.brief_keys())) then raise exception 'unknown field: %', left(k, 40); end if;
    if length(v) > 2000 then raise exception '% is longer than 2000 characters', k; end if;
    if v = coalesce((select m.value->>'value' from public.site_memory m where m.site_id = p_site and m.kind = 'answer' and m.key = k and m.superseded_at is null), '') then continue; end if;
    update public.site_memory set superseded_at = now() where site_id = p_site and kind = 'answer' and key = k and superseded_at is null;
    if v = '' then cleared := cleared + 1; continue; end if;
    insert into public.site_memory (org_id, site_id, kind, key, value, basis, confidence, source, created_by)
      values (v_org, p_site, 'answer', k, jsonb_build_object('value', v), 'answered', 1, 'business brief', (select auth.uid())::text);
    saved := saved + 1;
  end loop;
  if saved + cleared > 0 then
    insert into public.audit_log (org_id, site_id, actor, action, target, data) values (v_org, p_site, (select auth.uid()), 'memory.brief', null, jsonb_build_object('saved', saved, 'cleared', cleared));
  end if;
  return jsonb_build_object('saved', saved, 'cleared', cleared);
end $$;

revoke all on function private.brief_keys(), public.site_brief(uuid), public.save_brief(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.brief_keys() to authenticated;
grant execute on function public.site_brief(uuid), public.save_brief(uuid, jsonb) to authenticated;
