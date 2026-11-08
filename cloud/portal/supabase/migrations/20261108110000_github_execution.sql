-- Verified execution through the site's own GitHub repository (R1-E1, decision D37).
-- The hosted SEO God never edits a website itself. For a site whose code is in GitHub, an approved recommendation
-- becomes an issue in that repository, and the site's existing seo-implement workflow drafts a pull request (content
-- files only, no builds, seo-check and seo-review on the pull request, merged by a person or the site's own autopilot
-- policy, D17). The scheduler then follows the pull request and verifies the change with the next scan.
--
-- The agency brings its own GitHub token (rule 6): a fine-grained token for that one repository with Issues and Actions
-- read/write and Pull requests and Metadata read. It is stored in Supabase Vault, is never returned to any browser,
-- and only the service role (the Worker) can read it, for a connected site.

-- Agency owners connect or disconnect GitHub for one of their sites.
create or replace function public.connect_github(p_site uuid, p_repo text, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site); v_repo text := trim(coalesce(p_repo, '')); v_name text := 'github_token:' || p_site::text; v_id uuid;
begin
  if v_org is null or not private.is_owner(v_org) then raise exception 'only an owner of the agency can connect GitHub'; end if;
  if v_repo !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' or v_repo ~ '(^|/)\.+(/|$)' then raise exception 'repository must look like owner/name'; end if;
  if p_token is null or length(trim(p_token)) < 20 or trim(p_token) ~ '\s' then raise exception 'that does not look like a GitHub token'; end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then perform vault.create_secret(trim(p_token), v_name, 'GitHub token for one site (SEO Autopilot)');
  else perform vault.update_secret(v_id, trim(p_token)); end if;
  update public.sites set repo = v_repo where id = p_site;
  insert into public.integrations (org_id, site_id, provider, scope, status, detail, last_error)
    values (v_org, p_site, 'github', 'write', 'connected', jsonb_build_object('repo', v_repo, 'connectedAt', now()), null)
    on conflict (site_id, provider, scope) do update set status = 'connected', detail = excluded.detail, last_error = null;
  insert into public.audit_log (org_id, site_id, actor, action, target, data) values (v_org, p_site, (select auth.uid()), 'integration.connect', 'github', jsonb_build_object('repo', v_repo));
  return jsonb_build_object('provider', 'github', 'repo', v_repo, 'status', 'connected');
end $$;

create or replace function public.disconnect_github(p_site uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site);
begin
  if v_org is null or not private.is_owner(v_org) then raise exception 'only an owner of the agency can disconnect GitHub'; end if;
  delete from vault.secrets where name = 'github_token:' || p_site::text;
  update public.integrations set status = 'revoked', last_error = null where site_id = p_site and provider = 'github' and scope = 'write';
  insert into public.audit_log (org_id, site_id, actor, action, target) values (v_org, p_site, (select auth.uid()), 'integration.disconnect', 'github');
  return jsonb_build_object('provider', 'github', 'status', 'revoked');
end $$;

-- What agency members may see about a site's integrations: never a secret.
create or replace function public.site_integrations(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site);
begin
  if v_org is null or not private.is_member(v_org) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('provider', i.provider, 'scope', i.scope, 'status', i.status, 'repo', i.detail->>'repo',
           'lastOkAt', i.last_ok_at, 'lastError', i.last_error) order by i.provider, i.scope)
         from public.integrations i where i.site_id = p_site), '[]'::jsonb);
end $$;

-- Changes on their way to the website, for agency members: the issue, the pull request, the verification. No secrets.
create or replace function public.site_deployments(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site);
begin
  if v_org is null or not private.is_member(v_org) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(x order by x->>'updatedAt' desc) from (
    select jsonb_build_object('id', j.id, 'title', j.title, 'status', j.status, 'updatedAt', j.updated_at,
             'page', j.outputs->'deploy'->>'url', 'issue', j.outputs->'deploy'->'issue', 'issueUrl', j.outputs->'deploy'->>'issueUrl',
             'pr', j.outputs->'deploy'->'pr', 'prUrl', j.outputs->'deploy'->>'prUrl', 'mergedAt', j.outputs->'deploy'->>'mergedAt',
             'verification', j.outputs->'verification'->>'summary', 'error', j.error) x
      from public.jobs j where j.site_id = p_site and j.kind = 'implement' order by j.updated_at desc limit 20) t), '[]'::jsonb);
end $$;

-- The Worker's view: the repository and token of a connected site, or nothing.
create or replace function public.github_target(p_site uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('repo', i.detail->>'repo', 'token', s.decrypted_secret)
    from public.integrations i join vault.decrypted_secrets s on s.name = 'github_token:' || p_site::text
   where i.site_id = p_site and i.provider = 'github' and i.scope = 'write' and i.status = 'connected' and i.detail ? 'repo';
$$;

-- The Worker reports whether a call worked, so the agency sees a broken token instead of silence.
create or replace function public.record_integration_status(p_site uuid, p_provider text, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.integrations set last_ok_at = case when p_ok then now() else last_ok_at end,
         last_error = case when p_ok then null else left(p_error, 300) end,
         status = case when p_ok then 'connected' when status = 'connected' then 'error' else status end
   where site_id = p_site and provider = p_provider and status in ('connected', 'error');
$$;

-- An agency member asks for one recommendation of an accepted advice result to be implemented. This only drafts the
-- work order (free, no change anywhere); the agency approves the exact work order before anything reaches GitHub.
create or replace function public.request_implementation(p_job uuid, p_index int)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare src public.jobs; rec jsonb; j public.jobs;
begin
  select * into src from public.jobs where id = p_job;
  if src.id is null or not private.is_member(src.org_id) then raise exception 'not allowed'; end if;
  if src.status <> 'completed' then raise exception 'only accepted advice can be implemented'; end if;
  rec := src.outputs->'proposal'->'recommendations'->p_index;
  if rec is null or jsonb_typeof(rec) <> 'object' then raise exception 'no such recommendation'; end if;
  if not exists (select 1 from public.integrations i where i.site_id = src.site_id and i.provider = 'github' and i.scope = 'write' and i.status = 'connected') then
    raise exception 'connect GitHub for this website first';
  end if;
  j := public.create_job(src.site_id, 'implement', left('Implement: ' || coalesce(rec->>'title', 'recommendation'), 200), 'agency', 'medium', false, 2,
         jsonb_build_object('sourceJob', src.id, 'index', p_index, 'recommendation', rec), 'implement:' || src.id::text || ':' || p_index::text, 'implement an accepted recommendation through the site''s GitHub workflow');
  return j;
end $$;

revoke all on function public.connect_github(uuid, text, text), public.disconnect_github(uuid), public.site_integrations(uuid), public.github_target(uuid),
  public.record_integration_status(uuid, text, boolean, text), public.request_implementation(uuid, int), public.site_deployments(uuid) from public, anon, authenticated;
grant execute on function public.connect_github(uuid, text, text), public.disconnect_github(uuid), public.site_integrations(uuid), public.request_implementation(uuid, int), public.site_deployments(uuid) to authenticated;
grant execute on function public.github_target(uuid), public.record_integration_status(uuid, text, boolean, text) to service_role;
