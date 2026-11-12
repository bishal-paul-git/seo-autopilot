-- Live activity for the agency (D42): what the scheduler and every agent are doing on one site, step by step, and what
-- is holding them back. Read-only: one function, no new tables, no change to any job. Agency members only (clients never
-- see the SEO God). The scheduler heartbeat is platform-wide but only its times, pause state and error COUNT are shown:
-- the Worker's error strings can name other agencies' sites.
create or replace function public.site_activity(p_site uuid, p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site); v_lim int := least(greatest(coalesce(p_limit, 60), 1), 200);
begin
  if v_org is null or not private.is_member(v_org) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'now', now(),
    'site', (select jsonb_build_object('status', s.status) from public.sites s where s.id = p_site),
    'scheduler', jsonb_build_object(
      'paused', public.god_paused(),
      'lastRunAt', (select max(r.started_at) from public.god_runs r),
      'runsLastHour', (select count(*) from public.god_runs r where r.started_at > now() - interval '1 hour'),
      'runsWithErrorsOfLast4', (select count(*) from (select r.errors from public.god_runs r order by r.id desc limit 4) x where jsonb_array_length(x.errors) > 0),
      'lastRunPaused', (select r.paused from public.god_runs r order by r.id desc limit 1),
      'lastPlannedAt', (select t.ticked_at from public.god_site_ticks t where t.site_id = p_site)),
    -- Every status change of every job on this site, newest first: who (agent, reviewer, worker or person) did what.
    'events', coalesce((select jsonb_agg(x order by (x->>'at') desc) from (
        select jsonb_build_object('at', e.at, 'actorKind', e.actor_kind,
                 'actor', case when e.actor_kind = 'user' then coalesce((select u.email from auth.users u join public.org_members m on m.user_id = u.id and m.org_id = v_org where u.id::text = e.actor), 'a person') else e.actor end,
                 'from', e.from_status, 'to', e.to_status, 'note', left(e.note, 300),
                 'job', j.id, 'kind', j.kind, 'title', j.title, 'agent', j.agent) x
          from public.job_events e join public.jobs j on j.id = e.job_id
         where j.site_id = p_site order by e.at desc, e.id desc limit v_lim) t), '[]'::jsonb),
    -- Work happening right now (claimed by a worker, under review, or on its way to the website).
    'working', coalesce((select jsonb_agg(jsonb_build_object('job', j.id, 'kind', j.kind, 'title', j.title, 'agent', j.agent, 'status', j.status,
                   'since', j.updated_at, 'attempts', j.attempts, 'leaseUntil', j.lease_until) order by j.updated_at)
        from public.jobs j where j.site_id = p_site and j.status in ('queued', 'running', 'awaiting_review', 'authorized', 'deploying', 'verifying')), '[]'::jsonb),
    -- One line per worker of the organisation: the director's own work by kind, each specialist by name.
    'workers', coalesce((select jsonb_agg(w order by (w->>'lastAt') desc) from (
        select jsonb_build_object('who', coalesce(j.agent, j.kind), 'isAgent', j.agent is not null or j.kind like 'agent:%',
                 'lastAt', max(j.updated_at), 'runs', count(*), 'completed', count(*) filter (where j.status = 'completed'),
                 'costUsd', sum(j.cost_usd),
                 'lastStatus', (array_agg(j.status order by j.updated_at desc))[1], 'lastTitle', (array_agg(j.title order by j.updated_at desc))[1]) w
          from public.jobs j where j.site_id = p_site and j.updated_at > now() - interval '30 days' group by coalesce(j.agent, j.kind), (j.agent is not null or j.kind like 'agent:%')) t), '[]'::jsonb),
    -- Facts the portal turns into "what is holding the team back". Counts only.
    'gates', jsonb_build_object(
      'strategyApproved', exists (select 1 from public.site_memory m where m.site_id = p_site and m.kind = 'strategy' and m.key = 'initial' and m.superseded_at is null and m.value->>'status' = 'approved'),
      'waitingForYou', (select count(*) from public.jobs j where j.site_id = p_site and j.status = 'awaiting_approval'),
      'openQuestions', (select count(*) from public.site_memory m where m.site_id = p_site and m.kind = 'question' and m.superseded_at is null
                         and not exists (select 1 from public.site_memory a where a.site_id = p_site and a.kind = 'answer' and a.key = m.key and a.superseded_at is null)),
      'needsAPerson', (select count(*) from public.jobs j where j.site_id = p_site and j.status = 'escalated'),
      'githubConnected', exists (select 1 from public.integrations i where i.site_id = p_site and i.provider = 'github' and i.scope = 'write' and i.status = 'connected'),
      'agentRunsEver', (select count(*) from public.jobs j where j.site_id = p_site and (j.agent is not null or j.kind like 'agent:%') and j.attempts > 0),
      'agentCostMonth', coalesce((select sum(c.usd) from public.job_costs c where c.site_id = p_site and c.at >= date_trunc('month', now())), 0)));
end $$;

revoke all on function public.site_activity(uuid, int) from public, anon, authenticated;
grant execute on function public.site_activity(uuid, int) to authenticated;
