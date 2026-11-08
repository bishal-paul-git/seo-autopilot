-- Notifications and the monthly work report (decision D38).
-- Notifications are derived live from what is waiting, so they can never disagree with the work itself; the only state
-- kept is when each person last looked. No email provider is involved (REVIEW-QUESTIONS Q7 is still open): the portal
-- shows them. The work report tells an agency and its client what was done for one website in one month, without
-- internal details (no costs, agents, prompts, reviews or private analysis).

create table public.notification_seen (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table public.notification_seen enable row level security; -- no policies: only the functions below use it
revoke all on public.notification_seen from public, anon, authenticated;

create or replace function public.my_notifications()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_seen timestamptz;
begin
  if v_uid is null then raise exception 'not allowed'; end if;
  select n.seen_at into v_seen from public.notification_seen n where n.user_id = v_uid;
  return (
    with mine as (select s.id, s.name, s.org_id from public.sites s where private.is_member(s.org_id)),
    items as (
      -- Agency: decisions waiting, work that needs a person, client requests, changes verified or stopped, broken integrations, planning errors.
      select 'approval' kind, j.site_id site, m.name site_name, j.title, j.updated_at at, 'god' page from public.jobs j join mine m on m.id = j.site_id where j.status = 'awaiting_approval'
      union all select 'stuck', j.site_id, m.name, j.title || coalesce(': ' || left(j.error, 120), ''), j.updated_at, 'god' from public.jobs j join mine m on m.id = j.site_id where j.status = 'escalated'
      union all select 'request', x.site_id, m.name, x.title, x.created_at, 'requests' from public.submissions x join mine m on m.id = x.site_id where x.status in ('received', 'needs_clarification')
      union all select case when j.status = 'completed' then 'verified' else 'change_failed' end, j.site_id, m.name, coalesce(j.outputs->'verification'->>'summary', j.title), j.updated_at, 'god'
        from public.jobs j join mine m on m.id = j.site_id where j.kind = 'implement' and j.status in ('completed', 'escalated') and j.updated_at > now() - interval '14 days'
      union all select 'integration', i.site_id, m.name, i.provider || ': ' || coalesce(i.last_error, 'not working'), coalesce(i.last_ok_at, i.created_at), 'god'
        from public.integrations i join mine m on m.id = i.site_id where i.status = 'error'
      union all select 'planning', t.site_id, m.name, 'Planning stopped: ' || left(t.outcome->>'error', 160), t.ticked_at, 'god'
        from public.god_site_ticks t join mine m on m.id = t.site_id where t.outcome->>'error' is not null
      -- Clients: the agency answered one of their requests.
      union all select 'answer', x.site_id, s.name, x.title || ' · ' || replace(x.status, '_', ' '), x.decided_at, 'requests'
        from public.submissions x join public.sites s on s.id = x.site_id
       where x.submitted_by = v_uid and x.decided_at is not null and x.decided_at > now() - interval '30 days' and private.is_client_viewer(x.site_id)
    )
    select jsonb_build_object('seenAt', v_seen,
      'unread', (select count(*) from items where at > coalesce(v_seen, '-infinity'::timestamptz)),
      'items', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'site', site, 'siteName', site_name, 'title', left(title, 300), 'at', at, 'page', page,
                 'unread', at > coalesce(v_seen, '-infinity'::timestamptz)) order by at desc) from (select * from items order by at desc limit 50) t), '[]'::jsonb)));
end $$;

create or replace function public.mark_notifications_seen()
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_at timestamptz := now();
begin
  if v_uid is null then raise exception 'not allowed'; end if;
  insert into public.notification_seen (user_id, seen_at) values (v_uid, v_at) on conflict (user_id) do update set seen_at = excluded.seen_at;
  return v_at;
end $$;

-- What was done for one website in one month: for the agency and for that website's client accounts. Only outcomes:
-- advice accepted, changes merged and verified, client requests answered, and the audit at the start and end of the month.
create or replace function public.site_work_report(p_site uuid, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := date_trunc('month', coalesce(p_month, now()::date)::timestamptz); v_to timestamptz;
begin
  if not (private.is_member(private.site_org(p_site)) or private.is_client_viewer(p_site)) then raise exception 'not allowed'; end if;
  v_to := v_from + interval '1 month';
  return jsonb_build_object(
    'site', (select jsonb_build_object('name', s.name, 'url', s.url) from public.sites s where s.id = p_site),
    'brand', (select jsonb_build_object('name', coalesce(o.brand_name, o.name), 'color', o.brand_color) from public.sites s join public.orgs o on o.id = s.org_id where s.id = p_site),
    'month', to_char(v_from, 'YYYY-MM'),
    'strategy', (select jsonb_build_object('approved', m.value->>'status' = 'approved', 'objective', m.value->>'objective', 'since', m.created_at)
                   from public.site_memory m where m.site_id = p_site and m.kind = 'strategy' and m.key = 'initial' and m.superseded_at is null limit 1),
    'advice', coalesce((select jsonb_agg(jsonb_build_object('title', j.title, 'at', j.updated_at,
                  'recommendations', (select coalesce(jsonb_agg(jsonb_build_object('title', r->>'title', 'url', r->>'url')), '[]'::jsonb) from jsonb_array_elements(coalesce(j.outputs->'proposal'->'recommendations', '[]'::jsonb)) r))
                  order by j.updated_at)
                from public.jobs j where j.site_id = p_site and j.status = 'completed' and j.kind like 'agent:%' and j.updated_at >= v_from and j.updated_at < v_to), '[]'::jsonb),
    'changes', coalesce((select jsonb_agg(jsonb_build_object('title', j.title, 'status', j.status, 'page', j.outputs->'deploy'->>'url', 'mergedAt', j.outputs->'deploy'->>'mergedAt',
                  'verification', j.outputs->'verification'->>'summary') order by j.updated_at)
                from public.jobs j where j.site_id = p_site and j.kind = 'implement' and j.status in ('completed', 'verifying', 'deploying', 'escalated') and j.updated_at >= v_from and j.updated_at < v_to), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('title', x.title, 'status', x.status, 'note', x.agency_note, 'at', x.decided_at) order by x.decided_at)
                from public.submissions x where x.site_id = p_site and x.decided_at >= v_from and x.decided_at < v_to), '[]'::jsonb),
    'audit', (select jsonb_build_object('generatedAt', m.value->>'generatedAt', 'pages', m.value->'summary'->'pagesCrawled', 'bySeverity', m.value->'summary'->'bySeverity')
                from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'audit' and m.created_at < v_to order by m.created_at desc limit 1),
    'auditBefore', (select jsonb_build_object('generatedAt', m.value->>'generatedAt', 'pages', m.value->'summary'->'pagesCrawled', 'bySeverity', m.value->'summary'->'bySeverity')
                from public.site_memory m where m.site_id = p_site and m.kind = 'report' and m.key = 'audit' and m.created_at < v_from order by m.created_at desc limit 1));
end $$;

revoke all on function public.my_notifications(), public.mark_notifications_seen(), public.site_work_report(uuid, date) from public, anon, authenticated;
grant execute on function public.my_notifications(), public.mark_notifications_seen(), public.site_work_report(uuid, date) to authenticated;
