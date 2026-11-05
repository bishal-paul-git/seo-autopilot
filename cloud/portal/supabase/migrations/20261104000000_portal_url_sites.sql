-- Sites connected by address only (D25): no repository, no GitHub Actions. pg_cron wakes the `scan` Edge Function every
-- 10 minutes; it claims due sites, crawls them from Supabase and stores a snapshot. Adding a site or pressing "Scan now"
-- wakes it at once. Needs the pg_cron and pg_net extensions, and two Vault secrets set once per project:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/scan', 'scan_url');
--   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'scan_secret');
create extension if not exists pg_net;
create extension if not exists pg_cron;

alter table public.sites
  add column mode text not null default 'github' check (mode in ('github', 'url')),
  add column next_scan_at timestamptz,
  add column scan_state text check (scan_state in ('queued', 'running', 'done', 'failed')),
  add column scan_started_at timestamptz,
  add column scan_error text;
alter table public.sites drop constraint sites_status_check;
alter table public.sites add constraint sites_status_check check (status in ('connecting', 'scanning', 'live', 'paused'));
create index sites_scan_due_idx on public.sites (next_scan_at) where mode = 'url';

-- Wake the scan function. Never fails the caller: without pg_net or the Vault secrets the 10-minute schedule still runs.
create or replace function private.kick_scan()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'scan_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'scan_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-scan-secret', v_secret), body := '{}'::jsonb, timeout_milliseconds := 2000);
exception when others then null;
end;
$$;

-- Hosts the scanner refuses: bare IPs, localhost and private suffixes (the scanner runs inside the provider's network).
create or replace function private.public_host(p_url text)
returns boolean language sql immutable set search_path = '' as $$
  select p_url ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:443)?(/[^\s]*)?$'
     and substring(p_url from '^https://([^/:]+)') !~ '(^localhost$|\.local$|\.internal$|\.localhost$|^[0-9.]+$)';
$$;

create or replace function public.add_site_by_url(p_url text, p_name text default null, p_org uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_site public.sites; v_url text := lower(trim(p_url)); v_name text;
begin
  if (select auth.uid()) is null then raise exception 'sign in first'; end if;
  v_org := coalesce(p_org, (select m.org_id from public.org_members m where m.user_id = (select auth.uid()) order by m.created_at limit 1));
  if v_org is null or not private.is_member(v_org) then raise exception 'not a member of that org'; end if;
  if v_url !~ '/$' and v_url !~ '^https://[^/]+/.+' then v_url := v_url || '/'; end if;
  if not private.public_host(v_url) then raise exception 'use the public https:// address of the website'; end if;
  if (select count(*) from public.sites where org_id = v_org and mode = 'url') >= 50 then raise exception 'this workspace already has 50 websites connected by address'; end if;
  if exists (select 1 from public.sites where org_id = v_org and url = v_url) then raise exception 'that website is already in this workspace'; end if;
  v_name := coalesce(nullif(trim(coalesce(p_name, '')), ''), regexp_replace(substring(v_url from '^https://([^/:]+)'), '^www\.', ''));
  insert into public.sites (org_id, name, url, mode, status, next_scan_at, scan_state)
    values (v_org, left(v_name, 120), v_url, 'url', 'scanning', now(), 'queued') returning * into v_site;
  perform private.kick_scan();
  return to_jsonb(v_site);
end;
$$;

-- Ask for a fresh scan of a site connected by address. At most one every 30 minutes.
create or replace function public.scan_now(p_site uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.sites;
begin
  select * into v from public.sites where id = p_site;
  if v.id is null or not private.is_member(v.org_id) then raise exception 'not found'; end if;
  if v.mode <> 'url' then raise exception 'this website reports from its own repository; run its seo-daily workflow instead'; end if;
  if v.scan_state in ('queued', 'running') and coalesce(v.scan_started_at, now()) > now() - interval '15 minutes' then return jsonb_build_object('ok', true, 'state', v.scan_state); end if;
  if v.last_snapshot_at > now() - interval '30 minutes' then raise exception 'scanned less than 30 minutes ago'; end if;
  update public.sites set next_scan_at = now(), scan_state = 'queued', scan_error = null where id = p_site;
  perform private.kick_scan();
  return jsonb_build_object('ok', true, 'state', 'queued');
end;
$$;

-- For the scan function (service role): the shared secret check, claiming the next due site, and storing the result.
create or replace function public.scan_secret_ok(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'scan_secret' and decrypted_secret = p_secret);
$$;

create or replace function public.claim_scan()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.sites;
begin
  update public.sites s set scan_state = 'running', scan_started_at = now()
  where s.id = (select x.id from public.sites x
                where x.mode = 'url' and x.status <> 'paused' and x.next_scan_at <= now()
                  and (x.scan_state is distinct from 'running' or x.scan_started_at < now() - interval '15 minutes')
                order by x.next_scan_at limit 1 for update skip locked)
  returning s.* into v;
  return case when v.id is null then null else jsonb_build_object('id', v.id, 'name', v.name, 'url', v.url) end;
end;
$$;

create or replace function public.finish_scan(p_site uuid, p_data jsonb default null, p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz := now();
begin
  if p_error is not null or p_data is null or jsonb_typeof(p_data) <> 'object' then
    update public.sites set scan_state = 'failed', scan_error = left(coalesce(p_error, 'no data'), 300), next_scan_at = v_at + interval '6 hours' where id = p_site;
    return jsonb_build_object('ok', false);
  end if;
  if pg_column_size(p_data) > 4 * 1024 * 1024 then
    update public.sites set scan_state = 'failed', scan_error = 'snapshot larger than 4 MB', next_scan_at = v_at + interval '1 day' where id = p_site;
    return jsonb_build_object('ok', false);
  end if;
  insert into public.site_snapshots (site_id, taken_at, data) values (p_site, v_at, p_data);
  update public.sites set status = case when status = 'paused' then status else 'live' end, last_snapshot_at = v_at,
    scan_state = 'done', scan_error = null, next_scan_at = v_at + interval '1 day' where id = p_site;
  delete from public.site_snapshots where site_id = p_site and id not in (select id from public.site_snapshots where site_id = p_site order by taken_at desc limit 120);
  return jsonb_build_object('ok', true, 'at', v_at);
end;
$$;

revoke all on function private.kick_scan(), public.add_site_by_url(text, text, uuid), public.scan_now(uuid), public.scan_secret_ok(text),
  public.claim_scan(), public.finish_scan(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.add_site_by_url(text, text, uuid), public.scan_now(uuid) to authenticated;
grant execute on function public.scan_secret_ok(text), public.claim_scan(), public.finish_scan(uuid, jsonb, text) to service_role;

-- Every 10 minutes: the function scans whatever is due (sites are due once a day).
select cron.schedule('seo-autopilot-scan', '*/10 * * * *', 'select private.kick_scan()');
