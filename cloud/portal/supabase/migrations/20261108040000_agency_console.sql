-- Agency console for the SEO God (R1-P2, agency side): what an agency member needs to run a site's SEO God from the
-- portal. Approvals themselves already exist (public.approve_job, agency only). This adds:
--   god_console(site)       one read with the strategy, open questions, work waiting for the agency, escalations,
--                           recent results and costs; agency members of the site's org only.
--   answer_question(...)    an agency member answers an onboarding question; it becomes site memory (basis
--                           "answered") and closes the question.
--   retry_job(job, note)    an agency member sends escalated work back to the queue. The lifecycle still applies:
--                           gated work needs a standing approval before it can be queued.
-- Clients get none of this: they are not members of the agency org (D27), and these functions check membership.
-- Not applied anywhere.

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
    'lastPlanned', (select jsonb_build_object('at', t.ticked_at, 'outcome', t.outcome) from public.god_site_ticks t where t.site_id = p_site));
end;
$$;

create or replace function public.answer_question(p_site uuid, p_key text, p_value text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site); v text := trim(coalesce(p_value, ''));
begin
  if v_org is null or not private.is_member(v_org) then raise exception 'not allowed'; end if;
  if v = '' or length(v) > 2000 then raise exception 'answer must be 1 to 2000 characters'; end if;
  if not exists (select 1 from public.site_memory m where m.site_id = p_site and m.kind = 'question' and m.key = p_key and m.superseded_at is null) then raise exception 'no such question for this site'; end if;
  update public.site_memory set superseded_at = now() where site_id = p_site and kind = 'answer' and key = p_key and superseded_at is null;
  insert into public.site_memory (org_id, site_id, kind, key, value, basis, confidence, source, created_by)
    values (v_org, p_site, 'answer', p_key, jsonb_build_object('value', v), 'answered', 1, 'agency answer', (select auth.uid())::text);
  insert into public.audit_log (org_id, site_id, actor, action, target, data) values (v_org, p_site, (select auth.uid()), 'memory.answer', p_key, null);
  return jsonb_build_object('key', p_key, 'value', v);
end;
$$;

create or replace function public.retry_job(p_job uuid, p_note text default null)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not private.is_member(j.org_id) then raise exception 'not allowed'; end if;
  if j.status <> 'escalated' then raise exception 'only escalated work can be retried'; end if;
  insert into public.audit_log (org_id, site_id, actor, action, target, data) values (j.org_id, j.site_id, (select auth.uid()), 'job.retry', j.id::text, jsonb_build_object('note', p_note));
  update public.jobs set attempts = 0, error = null, not_before = null where id = j.id; -- a person decided to try again: a fresh set of attempts
  return private.move_job(j.id, 'queued', 'user', (select auth.uid())::text, coalesce(nullif(trim(coalesce(p_note, '')), ''), 'retried by the agency'));
end;
$$;

revoke all on function public.god_console(uuid), public.answer_question(uuid, text, text), public.retry_job(uuid, text) from public, anon;
grant execute on function public.god_console(uuid), public.answer_question(uuid, text, text), public.retry_job(uuid, text) to authenticated;
