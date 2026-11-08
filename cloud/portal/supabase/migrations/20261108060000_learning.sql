-- Learning from results (R1-D1): the agency sees what the SEO God learned. Experiments (accepted advice, re-checked by
-- later scans) and lessons (per agent: how its advice turned out, and the agency's own refusals) are site memory rows
-- written by the scheduler (src/god/learning.mjs). This replaces god_console with the same output plus "lessons" and
-- the 20 most recent "experiments". Agency members only, as before. Not applied anywhere.

create or replace function public.god_console(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site);
begin
  if v_org is null or not private.is_member(v_org) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'strategy', (select m.value from public.site_memory m where m.site_id = p_site and m.kind = 'strategy' and m.key = 'initial' and m.superseded_at is null limit 1),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('key', m.key, 'question', m.value->>'question', 'why', m.value->>'why') order by m.key)
                  from public.site_memory m where m.site_id = p_site and m.kind = 'question' and m.superseded_at is null
                   and not exists (select 1 from public.site_memory a where a.site_id = p_site and a.kind = 'answer' and a.key = m.key and a.superseded_at is null)), '[]'::jsonb),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('key', m.key, 'value', m.value->>'value', 'at', m.created_at) order by m.key)
                  from public.site_memory m where m.site_id = p_site and m.kind = 'answer' and m.superseded_at is null), '[]'::jsonb),
    'facts', (select count(*) from public.site_memory m where m.site_id = p_site and m.kind in ('identity', 'brand') and m.superseded_at is null),
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'kind', j.kind, 'title', j.title, 'risk', j.risk, 'priority', j.priority, 'source', j.source,
                    'why', j.objective, 'stage', case when j.attempts > 0 then 'result' else 'start' end, 'outputs', j.outputs, 'costUsd', j.cost_usd, 'budgetUsd', j.budget_usd,
                    'review', (select jsonb_build_object('verdict', r.verdict, 'reviewer', r.reviewer, 'rationale', r.rationale) from public.reviews r where r.job_id = j.id order by r.id desc limit 1),
                    'createdAt', j.created_at) order by j.priority, j.created_at)
                  from public.jobs j where j.site_id = p_site and j.status = 'awaiting_approval'), '[]'::jsonb),
    'escalated', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'kind', j.kind, 'title', j.title, 'error', j.error, 'attempts', j.attempts, 'updatedAt', j.updated_at) order by j.updated_at desc)
                  from public.jobs j where j.site_id = p_site and j.status = 'escalated'), '[]'::jsonb),
    'active', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'kind', j.kind, 'title', j.title, 'status', j.status) order by j.priority, j.created_at)
                  from public.jobs j where j.site_id = p_site and j.status in ('scoped', 'queued', 'running', 'awaiting_review', 'authorized', 'deploying', 'verifying')), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by x->>'updatedAt' desc) from (
                  select jsonb_build_object('id', j.id, 'kind', j.kind, 'title', j.title, 'status', j.status, 'outputs', j.outputs, 'costUsd', j.cost_usd, 'updatedAt', j.updated_at) x
                    from public.jobs j where j.site_id = p_site and j.status in ('completed', 'rejected', 'failed', 'cancelled') order by j.updated_at desc limit 20) t), '[]'::jsonb),
    'costs', jsonb_build_object(
      'today', coalesce((select sum(c.usd) from public.job_costs c where c.site_id = p_site and c.at >= date_trunc('day', now())), 0),
      'month', coalesce((select sum(c.usd) from public.job_costs c where c.site_id = p_site and c.at >= date_trunc('month', now())), 0)),
    'lastPlanned', (select jsonb_build_object('at', t.ticked_at, 'outcome', t.outcome) from public.god_site_ticks t where t.site_id = p_site),
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('key', m.key, 'text', m.value->>'text', 'confidence', m.confidence, 'at', m.created_at) order by m.key)
                  from public.site_memory m where m.site_id = p_site and m.kind = 'lesson' and m.superseded_at is null), '[]'::jsonb),
    'experiments', coalesce((select jsonb_agg(jsonb_build_object('agent', m.value->>'agent', 'status', m.value->>'status', 'openedAt', m.value->>'openedAt',
                    'lastCheckedAt', m.value->>'lastCheckedAt', 'items', m.value->'items') order by m.value->>'openedAt' desc)
                  from (select * from public.site_memory x where x.site_id = p_site and x.kind = 'experiment' and x.superseded_at is null order by x.created_at desc limit 20) m), '[]'::jsonb));
end;
$$;
