-- Invite-only sign-up until public launch (owner decision Q8, 2026-11-08).
-- Turning off sign-ups in Supabase Auth would also stop invited people from creating their account, because both the
-- agency invite (public.invites) and the client invite (public.client_invites) expect the person to sign up with the
-- invited email. So the gate is here instead: a new account is refused unless its email has a pending invite. Existing
-- users and their sign-in are untouched. A platform admin (or the service role) can open sign-up at launch.

create table if not exists private.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table private.platform_settings enable row level security; -- no policies: only the functions below read or write it
revoke all on private.platform_settings from public, anon, authenticated;
insert into private.platform_settings (key, value) values ('invite_only', 'true') on conflict (key) do nothing;

create or replace function private.invite_only() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select value = 'true'::jsonb from private.platform_settings where key = 'invite_only'), true);
$$;

-- Runs before the after-insert triggers that create a workspace or accept invites.
create or replace function private.gate_signup() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(coalesce(new.email, '')));
begin
  if not private.invite_only() then return new; end if;
  if v_email <> '' and (exists (select 1 from public.invites i where i.email = v_email and i.accepted_at is null)
      or exists (select 1 from public.client_invites i where i.email = v_email and i.accepted_at is null)) then
    return new;
  end if;
  raise exception 'sign-up is by invitation only' using errcode = 'P0001';
end $$;
revoke all on function private.gate_signup() from public, anon, authenticated;
revoke all on function private.invite_only() from public, anon, authenticated;

drop trigger if exists on_auth_user_gate_signup on auth.users;
create trigger on_auth_user_gate_signup before insert on auth.users for each row execute function private.gate_signup();

-- Platform admins open or close sign-up; who changed it and when stays on the setting (audit_log is per agency).
create or replace function public.set_invite_only(p_on boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_on is null then raise exception 'invite_only must be true or false'; end if;
  if not (private.is_platform_admin() or (select auth.role()) = 'service_role') then raise exception 'not allowed'; end if;
  insert into private.platform_settings (key, value, updated_at, updated_by) values ('invite_only', to_jsonb(p_on), now(), (select auth.uid()))
    on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return jsonb_build_object('invite_only', p_on);
end $$;
revoke all on function public.set_invite_only(boolean) from public, anon;
grant execute on function public.set_invite_only(boolean) to authenticated, service_role;
