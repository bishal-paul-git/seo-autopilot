-- Agent pages for the agency (Phase 2 of docs/product/SYSTEM-READINESS-PLAN.md, D46). Read-only: two functions, no new
-- tables, no change to any job. Agency members only (clients never see the SEO team). An agent's instructions, playbooks
-- and skills come from the repository (bundled into the portal at build time); these functions supply what it did here.

-- One line per specialist on this site (30 days): runs, done, waiting, stopped, spend this month, last run, and how its
-- output fared in review (each AI output gets the quality gate; content and high-risk work also the fact-checker, D45).
create or replace function public.site_agent_stats(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site);
begin
  if v_org is null or not private.is_member(v_org) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'lastAt') desc) from (
    select jsonb_build_object(
      'agent', a.agent, 'runs', count(*), 'completed', count(*) filter (where a.status = 'completed'),
      'waiting', count(*) filter (where a.status = 'awaiting_approval'),
      'active', count(*) filter (where a.status in ('scoped', 'queued', 'running', 'awaiting_review', 'authorized', 'deploying', 'verifying')),
      'stopped', count(*) filter (where a.status in ('failed', 'escalated', 'rejected', 'cancelled')),
      'lastAt', max(a.updated_at), 'lastStatus', (array_agg(a.status order by a.updated_at desc))[1],
      'costMonth', coalesce(sum(a.cost_usd) filter (where a.created_at >= date_trunc('month', now())), 0),
      'reviews', (select count(*) from public.reviews r join public.jobs j on j.id = r.job_id where j.site_id = p_site and coalesce(j.agent, substr(j.kind, 7)) = a.agent and j.updated_at > now() - interval '30 days'),
      'reviewsPassed', (select count(*) from public.reviews r join public.jobs j on j.id = r.job_id where j.site_id = p_site and coalesce(j.agent, substr(j.kind, 7)) = a.agent and j.updated_at > now() - interval '30 days' and r.verdict = 'pass')) x
    from (select coalesce(j.agent, substr(j.kind, 7)) agent, j.status, j.updated_at, j.created_at, j.cost_usd
            from public.jobs j where j.site_id = p_site and j.kind like 'agent:%' and j.updated_at > now() - interval '30 days') a
    group by a.agent) t), '[]'::jsonb);
end $$;

-- Every run of one specialist on this site, newest first: what it was asked, what it read, what it said, what it cost,
-- every review verdict and the agency's decision. Agent text is untrusted data: the portal shows it as text only.
create or replace function public.agent_runs(p_site uuid, p_agent text, p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site); v_lim int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if v_org is null or not private.is_member(v_org) then raise exception 'not allowed'; end if;
  if p_agent is null or p_agent !~ '^seo-[a-z0-9-]{1,60}$' then raise exception 'unknown agent'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'createdAt') desc) from (
    select jsonb_build_object(
      'job', j.id, 'title', j.title, 'status', j.status, 'risk', j.risk, 'createdAt', j.created_at, 'updatedAt', j.updated_at,
      'attempts', j.attempts, 'costUsd', j.cost_usd, 'budgetUsd', j.budget_usd,
      'why', left(coalesce(j.inputs->>'instruction', ''), 500),
      'summary', left(coalesce(j.outputs->'proposal'->>'summary', ''), 2000),
      'recommendations', coalesce(jsonb_array_length(case when jsonb_typeof(j.outputs->'proposal'->'recommendations') = 'array' then j.outputs->'proposal'->'recommendations' end), 0),
      'titles', coalesce((select jsonb_agg(left(r->>'title', 200)) from jsonb_array_elements(case when jsonb_typeof(j.outputs->'proposal'->'recommendations') = 'array' then j.outputs->'proposal'->'recommendations' else '[]'::jsonb end) r), '[]'::jsonb),
      'knowledge', case when jsonb_typeof(j.outputs->'proposal'->'knowledge') = 'array' then j.outputs->'proposal'->'knowledge' else '[]'::jsonb end,
      'evidence', case when jsonb_typeof(j.outputs->'evidence') = 'array' then j.outputs->'evidence' else '[]'::jsonb end,
      'reviews', coalesce((select jsonb_agg(jsonb_build_object('reviewer', r.reviewer, 'verdict', r.verdict, 'rationale', left(r.rationale, 1000), 'at', r.created_at) order by r.id)
                  from public.reviews r where r.job_id = j.id), '[]'::jsonb),
      'decision', (select jsonb_build_object('decision', a.decision, 'note', left(a.note, 500), 'at', a.created_at) from public.approvals a where a.job_id = j.id order by a.id desc limit 1),
      'lastNote', (select left(e.note, 300) from public.job_events e where e.job_id = j.id order by e.at desc, e.id desc limit 1)) x
    from public.jobs j
    where j.site_id = p_site and j.kind like 'agent:%' and coalesce(j.agent, substr(j.kind, 7)) = p_agent
    order by j.created_at desc limit v_lim) t), '[]'::jsonb);
end $$;

revoke all on function public.site_agent_stats(uuid), public.agent_runs(uuid, text, int) from public, anon, authenticated;
grant execute on function public.site_agent_stats(uuid), public.agent_runs(uuid, text, int) to authenticated;
