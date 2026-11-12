-- Rollback for everything applied to production after Release 1 (D42 to D50), newest first. Restores the Release 1
-- schema exactly (checked by `node scripts/db-rollback-check.mjs --post`): the new functions are dropped, the
-- per-site budget column is removed, and agency_overview gets its Release 1 definition back. Data in existing tables
-- is untouched, except the per-site budgets (lost) and the audit rows they wrote (kept). Review before running.
-- After running it, redeploy the Worker and the portal from the commit before #58, or they will call missing functions.
begin;
-- D50 budgets and alerts (20261116000000)
drop function if exists public.ops_alerts();
drop function if exists public.god_site_budget(uuid);
drop function if exists public.set_site_budget(uuid, numeric);
alter table public.sites drop column if exists daily_budget_usd;
-- Every site of the caller's agencies: what needs a person, what it costs, when it was last planned.
create or replace function public.agency_overview()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'url', s.url, 'status', s.status,
      'strategy', (select m.value->>'status' from public.site_memory m where m.site_id = s.id and m.kind = 'strategy' and m.key = 'initial' and m.superseded_at is null limit 1),
      'waiting', (select count(*) from public.jobs j where j.site_id = s.id and j.status = 'awaiting_approval'),
      'escalated', (select count(*) from public.jobs j where j.site_id = s.id and j.status = 'escalated'),
      'active', (select count(*) from public.jobs j where j.site_id = s.id and j.status in ('queued', 'running', 'awaiting_review', 'authorized')),
      'requests', (select count(*) from public.submissions x where x.site_id = s.id and x.status in ('received', 'needs_clarification')),
      'spendToday', coalesce((select sum(c.usd) from public.job_costs c where c.site_id = s.id and c.at >= date_trunc('day', now())), 0),
      'spendMonth', coalesce((select sum(c.usd) from public.job_costs c where c.site_id = s.id and c.at >= date_trunc('month', now())), 0),
      'lastPlanned', (select t.ticked_at from public.god_site_ticks t where t.site_id = s.id),
      'lastError', (select t.outcome->>'error' from public.god_site_ticks t where t.site_id = s.id)
    ) order by s.name), '[]'::jsonb)
  from public.sites s where private.is_member(s.org_id);
$$;
-- D47 Search Console confirmation list (20261115000000)
drop function if exists public.gsc_sites();
-- D46 agent pages (20261114000000)
drop function if exists public.agent_runs(uuid, text, int);
drop function if exists public.site_agent_stats(uuid);
-- D44 business brief (20261113000000); the answers stay in site_memory, where they were before
drop function if exists public.save_brief(uuid, jsonb);
drop function if exists public.site_brief(uuid);
drop function if exists private.brief_keys();
-- D42 live activity (20261112000000)
drop function if exists public.site_activity(uuid, int);
commit;
