-- SEO Autopilot client portal: agencies (orgs), their people, their websites, the daily snapshots each website sends,
-- and share links that let a client see one website without an account.
-- Access: people see only their own orgs' rows (RLS). Snapshots arrive only through ingest_snapshot (called by the ingest
-- Edge Function with the service role); a client link reads one website through shared_site. Site tokens are stored hashed
-- in the private schema, which the API does not expose.

create schema if not exists private;

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_id_idx on public.org_members (user_id);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  url text not null check (url ~ '^https://[^\s]+$'),
  repo text check (repo is null or repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  status text not null default 'connecting' check (status in ('connecting', 'live', 'paused')),
  last_snapshot_at timestamptz,
  created_at timestamptz not null default now()
);
create index sites_org_id_idx on public.sites (org_id);

create table public.site_snapshots (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites (id) on delete cascade,
  taken_at timestamptz not null default now(),
  data jsonb not null
);
create index site_snapshots_site_taken_idx on public.site_snapshots (site_id, taken_at desc);

create table public.share_links (
  token text primary key check (length(token) >= 3),
  site_id uuid not null references public.sites (id) on delete cascade,
  label text check (label is null or length(label) <= 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index share_links_site_id_idx on public.share_links (site_id);

create table private.ingest_tokens (
  site_id uuid primary key references public.sites (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- Helpers ---------------------------------------------------------------------------------------------------------------

create or replace function private.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = (select auth.uid()));
$$;

create or replace function private.is_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role = 'owner');
$$;

create or replace function private.site_org(p_site uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select s.org_id from public.sites s where s.id = p_site;
$$;

create or replace function private.new_token(p_prefix text)
returns text language sql volatile set search_path = '' as $$
  select p_prefix || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

create or replace function private.hash_token(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function private.is_member(uuid), private.is_owner(uuid), private.site_org(uuid) to authenticated;

-- Every new account gets its own org (its agency), so a stranger who signs up sees nothing but what they add.
create or replace function private.on_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  insert into public.orgs (name) values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'My agency')) returning id into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org, new.id, 'owner');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.on_new_user();

-- Row level security ----------------------------------------------------------------------------------------------------

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.sites enable row level security;
alter table public.site_snapshots enable row level security;
alter table public.share_links enable row level security;

create policy orgs_select on public.orgs for select to authenticated using ((select private.is_member(id)));
create policy orgs_update on public.orgs for update to authenticated using ((select private.is_owner(id))) with check ((select private.is_owner(id)));

create policy members_select on public.org_members for select to authenticated using ((select private.is_member(org_id)));

create policy sites_select on public.sites for select to authenticated using ((select private.is_member(org_id)));
create policy sites_update on public.sites for update to authenticated using ((select private.is_member(org_id))) with check ((select private.is_member(org_id)));
create policy sites_delete on public.sites for delete to authenticated using ((select private.is_owner(org_id)));

create policy snapshots_select on public.site_snapshots for select to authenticated using ((select private.is_member(private.site_org(site_id))));

create policy share_select on public.share_links for select to authenticated using ((select private.is_member(private.site_org(site_id))));
create policy share_update on public.share_links for update to authenticated using ((select private.is_member(private.site_org(site_id)))) with check ((select private.is_member(private.site_org(site_id))));

revoke all on public.orgs, public.org_members, public.sites, public.site_snapshots, public.share_links from anon, authenticated;
grant select, update on public.orgs to authenticated;
grant select on public.org_members to authenticated;
grant select, update (name, url, repo, status), delete on public.sites to authenticated;
grant select on public.site_snapshots to authenticated;
grant select, update (revoked_at, label) on public.share_links to authenticated;

-- API (RPC) ---------------------------------------------------------------------------------------------------------------

-- Add a website to one of the caller's orgs. Returns the site and its push token, shown once (only the hash is kept).
create or replace function public.create_site(p_name text, p_url text, p_repo text default null, p_org uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_site public.sites; v_token text;
begin
  if (select auth.uid()) is null then raise exception 'sign in first'; end if;
  v_org := coalesce(p_org, (select m.org_id from public.org_members m where m.user_id = (select auth.uid()) order by m.created_at limit 1));
  if v_org is null or not private.is_member(v_org) then raise exception 'not a member of that org'; end if;
  insert into public.sites (org_id, name, url, repo) values (v_org, trim(p_name), trim(p_url), nullif(trim(coalesce(p_repo, '')), '')) returning * into v_site;
  v_token := private.new_token('spt_');
  insert into private.ingest_tokens (site_id, token_hash) values (v_site.id, private.hash_token(v_token));
  return jsonb_build_object('site', to_jsonb(v_site), 'token', v_token);
end;
$$;

-- A new push token for a site; the old one stops working at once.
create or replace function public.rotate_site_token(p_site uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if not private.is_member(private.site_org(p_site)) then raise exception 'not allowed'; end if;
  v_token := private.new_token('spt_');
  insert into private.ingest_tokens (site_id, token_hash) values (p_site, private.hash_token(v_token))
    on conflict (site_id) do update set token_hash = excluded.token_hash, created_at = now(), last_used_at = null;
  return v_token;
end;
$$;

-- A client link for one site (no account needed to open it). Revoke it by setting revoked_at.
create or replace function public.create_share_link(p_site uuid, p_label text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if not private.is_member(private.site_org(p_site)) then raise exception 'not allowed'; end if;
  v_token := substr(private.new_token('c'), 1, 25);
  insert into public.share_links (token, site_id, label, created_by) values (v_token, p_site, p_label, (select auth.uid()));
  return v_token;
end;
$$;

-- What a client link shows: the site's name and its latest snapshot. Nothing else about the org.
create or replace function public.shared_site(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('site', jsonb_build_object('name', s.name, 'url', s.url, 'status', s.status, 'last_snapshot_at', s.last_snapshot_at),
    'data', (select x.data from public.site_snapshots x where x.site_id = s.id order by x.taken_at desc limit 1))
  from public.share_links l join public.sites s on s.id = l.site_id
  where l.token = p_token and l.revoked_at is null;
$$;

-- The agency view: every site the caller can see, with its latest snapshot (RLS applies: security invoker).
create or replace function public.my_sites()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('site', to_jsonb(s), 'data',
    (select x.data from public.site_snapshots x where x.site_id = s.id order by x.taken_at desc limit 1)) order by s.created_at), '[]'::jsonb)
  from public.sites s;
$$;

-- Called by the ingest Edge Function (service role) with the site's token and the snapshot. Keeps the last 120.
create or replace function public.ingest_snapshot(p_token text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_site uuid; v_at timestamptz := now();
begin
  select t.site_id into v_site from private.ingest_tokens t where t.token_hash = private.hash_token(p_token);
  if v_site is null then return jsonb_build_object('error', 'unknown token'); end if;
  if jsonb_typeof(p_data) <> 'object' then return jsonb_build_object('error', 'snapshot must be an object'); end if;
  if pg_column_size(p_data) > 4 * 1024 * 1024 then return jsonb_build_object('error', 'snapshot larger than 4 MB'); end if;
  insert into public.site_snapshots (site_id, taken_at, data) values (v_site, v_at, p_data);
  update public.sites set status = 'live', last_snapshot_at = v_at where id = v_site;
  update private.ingest_tokens set last_used_at = v_at where site_id = v_site;
  delete from public.site_snapshots where site_id = v_site and id not in (select id from public.site_snapshots where site_id = v_site order by taken_at desc limit 120);
  return jsonb_build_object('ok', true, 'site', v_site, 'at', v_at);
end;
$$;

revoke all on function public.create_site(text, text, text, uuid), public.rotate_site_token(uuid), public.create_share_link(uuid, text),
  public.shared_site(text), public.my_sites(), public.ingest_snapshot(text, jsonb) from public, anon, authenticated;
grant execute on function public.create_site(text, text, text, uuid), public.rotate_site_token(uuid), public.create_share_link(uuid, text), public.my_sites() to authenticated;
grant execute on function public.shared_site(text) to anon, authenticated;
grant execute on function public.ingest_snapshot(text, jsonb) to service_role;
