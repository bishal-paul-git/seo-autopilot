-- Email through Supabase's own SMTP (decision D40).
-- Invitations: the notify Edge Function asks Supabase Auth to invite each new invitee, so the email goes out through the
-- project's Auth SMTP and template (Dashboard -> Authentication -> SMTP / Email templates). The invite-only gate (D36)
-- lets the account be created because the invite is pending; existing triggers then join the agency or the client.
-- Daily summaries: the same function sends one email per person with notifications they have not seen, through the
-- SMTP server whose details are kept as Edge Function secrets (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM).
-- People can turn the summary off. Nothing here sends anything by itself: the Cloudflare scheduler calls the function.

alter table public.invites add column if not exists emailed_at timestamptz;
alter table public.client_invites add column if not exists emailed_at timestamptz;

create table public.email_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  daily_summary boolean not null default true,
  last_summary_at timestamptz
);
alter table public.email_prefs enable row level security; -- no policies: only the functions below use it
revoke all on public.email_prefs from public, anon, authenticated;

-- Each person decides whether they get the daily summary.
create or replace function public.set_email_summary(p_on boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not allowed'; end if;
  if p_on is null then raise exception 'choose on or off'; end if;
  insert into public.email_prefs (user_id, daily_summary) values ((select auth.uid()), p_on)
    on conflict (user_id) do update set daily_summary = excluded.daily_summary;
  return p_on;
end $$;

create or replace function public.my_email_summary()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select daily_summary from public.email_prefs where user_id = (select auth.uid())), true);
$$;

-- The service's work list: invitations not yet emailed (last 7 days, still pending, no account yet) and people due a
-- summary (unseen items since they last looked or were last emailed, at most one email a day, summary switched on).
create or replace function public.email_queue(p_limit int default 50)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'invites', coalesce((select jsonb_agg(x) from (
        select 'agency' kind, i.org_id::text || ':' || i.email id, i.email, coalesce(o.brand_name, o.name) agency, i.created_at from public.invites i join public.orgs o on o.id = i.org_id
         where i.accepted_at is null and i.emailed_at is null and i.created_at > now() - interval '7 days' and not exists (select 1 from auth.users u where lower(u.email) = i.email)
        union all
        select 'client', ci.id::text, ci.email, coalesce(o.brand_name, o.name), ci.created_at from public.client_invites ci join public.clients c on c.id = ci.client_id join public.orgs o on o.id = c.org_id
         where ci.accepted_at is null and ci.emailed_at is null and ci.created_at > now() - interval '7 days' and not exists (select 1 from auth.users u where lower(u.email) = ci.email)
        order by 5 limit greatest(least(coalesce(p_limit, 50), 200), 1)) x), '[]'::jsonb),
    'summaries', coalesce((select jsonb_agg(y) from (
        select u.id user_id, u.email, (select jsonb_agg(jsonb_build_object('kind', n.kind, 'siteName', n.site_name, 'title', left(n.title, 300), 'at', n.at, 'site', n.site, 'page', n.page) order by n.at desc)
                 from (select * from private.notifications_for(u.id) f where f.at > greatest(coalesce(ns.seen_at, '-infinity'::timestamptz), coalesce(ep.last_summary_at, '-infinity'::timestamptz)) order by f.at desc limit 20) n) items
          from auth.users u left join public.notification_seen ns on ns.user_id = u.id left join public.email_prefs ep on ep.user_id = u.id
         where u.email is not null and coalesce(ep.daily_summary, true) and coalesce(ep.last_summary_at, '-infinity'::timestamptz) < now() - interval '20 hours'
           and exists (select 1 from private.notifications_for(u.id) f where f.at > greatest(coalesce(ns.seen_at, '-infinity'::timestamptz), coalesce(ep.last_summary_at, '-infinity'::timestamptz)))
         limit greatest(least(coalesce(p_limit, 50), 200), 1)) y), '[]'::jsonb));
$$;

-- The service records what it sent, so nothing is emailed twice.
create or replace function public.email_sent(p_kind text, p_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_kind = 'agency' then update public.invites set emailed_at = now() where org_id = split_part(p_id, ':', 1)::uuid and email = substr(p_id, position(':' in p_id) + 1);
  elsif p_kind = 'client' then update public.client_invites set emailed_at = now() where id = p_id::bigint;
  elsif p_kind = 'summary' then insert into public.email_prefs (user_id, last_summary_at) values (p_id::uuid, now())
    on conflict (user_id) do update set last_summary_at = excluded.last_summary_at;
  else raise exception 'unknown kind'; end if;
end $$;

-- The Worker reads the shared scan secret from Vault instead of holding a copy (service role only).
create or replace function public.scan_secret()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'scan_secret';
$$;

revoke all on function public.set_email_summary(boolean), public.my_email_summary(), public.email_queue(int), public.email_sent(text, text), public.scan_secret() from public, anon, authenticated;
grant execute on function public.set_email_summary(boolean), public.my_email_summary() to authenticated;
grant execute on function public.email_queue(int), public.email_sent(text, text), public.scan_secret() to service_role;
