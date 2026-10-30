-- Portal, second step: approve or decline proposals from the portal, invite colleagues, agency branding on client pages,
-- and growth over time. Decisions are only recorded here; the website's own daily run applies them on GitHub (the label
-- "approved", "seo-hold", or closing the issue) and reports back, so the portal never holds GitHub access.

-- Decisions on proposal issues ------------------------------------------------------------------------------------------

create table public.decisions (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites (id) on delete cascade,
  issue integer not null check (issue > 0),
  decision text not null check (decision in ('approve', 'hold', 'decline')),
  note text check (note is null or length(note) <= 500),
  decided_by uuid references auth.users (id) on delete set null,
  decided_email text,
  decided_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (site_id, issue)
);
create index decisions_pending_idx on public.decisions (site_id) where applied_at is null;
alter table public.decisions enable row level security;
create policy decisions_select on public.decisions for select to authenticated using ((select private.is_member(private.site_org(site_id))));
revoke all on public.decisions from anon, authenticated;
grant select on public.decisions to authenticated;

-- Record (or change, until it is applied) a decision on one proposal issue.
create or replace function public.decide_proposal(p_site uuid, p_issue integer, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.decisions;
begin
  if not private.is_member(private.site_org(p_site)) then raise exception 'not allowed'; end if;
  if p_decision not in ('approve', 'hold', 'decline') then raise exception 'decision must be approve, hold or decline'; end if;
  insert into public.decisions (site_id, issue, decision, note, decided_by, decided_email)
    values (p_site, p_issue, p_decision, nullif(trim(coalesce(p_note, '')), ''), (select auth.uid()), (select auth.jwt() ->> 'email'))
    on conflict (site_id, issue) do update set decision = excluded.decision, note = excluded.note, decided_by = excluded.decided_by,
      decided_email = excluded.decided_email, decided_at = now(), applied_at = null
    returning * into v;
  return to_jsonb(v);
end;
$$;

-- Pending decisions for the site that owns the token, and acknowledgement of the ones its run applied. Service role only
-- (called by the ingest Edge Function together with the snapshot).
create or replace function public.sync_decisions(p_token text, p_applied bigint[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_site uuid;
begin
  select t.site_id into v_site from private.ingest_tokens t where t.token_hash = private.hash_token(p_token);
  if v_site is null then return jsonb_build_object('error', 'unknown token'); end if;
  update public.decisions set applied_at = now() where site_id = v_site and id = any (coalesce(p_applied, '{}')) and applied_at is null;
  return jsonb_build_object('decisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'issue', d.issue, 'decision', d.decision, 'note', d.note, 'by', d.decided_email) order by d.decided_at)
    from public.decisions d where d.site_id = v_site and d.applied_at is null), '[]'::jsonb));
end;
$$;

-- Team invitations --------------------------------------------------------------------------------------------------------

create table public.invites (
  org_id uuid not null references public.orgs (id) on delete cascade,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null default 'member' check (role in ('owner', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (org_id, email)
);
alter table public.invites enable row level security;
create policy invites_select on public.invites for select to authenticated using ((select private.is_member(org_id)));
revoke all on public.invites from anon, authenticated;
grant select on public.invites to authenticated;

create or replace function public.invite_member(p_email text, p_role text default 'member', p_org uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_email text := lower(trim(p_email));
begin
  v_org := coalesce(p_org, (select m.org_id from public.org_members m where m.user_id = (select auth.uid()) and m.role = 'owner' order by m.created_at limit 1));
  if v_org is null or not private.is_owner(v_org) then raise exception 'only an owner can invite'; end if;
  insert into public.invites (org_id, email, role, invited_by) values (v_org, v_email, coalesce(p_role, 'member'), (select auth.uid()))
    on conflict (org_id, email) do update set role = excluded.role, invited_by = excluded.invited_by, created_at = now(), accepted_at = null;
  -- Someone who already has an account joins straight away.
  insert into public.org_members (org_id, user_id, role) select v_org, u.id, coalesce(p_role, 'member') from auth.users u where lower(u.email) = v_email
    on conflict (org_id, user_id) do nothing;
  update public.invites set accepted_at = now() where org_id = v_org and email = v_email and exists (select 1 from auth.users u where lower(u.email) = v_email);
  return jsonb_build_object('org', v_org, 'email', v_email);
end;
$$;

-- People in the caller's orgs, with their email (auth.users is not readable through the API).
create or replace function public.org_people()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('org', m.org_id, 'email', u.email, 'role', m.role, 'since', m.created_at) order by m.created_at), '[]'::jsonb)
  from public.org_members m join auth.users u on u.id = m.user_id
  where private.is_member(m.org_id);
$$;

-- New accounts accept their pending invitations.
create or replace function private.accept_invites()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.org_members (org_id, user_id, role) select i.org_id, new.id, i.role from public.invites i where i.email = lower(new.email) and i.accepted_at is null
    on conflict (org_id, user_id) do nothing;
  update public.invites set accepted_at = now() where email = lower(new.email) and accepted_at is null;
  return new;
end;
$$;
create trigger on_auth_user_accept_invites after insert on auth.users for each row execute function private.accept_invites();

-- Agency branding ---------------------------------------------------------------------------------------------------------

alter table public.orgs add column brand_name text check (brand_name is null or length(brand_name) between 1 and 80),
  add column brand_color text check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$');
grant update (name, brand_name, brand_color) on public.orgs to authenticated;
revoke update on public.orgs from authenticated;
grant update (name, brand_name, brand_color) on public.orgs to authenticated;

-- Growth over time ------------------------------------------------------------------------------------------------------

-- One row per stored snapshot: search totals, keywords, pages and their average score, pages in Google.
create or replace function private.growth(p_site uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(r order by r ->> 'at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'at', x.taken_at,
      'clicks', (x.data -> 'period' -> 'cur' ->> 'clicks')::numeric,
      'impressions', (x.data -> 'period' -> 'cur' ->> 'impressions')::numeric,
      'position', (x.data -> 'period' -> 'cur' ->> 'position')::numeric,
      'keywords', jsonb_array_length(coalesce(x.data -> 'keywords', '[]')),
      'pages', jsonb_array_length(coalesce(x.data -> 'pages', '[]')),
      'score', (select round(avg((p ->> 'score')::numeric), 1) from jsonb_array_elements(coalesce(x.data -> 'pages', '[]')) p),
      'indexed', (select count(*) from jsonb_array_elements(coalesce(x.data -> 'pages', '[]')) p where p ->> 'indexed' ~* '^(submitted and indexed|indexed, not submitted in sitemap)$')
    ) as r
    from public.site_snapshots x where x.site_id = p_site order by x.taken_at desc limit 120
  ) t;
$$;
grant execute on function private.growth(uuid) to authenticated;

-- What a client link shows now carries the agency's brand.
create or replace function public.shared_site(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('site', jsonb_build_object('name', s.name, 'url', s.url, 'status', s.status, 'last_snapshot_at', s.last_snapshot_at),
    'brand', jsonb_build_object('name', coalesce(o.brand_name, o.name), 'color', o.brand_color),
    'data', (select x.data from public.site_snapshots x where x.site_id = s.id order by x.taken_at desc limit 1),
    'growth', private.growth(s.id))
  from public.share_links l join public.sites s on s.id = l.site_id join public.orgs o on o.id = s.org_id
  where l.token = p_token and l.revoked_at is null;
$$;

create or replace function public.site_growth(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(private.site_org(p_site)) then raise exception 'not allowed'; end if;
  return private.growth(p_site);
end;
$$;

-- The agency view also returns the brand and each site's pending decisions.
create or replace function public.my_sites()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('site', to_jsonb(s), 'data',
    (select x.data from public.site_snapshots x where x.site_id = s.id order by x.taken_at desc limit 1),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('issue', d.issue, 'decision', d.decision, 'applied_at', d.applied_at, 'by', d.decided_email)) from public.decisions d where d.site_id = s.id), '[]'::jsonb)
  ) order by s.created_at), '[]'::jsonb)
  from public.sites s;
$$;

create or replace function public.my_org()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select to_jsonb(o) || jsonb_build_object('role', m.role)
  from public.org_members m join public.orgs o on o.id = m.org_id
  where m.user_id = (select auth.uid()) order by (m.role = 'owner') desc, m.created_at limit 1;
$$;

revoke all on function public.decide_proposal(uuid, integer, text, text), public.sync_decisions(text, bigint[]), public.invite_member(text, text, uuid),
  public.org_people(), public.site_growth(uuid), public.my_org(), public.my_sites(), public.shared_site(text) from public, anon, authenticated;
grant execute on function public.decide_proposal(uuid, integer, text, text), public.invite_member(text, text, uuid), public.org_people(),
  public.site_growth(uuid), public.my_org(), public.my_sites() to authenticated;
grant execute on function public.shared_site(text) to anon, authenticated;
grant execute on function public.sync_decisions(text, bigint[]) to service_role;
revoke all on function private.accept_invites() from public, anon, authenticated;
