#!/usr/bin/env node
// Load check (Phase 7, D50) on a throwaway local Postgres 16 with every portal migration: how long the functions the
// portal and the scheduler call take when one agency has 25 or 100 websites with a month of work each, plus the
// scheduler's capacity from its own settings. No production access. Database superuser, like the other local checks.
//   node scripts/load-check.mjs [--sites 25,100]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const R = fileURLToPath(new URL("..", import.meta.url)), M = R + "cloud/portal/supabase/migrations/", T = R + "cloud/portal/supabase/test/";
const strip = (f) => readFileSync(f, "utf8").replace(/^create extension if not exists pg_(net|cron);$/gm, "");
const FILES = [T + "shim.sql", M + "20261030000000_portal.sql", M + "20261030120000_portal_approvals_team_brand.sql", T + "shim3.sql", "!" + M + "20261104000000_portal_url_sites.sql", T + "shim4.sql",
  ...["20261108000000_r1_contracts.sql", "20261108010000_r1_memory.sql", "20261108020000_r1_scheduler.sql", "20261108030000_cloudflare_execution.sql", "20261108040000_agency_console.sql", "20261108050000_client_portal.sql", "20261108060000_learning.sql", "20261108070000_operations.sql", "20261108080000_security_fixes.sql", "20261108090000_strategy_draft.sql", "20261108100000_invite_only.sql"].map((f) => M + f),
  T + "shim5.sql", ...["20261108110000_github_execution.sql", "20261108120000_notifications_reports.sql", "20261108130000_email.sql", "20261112000000_activity.sql", "20261113000000_business_brief.sql", "20261114000000_agent_pages.sql", "20261115000000_gsc_sites.sql", "20261116000000_budgets_alerts.sql"].map((f) => M + f)];
const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: "utf8", maxBuffer: 64e6, ...o });
const psql = (db, sql) => sh("psql", ["-qAtX", "-v", "ON_ERROR_STOP=1", "-d", db], { input: sql });

const SEED = (n) => `
-- Invite-only sign-up (D36) refuses a bare insert; this throwaway database skips triggers for the seed user only.
set session_replication_role = replica;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@agency.test');
set session_replication_role = origin;
insert into public.orgs (name) values ('Load agency');
insert into public.org_members (org_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.orgs;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000000a');
with o as (select id from public.orgs limit 1)
insert into public.sites (org_id, name, url, status) select o.id, 'Site ' || g, 'https://site' || g || '.test/', 'live' from o, generate_series(1, ${n}) g;
-- A month of work per site: 40 jobs (12 specialist runs), 4 steps each, costs, reviews, memory, the planner's tick.
insert into public.jobs (org_id, site_id, kind, title, source, risk, requires_approval, status, agent, cost_usd, budget_usd, outputs, created_at, updated_at)
select s.org_id, s.id, case when g % 3 = 0 then 'agent:seo-reporter' when g % 5 = 0 then 'agent:seo-content-pruner' else 'scan' end, 'Job ' || g, 'seo_god',
       case when g % 5 = 0 then 'high' else 'low' end, g % 5 = 0,
       (array['completed','completed','completed','awaiting_approval','escalated','queued'])[1 + g % 6],
       case when g % 3 = 0 then 'seo-reporter' when g % 5 = 0 then 'seo-content-pruner' end, 0.1, 0.5,
       jsonb_build_object('proposal', jsonb_build_object('summary', repeat('advice ', 80), 'recommendations', jsonb_build_array(jsonb_build_object('title', 'Do a thing')), 'knowledge', jsonb_build_array('knowledge/seo-reporting.md')), 'evidence', jsonb_build_array('read: x')),
       now() - (g || ' hours')::interval * 18, now() - (g || ' hours')::interval * 18
  from public.sites s, generate_series(1, 40) g;
insert into public.job_events (job_id, org_id, actor_kind, actor, from_status, to_status, note, at)
select j.id, j.org_id, 'agent', 'seo-god', null, 'queued', 'step ' || g, j.created_at + (g || ' minutes')::interval from public.jobs j, generate_series(1, 4) g;
insert into public.job_costs (org_id, site_id, job_id, usd, at) select j.org_id, j.site_id, j.id, 0.1, j.updated_at from public.jobs j where j.kind like 'agent:%';
insert into public.reviews (job_id, org_id, reviewer, producer, verdict) select j.id, j.org_id, 'quality-gate@1', j.agent, 'pass' from public.jobs j where j.kind like 'agent:%';
insert into public.site_memory (org_id, site_id, kind, key, value, basis, created_by) select s.org_id, s.id, 'identity', 'k' || g, jsonb_build_object('value', 'v' || g), 'stated', 'load-check' from public.sites s, generate_series(1, 10) g;
insert into public.god_site_ticks (site_id, org_id, ticked_at, outcome) select s.id, s.org_id, now() - interval '1 hour', '{"budgetUsd": 2, "deferredForBudget": 0}' from public.sites s;
insert into public.god_runs (runner, started_at, finished_at, errors, paused) select 'load', now() - (g * 15 || ' minutes')::interval, now() - (g * 15 || ' minutes')::interval, '[]', false from generate_series(1, 96) g;
analyze;`;

const TIMING = `
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ declare s uuid := (select id from public.sites order by name limit 1); t0 timestamptz; r text := ''; i int;
begin
  for i in 1..2 loop perform public.agency_overview(); end loop; -- warm
  t0 := clock_timestamp(); for i in 1..5 loop perform public.agency_overview(); end loop; r := r || 'agency_overview ' || round(extract(epoch from clock_timestamp() - t0) * 200) || ' ms;';
  t0 := clock_timestamp(); for i in 1..5 loop perform public.ops_alerts(); end loop; r := r || 'ops_alerts ' || round(extract(epoch from clock_timestamp() - t0) * 200) || ' ms;';
  t0 := clock_timestamp(); for i in 1..5 loop perform public.site_activity(s, 60); end loop; r := r || 'site_activity ' || round(extract(epoch from clock_timestamp() - t0) * 200) || ' ms;';
  t0 := clock_timestamp(); for i in 1..5 loop perform public.site_agent_stats(s); end loop; r := r || 'site_agent_stats ' || round(extract(epoch from clock_timestamp() - t0) * 200) || ' ms;';
  t0 := clock_timestamp(); for i in 1..5 loop perform public.agent_runs(s, 'seo-reporter', 30); end loop; r := r || 'agent_runs ' || round(extract(epoch from clock_timestamp() - t0) * 200) || ' ms;';
  t0 := clock_timestamp(); for i in 1..5 loop perform public.gsc_sites(); end loop; r := r || 'gsc_sites ' || round(extract(epoch from clock_timestamp() - t0) * 200) || ' ms;';
  raise notice '%', r;
end $$;
reset role; set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare t0 timestamptz := clock_timestamp(); i int; begin
  for i in 1..5 loop perform * from public.god_due_sites(5); end loop;
  raise notice 'god_due_sites % ms;', round(extract(epoch from clock_timestamp() - t0) * 200);
end $$;`;

const si = process.argv.indexOf("--sites"), sizes = (si >= 0 ? process.argv[si + 1] : "25,100").split(",").map(Number).filter((x) => x > 0);
const out = [];
try { sh("psql", ["-qd", "postgres", "-c", "drop role if exists anon, authenticated, service_role"]); } catch { /* none */ }
for (const n of sizes) {
  const db = `load_${n}_${process.pid}`;
  sh("createdb", [db]);
  try {
    psql(db, FILES.map((f) => (f.startsWith("!") ? strip(f.slice(1)) : readFileSync(f, "utf8"))).join("\n"));
    psql(db, SEED(n));
    const err = sh("bash", ["-c", `psql -qAtX -v ON_ERROR_STOP=1 -d ${db} 2>&1 >/dev/null`], { input: TIMING }); // the timings arrive as NOTICE lines
    const ms = Object.fromEntries([...err.matchAll(/(\w+) (\d+) ms/g)].map((m) => [m[1], Number(m[2])]));
    const jobs = Number(psql(db, "select count(*) from public.jobs;"));
    out.push({ sites: n, jobs, ms });
  } finally { sh("dropdb", [db]); try { sh("psql", ["-qd", "postgres", "-c", "drop role if exists anon, authenticated, service_role"]); } catch { /* roles in use */ } }
}
// Scheduler capacity from the Worker's own settings (cloud/worker/src/app.mjs defaults, wrangler.toml): 96 runs a day,
// SITES_PER_RUN sites planned per run, each site at most every SITE_MIN_AGE_HOURS hours (sooner when approved work waits).
const runsPerDay = 96, sitesPerRun = 5, minAgeHours = 6;
const capacity = Math.floor((runsPerDay * sitesPerRun) / (24 / minAgeHours));
console.log(JSON.stringify({ results: out, scheduler: { runsPerDay, sitesPerRun, minAgeHours, sitesAtFullCadence: capacity, note: `planning slots: ${runsPerDay * sitesPerRun} a day; at one plan per site every ${minAgeHours} h that serves ${capacity} sites; beyond that each site is planned less often (raise SITES_PER_RUN up to 25)` } }, null, 1));
