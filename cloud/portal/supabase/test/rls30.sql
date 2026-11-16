-- Pilot hardening (20261124000000_pilot_hardening.sql, D62). Run after rls29.sql.
-- Covers: dismiss_job (agency only, escalated or failed only, audited); implement jobs authorized only by the agency and
-- never created by a signed-in caller (request_implementation still works); no write privilege for anon or signed-in
-- users on god_control, god_runs and platform_admins; share links return the client-safe snapshot; the scan's 72-hour
-- rule and the AI specialists while paused (site_pipeline); the real site status (portfolio); god_runs rows written at
-- the start of a run and completed at the end.
\set ON_ERROR_STOP on
create temp table h_ids (k text primary key, v uuid);
grant all on h_ids to authenticated, service_role, anon;

-- Setup (superuser): on agency A's site, one escalated, one failed and one queued job.
do $$ declare site uuid := (select v from ids where k = 'alice_site'); org uuid; begin
  select org_id into org from public.sites where id = site;
  with x as (insert into public.jobs (org_id, site_id, kind, title, source, risk, status) values (org, site, 'agent:seo-reporter', 'Stopped', 'seo_god', 'low', 'escalated') returning id) insert into h_ids select 'esc', id from x;
  with x as (insert into public.jobs (org_id, site_id, kind, title, source, risk, status, attempts) values (org, site, 'agent:seo-reporter', 'Failed', 'seo_god', 'low', 'failed', 1) returning id) insert into h_ids select 'fail', id from x;
  with x as (insert into public.jobs (org_id, site_id, kind, title, source, risk, status) values (org, site, 'scan', 'Queued', 'seo_god', 'low', 'queued') returning id) insert into h_ids select 'q', id from x;
end $$;

-- 1. dismiss_job: anon cannot call it; Bob (another agency) and Carol (the site's client) are refused; Alice dismisses.
set role anon; set request.jwt.claim.role = 'anon'; set request.jwt.claim.sub = '';
do $$ begin perform public.dismiss_job((select v from h_ids where k = 'esc')); raise exception 'anon dismissed'; exception when insufficient_privilege then null; end $$;
reset role;
set role authenticated; set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin perform public.dismiss_job((select v from h_ids where k = 'esc')); raise exception 'other agency dismissed'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin perform public.dismiss_job((select v from h_ids where k = 'esc')); raise exception 'client dismissed'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare j public.jobs; begin
  j := public.dismiss_job((select v from h_ids where k = 'esc'), 'not needed');
  assert j.status = 'cancelled', 'escalated work dismissed';
  j := public.dismiss_job((select v from h_ids where k = 'fail'));
  assert j.status = 'cancelled', 'failed work dismissed (through escalated)';
  begin perform public.dismiss_job((select v from h_ids where k = 'q')); raise exception 'queued work dismissed';
  exception when raise_exception then if sqlerrm not like 'only stopped work%' then raise; end if; end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.audit_log where action = 'job.dismiss' and target in ((select v::text from h_ids where k in ('esc', 'fail')))) = 2, 'both dismissals audited';
  assert (select data->>'note' from public.audit_log where action = 'job.dismiss' and target = (select v::text from h_ids where k = 'esc')) = 'not needed', 'note kept';
  assert (select array_agg(to_status order by id) from public.job_events where job_id = (select v from h_ids where k = 'fail')) = array['escalated', 'cancelled'], 'lifecycle moves recorded';
end $$;

-- 2. Implement jobs: a member cannot create one directly; the service role can, but the Worker can never authorize it,
--    even after a passing review; request_implementation (rls16) still creates its draft; the agency's approval authorizes.
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin perform public.create_job((select v from ids where k = 'alice_site'), 'implement', 'Edit the site', 'agency', 'medium'); raise exception 'member created an implement job';
  exception when raise_exception then if sqlerrm not like 'website changes start from an accepted recommendation%' then raise; end if; end $$;
do $$ begin assert (public.create_job((select v from ids where k = 'alice_site'), 'audit', 'Still allowed', 'agency', 'low')).kind = 'audit', 'other kinds still allowed'; end $$;
reset role;
set role service_role; set request.jwt.claim.role = 'service_role'; set request.jwt.claim.sub = '';
do $$ declare j public.jobs; begin
  j := public.create_job((select v from ids where k = 'alice_site'), 'implement', 'Work order', 'seo_god', 'medium');
  insert into h_ids values ('impl', j.id);
end $$;
reset role;
update public.jobs set status = 'awaiting_review', attempts = 1 where id = (select v from h_ids where k = 'impl'); -- as if it ran
set role service_role; set request.jwt.claim.role = 'service_role'; set request.jwt.claim.sub = '';
do $$ declare j public.jobs; begin
  select * into j from public.jobs where id = (select v from h_ids where k = 'impl');
  perform public.record_review(j.id, 'quality-gate@1', 'pass');
  begin perform public.transition_job(j.id, 'authorized', 'quality-gate@1'); raise exception 'worker authorized a website change';
  exception when raise_exception then if sqlerrm <> 'only an agency approval can authorize or reject' then raise; end if; end;
  perform public.transition_job(j.id, 'awaiting_approval', 'quality-gate@1');
end $$;
reset role;
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin assert (public.approve_job((select v from h_ids where k = 'impl'), 'approve')).status = 'authorized', 'the agency authorizes'; end $$;
reset role;
do $$ begin assert exists (select 1 from public.jobs where kind = 'implement' and idempotency_key like 'implement:%' and inputs ? 'recommendation'), 'request_implementation drafts still exist (rls16)'; end $$;

-- 3. No write privilege for anon or signed-in users on the pause switch, the run records and the admin list.
do $$ declare r text; t text; p text; begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach t in array array['public.god_control', 'public.god_runs', 'public.platform_admins'] loop
      foreach p in array array['insert', 'update', 'delete'] loop
        assert not has_table_privilege(r, t, p), format('%s has %s on %s', r, p, t);
      end loop;
    end loop;
  end loop;
  assert has_table_privilege('service_role', 'public.god_runs', 'insert'), 'the service role still writes runs';
end $$;

-- 4. A share link returns the same results-only snapshot as client_sites.
do $$ declare site uuid := (select v from ids where k = 'alice_site'); v jsonb; tok text; begin
  insert into public.site_snapshots (site_id, taken_at, data) values (site, now() + interval '1 day', '{"version": 9, "score": 71, "runs": [1], "plan": ["x"], "planAt": "t", "issues": [{"url": "https://github.com/acme/private/issues/1"}], "drafts": [1], "proposals": [1], "candidates": [1], "integrations": [{"name": "GitHub", "note": "token ok"}], "source": "github", "digest": "d"}');
  tok := public.create_share_link(site, 'test');
  v := public.shared_site(tok);
  assert (v->'data'->>'score') = '71', 'results kept: ' || coalesce(v::text, 'null');
  assert not (v->'data' ?| array['runs', 'plan', 'planAt', 'issues', 'drafts', 'proposals', 'candidates', 'integrations', 'source', 'digest']), 'internal fields removed: ' || (v->'data')::text;
end $$;

-- 5. site_pipeline: a scan older than 72 hours is stale; a fresh one is connected; paused scheduler: specialists off.
do $$ declare site uuid := (select v from ids where k = 'alice_site'); org uuid; begin
  select org_id into org from public.sites where id = site;
  update public.sites set last_snapshot_at = now() - interval '5 days', scan_state = 'done' where id = site;
  update public.jobs set updated_at = now() - interval '5 days' where site_id = site and kind = 'scan' and status = 'completed';
  update public.site_snapshots set taken_at = now() - interval '5 days' where site_id = site;
  update public.god_control set paused = true where id = 1;
  insert into public.god_runs (runner, started_at) values ('test', now());
end $$;
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare p jsonb := public.site_pipeline((select v from ids where k = 'alice_site')); scan jsonb; ag jsonb; begin
  select x into scan from jsonb_array_elements(p->'connections') x where x->>'key' = 'scan';
  select x into ag from jsonb_array_elements(p->'connections') x where x->>'key' = 'agents';
  assert scan->>'state' = 'error' and scan->>'detail' like 'No scan for 5 days%', 'stale scan: ' || scan::text;
  assert ag->>'state' = 'off' and ag->>'detail' like 'Paused for every website%', 'specialists off while paused: ' || ag::text;
end $$;
reset role;
update public.sites set last_snapshot_at = now() - interval '1 hour' where id = (select v from ids where k = 'alice_site');
update public.god_control set paused = false where id = 1;
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare p jsonb := public.site_pipeline((select v from ids where k = 'alice_site')); scan jsonb; ag jsonb; begin
  select x into scan from jsonb_array_elements(p->'connections') x where x->>'key' = 'scan';
  select x into ag from jsonb_array_elements(p->'connections') x where x->>'key' = 'agents';
  assert scan->>'state' = 'connected', 'fresh scan connected: ' || scan::text;
  assert ag->>'state' = 'connected', 'specialists on again: ' || ag::text;
end $$;

-- 6. portfolio: each website's own status.
reset role;
update public.sites set status = 'connecting' where id = (select v from ids where k = 'alice_site');
set role authenticated; set request.jwt.claim.role = 'authenticated'; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select x->>'status' from jsonb_array_elements(public.portfolio()->'sites') x where (x->>'site')::uuid = (select v from ids where k = 'alice_site')) = 'connecting', 'real status, not "live"';
end $$;
reset role;
update public.sites set status = 'live' where id = (select v from ids where k = 'alice_site');

-- 7. Run records: a row at the start (not finished, marked), completed once at the end; only the service role.
set role authenticated; set request.jwt.claim.role = 'authenticated';
do $$ begin perform public.start_god_run('{}'); raise exception 'browser started a run'; exception when insufficient_privilege then null; end $$;
reset role;
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare v_id bigint; r public.god_runs; begin
  v_id := public.start_god_run('{"runner": "cloudflare-cron", "startedAt": "2026-11-16T10:00:00Z"}');
  select * into r from public.god_runs g where g.id = v_id;
  assert r.finished_at is null and jsonb_array_length(r.errors) = 1, 'started, not finished, marked';
  assert public.record_god_run(jsonb_build_object('id', v_id, 'runner', 'cloudflare-cron', 'jobsRun', 2, 'errors', '[]'::jsonb)) = v_id, 'same row completed';
  select * into r from public.god_runs g where g.id = v_id;
  assert r.finished_at is not null and r.jobs_run = 2 and r.errors = '[]'::jsonb and r.started_at = '2026-11-16T10:00:00Z', 'completed with the end figures';
  assert public.record_god_run(jsonb_build_object('id', v_id, 'runner', 'again')) <> v_id, 'a finished row is never rewritten';
  v_id := public.record_god_run('{"runner": "old-worker"}');
  assert (select finished_at is not null from public.god_runs g where g.id = v_id), 'without an id: inserted finished, as before';
end $$;
reset role;
\echo rls30 ok
