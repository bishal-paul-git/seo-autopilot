-- Invite requests from the public landing page (decision D59). The hosted service stays invite-only (D36,
-- 20261108100000_invite_only.sql); visitors can now ask for an invite, and a platform admin decides.
--
-- 1. public.invite_requests: one row per email address. RLS on and no policies, and no grants to the API roles: nobody
--    reads or writes it except through the functions below.
-- 2. public.request_invite(...): callable by anon. Checks and trims every field (length limits, a plain email shape, a
--    fixed list for the number of websites). Abuse limits: a honeypot field (filled in = silently dropped), one row per
--    email (a repeat only counts up `repeats`, it never changes what was sent or reopens a decision), and at most
--    20 new requests an hour across the whole service (serialised with an advisory lock). The answer is the same
--    whether the email was new, already there, already a user or dropped by the honeypot, so it reveals nothing.
-- 3. public.invite_requests_list() and public.decide_invite_request(id, decision): platform admins only
--    (private.is_platform_admin). "invited" lets that email create an account: private.gate_signup now also accepts an
--    email whose request is invited. The new account then gets its own agency through private.on_new_user, exactly as
--    before invite-only; no agency invite (public.invites) is involved, because those join an existing agency.
-- 4. Platform admins get a notification (kind 'invite_request', D38) for each new request; private.notifications_for is
--    redefined with that one extra branch, everything else unchanged from 20261119000000_daily_digest.sql.
-- Nothing here sends email. The admin copies the address and the sign-up link from Operations.

create table if not exists public.invite_requests (
  id bigint generated always as identity primary key,
  name text not null check (length(name) between 1 and 100),
  email text not null unique check (length(email) between 3 and 254 and email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  company text not null check (length(company) between 1 and 200),
  sites text not null check (sites in ('1', '2-5', '6-20', '21-100', '100+')),
  note text check (note is null or length(note) <= 1000),
  status text not null default 'new' check (status in ('new', 'invited', 'declined')),
  repeats int not null default 0,
  created_at timestamptz not null default now(),
  last_requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null
);
create index if not exists invite_requests_created on public.invite_requests (created_at desc);
alter table public.invite_requests enable row level security; -- no policies: only the functions below read or write it
revoke all on public.invite_requests from public, anon, authenticated;
grant all on public.invite_requests to service_role;

create or replace function public.request_invite(p_name text, p_email text, p_company text, p_sites text, p_note text default null, p_trap text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ok constant jsonb := jsonb_build_object('ok', true, 'message', 'Thank you, your request is in. If we can invite you, we will email you at this address.');
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:][:space:]]+', ' ', 'g'));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_company text := btrim(regexp_replace(coalesce(p_company, ''), '[[:cntrl:][:space:]]+', ' ', 'g'));
  v_sites text := btrim(coalesce(p_sites, ''));
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[\x01-\x09\x0b-\x1f\x7f]', '', 'g')), '');
begin
  -- A field people cannot see: only robots fill it. They get the usual answer and nothing is stored.
  if coalesce(btrim(p_trap), '') <> '' then return v_ok; end if;
  if v_name = '' or length(v_name) > 100 then raise exception 'Please give your name (up to 100 characters).' using errcode = '22023'; end if;
  if length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please give a valid email address.' using errcode = '22023'; end if;
  if v_company = '' or length(v_company) > 200 then raise exception 'Please give your company or website (up to 200 characters).' using errcode = '22023'; end if;
  if v_sites not in ('1', '2-5', '6-20', '21-100', '100+') then raise exception 'Please choose how many websites you run.' using errcode = '22023'; end if;
  if length(coalesce(v_note, '')) > 1000 then raise exception 'Please keep the note under 1,000 characters.' using errcode = '22023'; end if;
  -- One writer at a time, so the hourly limit holds under parallel requests.
  perform pg_advisory_xact_lock(hashtext('public.request_invite'));
  if exists (select 1 from public.invite_requests r where r.email = v_email) then
    update public.invite_requests set repeats = repeats + 1, last_requested_at = now() where email = v_email;
    return v_ok;
  end if;
  if (select count(*) from public.invite_requests r where r.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'We have had a lot of requests in the last hour. Please try again later.' using errcode = 'PT429';
  end if;
  insert into public.invite_requests (name, email, company, sites, note) values (v_name, v_email, v_company, v_sites, v_note);
  return v_ok;
end $$;

create or replace function public.invite_requests_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(x order by x.ord, x.at desc) from (
    select case r.status when 'new' then 0 when 'invited' then 1 else 2 end ord, r.created_at at,
      jsonb_build_object('id', r.id, 'name', r.name, 'email', r.email, 'company', r.company, 'sites', r.sites, 'note', r.note, 'status', r.status,
        'repeats', r.repeats, 'createdAt', r.created_at, 'lastRequestedAt', r.last_requested_at, 'decidedAt', r.decided_at,
        'decidedBy', (select u.email from auth.users u where u.id = r.decided_by),
        'hasAccount', exists (select 1 from auth.users u where lower(u.email) = r.email)) x
      from public.invite_requests r order by r.created_at desc limit 300) x), '[]'::jsonb);
end $$;

create or replace function public.decide_invite_request(p_id bigint, p_decision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.invite_requests;
begin
  if not private.is_platform_admin() then raise exception 'not allowed'; end if;
  if p_decision is null or p_decision not in ('invited', 'declined', 'new') then raise exception 'decision must be invited, declined or new'; end if;
  update public.invite_requests set status = p_decision, decided_at = case when p_decision = 'new' then null else now() end,
    decided_by = case when p_decision = 'new' then null else (select auth.uid()) end
   where id = p_id returning * into r;
  if r.id is null then raise exception 'no such request'; end if;
  return jsonb_build_object('id', r.id, 'email', r.email, 'status', r.status, 'decidedAt', r.decided_at,
    'hasAccount', exists (select 1 from auth.users u where lower(u.email) = r.email));
end $$;

revoke all on function public.request_invite(text, text, text, text, text, text), public.invite_requests_list(), public.decide_invite_request(bigint, text) from public, anon, authenticated;
grant execute on function public.request_invite(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.invite_requests_list(), public.decide_invite_request(bigint, text) to authenticated;

-- The sign-up gate (20261108100000_invite_only.sql) also lets in an email whose invite request was accepted.
create or replace function private.gate_signup() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(coalesce(new.email, '')));
begin
  if not private.invite_only() then return new; end if;
  if v_email <> '' and (exists (select 1 from public.invites i where i.email = v_email and i.accepted_at is null)
      or exists (select 1 from public.client_invites i where i.email = v_email and i.accepted_at is null)
      or exists (select 1 from public.invite_requests r where r.email = v_email and r.status = 'invited')) then
    return new;
  end if;
  raise exception 'sign-up is by invitation only' using errcode = 'P0001';
end $$;
revoke all on function private.gate_signup() from public, anon, authenticated;

-- Notifications (D38): new invite requests for platform admins. Everything else is unchanged from 20261119000000.
create or replace function private.notifications_for(p_uid uuid)
returns table (kind text, site uuid, site_name text, title text, at timestamptz, page text)
language sql stable security definer set search_path = '' as $$
  with mine as (select s.id, s.name from public.sites s join public.org_members om on om.org_id = s.org_id and om.user_id = p_uid)
  select 'approval', j.site_id, m.name, j.title, j.updated_at, 'god' from public.jobs j join mine m on m.id = j.site_id where j.status = 'awaiting_approval'
  union all select 'stuck', j.site_id, m.name, j.title || coalesce(': ' || left(j.error, 120), ''), j.updated_at, 'god' from public.jobs j join mine m on m.id = j.site_id where j.status = 'escalated'
  union all select 'request', x.site_id, m.name, x.title, x.created_at, 'requests' from public.submissions x join mine m on m.id = x.site_id where x.status in ('received', 'needs_clarification')
  union all select case when j.status = 'completed' then 'verified' else 'change_failed' end, j.site_id, m.name, coalesce(j.outputs->'verification'->>'summary', j.title), j.updated_at, 'god'
    from public.jobs j join mine m on m.id = j.site_id where j.kind = 'implement' and j.status in ('completed', 'escalated') and j.updated_at > now() - interval '14 days'
  union all select 'integration', i.site_id, m.name, i.provider || ': ' || coalesce(i.last_error, 'not working'), coalesce(i.last_ok_at, i.created_at), 'god'
    from public.integrations i join mine m on m.id = i.site_id where i.status = 'error'
  union all select 'planning', t.site_id, m.name, 'Planning stopped: ' || left(t.outcome->>'error', 160), t.ticked_at, 'god'
    from public.god_site_ticks t join mine m on m.id = t.site_id where t.outcome->>'error' is not null
  union all select 'digest', null::uuid, coalesce(o.brand_name, o.name), d.digest->>'title', d.created_at, 'ops'
    from public.agency_digests d join public.orgs o on o.id = d.org_id join public.org_members om on om.org_id = d.org_id and om.user_id = p_uid
   where d.attention and d.created_at > now() - interval '3 days'
  union all select 'answer', x.site_id, s.name, x.title || ' · ' || replace(x.status, '_', ' '), x.decided_at, 'requests'
    from public.submissions x join public.sites s on s.id = x.site_id
   where x.submitted_by = p_uid and x.decided_at is not null and x.decided_at > now() - interval '30 days'
     and exists (select 1 from public.client_members cm where cm.client_id = s.client_id and cm.user_id = p_uid)
  union all select 'invite_request', null::uuid, 'SEO Autopilot', 'Invite request: ' || left(r.name, 60) || ' · ' || left(r.company, 60) || ' · ' || r.sites || ' website' || case when r.sites = '1' then '' else 's' end, r.created_at, 'ops'
    from public.invite_requests r
   where r.status = 'new' and r.created_at > now() - interval '30 days' and exists (select 1 from public.platform_admins pa where pa.user_id = p_uid);
$$;
revoke all on function private.notifications_for(uuid) from public, anon, authenticated;
