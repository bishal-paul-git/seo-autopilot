-- Release 1 shared contracts (docs/product/R1-CONTRACTS.md): clients under an agency, client accounts limited to results
-- and submissions, jobs with a guarded lifecycle and an append-only event log, independent reviews, agency-only
-- approvals, untrusted client submissions, private site memory, integration records without secrets, and an audit log.
-- Additive: existing tables, functions and the portal keep working. Not applied anywhere until the owner approves.

-- Clients of an agency, and the client's people (viewers). A client viewer is never an agency member. ------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  created_at timestamptz not null default now()
);
create index clients_org_idx on public.clients (org_id);
alter table public.sites add column client_id uuid references public.clients (id) on delete set null;
create index sites_client_idx on public.sites (client_id);

create table public.client_members (
  client_id uuid not null references public.clients (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);
create index client_members_user_idx on public.client_members (user_id);

create table public.client_invites (
  id bigserial primary key,
  client_id uuid not null references public.clients (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  invited_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, email)
);

-- A site's client must belong to the site's agency.
create or replace function private.client_org(p_client uuid)
returns uuid language sql stable security definer set search_path = '' as $$ select c.org_id from public.clients c where c.id = p_client $$;
-- Same-org rules are triggers (security definer), not CHECK constraints: a CHECK calling a private function would need
-- every writing role (including members renaming a site) to have execute rights on it.
create or replace function private.sites_client_same_org() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.client_id is not null and private.client_org(new.client_id) is distinct from new.org_id then raise exception 'client belongs to another agency'; end if;
  return new;
end; $$;
create trigger sites_client_same_org before insert or update of client_id, org_id on public.sites for each row execute function private.sites_client_same_org();
create or replace function private.row_same_org() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.site_org(new.site_id) is distinct from new.org_id then raise exception 'site belongs to another agency'; end if;
  return new;
end; $$;

-- Agency authority: an agency (org) member. Client viewers are never org members, so every agency-only check below holds.
create or replace function private.is_client_viewer(p_site uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sites s join public.client_members m on m.client_id = s.client_id
                 where s.id = p_site and m.user_id = (select auth.uid()));
$$;
create or replace function private.is_agency_for_site(p_site uuid)
returns boolean language sql stable security definer set search_path = '' as $$ select private.is_member(private.site_org(p_site)) $$;

-- New users: a pending client invitation makes the person a client viewer and no agency org is created for them.
create or replace function private.on_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if exists (select 1 from public.client_invites i where i.email = lower(new.email) and i.accepted_at is null) then
    insert into public.client_members (client_id, user_id) select i.client_id, new.id from public.client_invites i
      where i.email = lower(new.email) and i.accepted_at is null on conflict do nothing;
    update public.client_invites set accepted_at = now() where email = lower(new.email) and accepted_at is null;
    return new;
  end if;
  if exists (select 1 from public.invites i where i.email = lower(new.email) and i.accepted_at is null) then return new; end if; -- joins an agency through accept_invites
  insert into public.orgs (name) values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'My agency')) returning id into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org, new.id, 'owner');
  return new;
end;
$$;

-- Jobs: one record per unit of work, with the lifecycle from the master spec (§3). ------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  kind text not null check (length(kind) between 1 and 80),
  title text not null check (length(title) between 1 and 200),
  objective text,
  source text not null check (source in ('schedule', 'event', 'on_demand', 'seo_god', 'agency', 'client_submission')),
  priority int not null default 3 check (priority between 1 and 5), -- 1 owner request, 2 critical maintenance, 3+ opportunities
  risk text not null default 'low' check (risk in ('low', 'medium', 'high')),
  requires_approval boolean not null default false,
  status text not null default 'proposed' check (status in ('proposed', 'scoped', 'queued', 'running', 'awaiting_review', 'awaiting_approval', 'authorized', 'deploying', 'verifying', 'completed', 'failed', 'cancelled', 'rejected', 'escalated')),
  idempotency_key text,
  depends_on uuid[] not null default '{}',
  agent text, agent_version text,
  inputs jsonb not null default '{}', outputs jsonb, evidence jsonb,
  attempts int not null default 0, max_attempts int not null default 3 check (max_attempts between 1 and 10),
  budget_usd numeric(10, 4) not null default 0 check (budget_usd >= 0), cost_usd numeric(10, 4) not null default 0,
  lease_owner text, lease_until timestamptz, not_before timestamptz,
  error text, deployment_ref text, rollback_ref text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint jobs_high_risk_needs_approval check (risk <> 'high' or requires_approval),
  constraint jobs_client_submissions_need_approval check (source <> 'client_submission' or requires_approval)
);
create unique index jobs_idempotency_idx on public.jobs (site_id, idempotency_key) where idempotency_key is not null;
create index jobs_site_status_idx on public.jobs (site_id, status);
create index jobs_queue_idx on public.jobs (priority, created_at) where status = 'queued';

create table public.job_events (
  id bigserial primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  org_id uuid not null,
  at timestamptz not null default now(),
  actor_kind text not null check (actor_kind in ('user', 'agent', 'system')),
  actor text,
  from_status text, to_status text,
  note text, data jsonb
);
create index job_events_job_idx on public.job_events (job_id, at);

create table public.reviews (
  id bigserial primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  org_id uuid not null,
  reviewer text not null, producer text not null,
  verdict text not null check (verdict in ('pass', 'fail', 'needs_changes')),
  rationale text, evidence jsonb,
  created_at timestamptz not null default now(),
  constraint reviews_independent check (reviewer <> producer)
);

create table public.approvals (
  id bigserial primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  org_id uuid not null,
  decided_by uuid not null references auth.users (id),
  decision text not null check (decision in ('approve', 'reject', 'request_changes')),
  note text,
  created_at timestamptz not null default now()
);

-- Allowed lifecycle moves. src/core/job-lifecycle.mjs holds the same table; test/job-lifecycle.test.mjs checks they match.
create or replace function private.job_move_allowed(p_from text, p_to text)
returns boolean language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('proposed','scoped'), ('proposed','cancelled'), ('proposed','rejected'),
    ('scoped','queued'), ('scoped','awaiting_approval'), ('scoped','cancelled'),
    ('queued','running'), ('queued','cancelled'),
    ('running','awaiting_review'), ('running','completed'), ('running','failed'),
    ('awaiting_review','awaiting_approval'), ('awaiting_review','authorized'), ('awaiting_review','queued'), ('awaiting_review','failed'),
    ('awaiting_approval','authorized'), ('awaiting_approval','rejected'), ('awaiting_approval','scoped'),
    ('authorized','queued'), ('authorized','deploying'), ('authorized','completed'),
    ('deploying','verifying'), ('deploying','failed'),
    ('verifying','completed'), ('verifying','failed'),
    ('failed','queued'), ('failed','escalated'),
    ('escalated','queued'), ('escalated','cancelled')
  );
$$;

-- The single gate every status change passes: legal move, approval before anything runs or deploys when one is required,
-- a passing independent review before approval or deploy for non-low risk, retry cap, and an event row.
create or replace function private.move_job(p_job uuid, p_to text, p_actor_kind text, p_actor text, p_note text default null, p_data jsonb default null)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_from text; approved boolean; reviewed boolean;
begin
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then raise exception 'job not found'; end if;
  v_from := j.status;
  if not private.job_move_allowed(v_from, p_to) then raise exception 'job cannot move from % to %', v_from, p_to; end if;
  approved := coalesce((select a.decision = 'approve' from public.approvals a where a.job_id = j.id order by a.id desc limit 1), false);
  reviewed := coalesce((select r.verdict = 'pass' from public.reviews r where r.job_id = j.id order by r.id desc limit 1), false);
  -- Nothing that needs approval is queued, run, authorized or deployed without the latest agency decision being "approve".
  if j.requires_approval and p_to in ('queued', 'running', 'authorized', 'deploying') and not approved then raise exception 'job needs agency approval first'; end if;
  -- Medium and high risk work leaves review only with a passing independent review.
  if v_from = 'awaiting_review' and p_to in ('awaiting_approval', 'authorized') and j.risk <> 'low' and not reviewed then raise exception 'job needs a passing independent review'; end if;
  if v_from = 'running' and p_to = 'completed' and (j.risk <> 'low' or j.requires_approval) then raise exception 'only low-risk jobs without approval can complete straight from running'; end if;
  if v_from in ('failed', 'escalated') and p_to = 'queued' and v_from = 'failed' and j.attempts >= j.max_attempts then raise exception 'retry cap reached: escalate'; end if;
  update public.jobs set status = p_to, updated_at = now(),
    attempts = attempts + case when p_to = 'running' then 1 else 0 end,
    lease_owner = case when p_to = 'running' then lease_owner end,
    lease_until = case when p_to = 'running' then lease_until end
    where id = j.id returning * into j;
  insert into public.job_events (job_id, org_id, actor_kind, actor, from_status, to_status, note, data) values (j.id, j.org_id, p_actor_kind, p_actor, v_from, p_to, p_note, p_data);
  return j;
end;
$$;

-- Agency staff create work; the service role (SEO God, workers) does too. High risk always needs approval.
create or replace function public.create_job(p_site uuid, p_kind text, p_title text, p_source text default 'agency', p_risk text default 'low',
  p_requires_approval boolean default false, p_priority int default 3, p_inputs jsonb default '{}', p_idempotency_key text default null,
  p_objective text default null, p_depends_on uuid[] default '{}', p_budget_usd numeric default 0)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_org uuid := private.site_org(p_site); is_service boolean := (select auth.role()) = 'service_role';
begin
  if v_org is null then raise exception 'site not found'; end if;
  if not is_service and not private.is_member(v_org) then raise exception 'not allowed'; end if;
  if not is_service and p_source not in ('agency', 'on_demand') then raise exception 'agency staff create agency or on-demand jobs'; end if;
  if p_idempotency_key is not null then
    select * into j from public.jobs where site_id = p_site and idempotency_key = p_idempotency_key;
    if j.id is not null then return j; end if; -- a repeated event does not create a second job
  end if;
  insert into public.jobs (org_id, site_id, kind, title, objective, source, priority, risk, requires_approval, inputs, idempotency_key, depends_on, budget_usd, created_by)
    values (v_org, p_site, p_kind, p_title, p_objective, p_source, coalesce(p_priority, 3), p_risk, p_requires_approval or p_risk = 'high' or p_source = 'client_submission',
            coalesce(p_inputs, '{}'), p_idempotency_key, coalesce(p_depends_on, '{}'), coalesce(p_budget_usd, 0), (select auth.uid()))
    returning * into j;
  insert into public.job_events (job_id, org_id, actor_kind, actor, to_status, note) values (j.id, j.org_id, case when is_service then 'agent' else 'user' end, coalesce((select auth.uid())::text, 'service'), 'proposed', 'created');
  insert into public.audit_log (org_id, site_id, actor, action, target) values (j.org_id, j.site_id, (select auth.uid()), 'job.create', j.id::text);
  return j;
end;
$$;

-- Agency-only decisions on a job waiting for approval.
create or replace function public.approve_job(p_job uuid, p_decision text, p_note text default null)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not private.is_member(j.org_id) then raise exception 'not allowed'; end if;
  if j.status <> 'awaiting_approval' then raise exception 'job is not waiting for approval'; end if;
  if p_decision not in ('approve', 'reject', 'request_changes') then raise exception 'decision must be approve, reject or request_changes'; end if;
  insert into public.approvals (job_id, org_id, decided_by, decision, note) values (j.id, j.org_id, (select auth.uid()), p_decision, nullif(trim(coalesce(p_note, '')), ''));
  insert into public.audit_log (org_id, site_id, actor, action, target, data) values (j.org_id, j.site_id, (select auth.uid()), 'job.' || p_decision, j.id::text, jsonb_build_object('note', p_note));
  return private.move_job(j.id, case p_decision when 'approve' then 'authorized' when 'reject' then 'rejected' else 'scoped' end, 'user', (select auth.uid())::text, p_note);
end;
$$;

-- Workers (service role): move, review, claim with a lease, fail with a retry cap.
create or replace function public.transition_job(p_job uuid, p_to text, p_actor text, p_note text default null, p_data jsonb default null)
returns public.jobs language plpgsql security definer set search_path = '' as $$
begin
  -- Rejecting, and authorizing work that needs approval, belong to the agency (approve_job). Work that needs no approval is
  -- authorized by the worker after its independent review.
  if p_to = 'rejected' or (p_to = 'authorized' and (select requires_approval from public.jobs where id = p_job)) then raise exception 'only an agency approval can authorize or reject'; end if;
  return private.move_job(p_job, p_to, 'agent', p_actor, p_note, p_data);
end;
$$;

create or replace function public.record_review(p_job uuid, p_reviewer text, p_verdict text, p_rationale text default null, p_evidence jsonb default null)
returns public.reviews language plpgsql security definer set search_path = '' as $$
declare j public.jobs; r public.reviews;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null then raise exception 'job not found'; end if;
  if j.status <> 'awaiting_review' then raise exception 'job is not waiting for review'; end if;
  insert into public.reviews (job_id, org_id, reviewer, producer, verdict, rationale, evidence)
    values (j.id, j.org_id, p_reviewer, coalesce(j.agent, 'unknown'), p_verdict, p_rationale, p_evidence) returning * into r;
  return r;
end;
$$;

create or replace function public.claim_job(p_worker text, p_lease_seconds int default 600)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs q
   where q.status = 'queued' and (q.not_before is null or q.not_before <= now())
     and not exists (select 1 from public.jobs d where d.id = any (q.depends_on) and d.status <> 'completed')
   order by q.priority, q.created_at limit 1 for update skip locked;
  if j.id is null then return null; end if;
  update public.jobs set lease_owner = p_worker, lease_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 3600)) where id = j.id;
  return private.move_job(j.id, 'running', 'agent', p_worker, 'claimed');
end;
$$;

create or replace function public.fail_job(p_job uuid, p_actor text, p_error text)
returns public.jobs language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  update public.jobs set error = left(p_error, 1000) where id = p_job;
  j := private.move_job(p_job, 'failed', 'agent', p_actor, left(p_error, 300));
  if j.attempts < j.max_attempts then
    update public.jobs set not_before = now() + make_interval(mins => 5 * j.attempts) where id = j.id;
    return private.move_job(j.id, 'queued', 'system', 'retry', 'retry ' || (j.attempts + 1) || ' of ' || j.max_attempts);
  end if;
  return private.move_job(j.id, 'escalated', 'system', 'retry', 'retry cap reached');
end;
$$;

-- Client submissions: untrusted advisory input. Never creates or changes a job by itself. --------------------------------
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  submitted_by uuid not null references auth.users (id),
  submitted_by_client boolean not null,
  kind text not null check (kind in ('plan', 'document', 'keyword', 'file', 'suggestion', 'feedback')),
  title text not null check (length(title) between 1 and 200),
  body text check (body is null or length(body) <= 20000),
  file_path text check (file_path is null or file_path ~ '^submissions/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  status text not null default 'received' check (status in ('received', 'analyzing', 'awaiting_agency', 'accepted', 'rejected', 'needs_clarification')),
  analysis jsonb, -- SEO God's private analysis, never shown to the client
  agency_note text,
  decided_by uuid references auth.users (id), decided_at timestamptz,
  job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now()
);
create index submissions_site_idx on public.submissions (site_id, created_at desc);

create or replace function public.submit_to_agency(p_site uuid, p_kind text, p_title text, p_body text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.submissions; v_client boolean := private.is_client_viewer(p_site);
begin
  if not v_client and not private.is_agency_for_site(p_site) then raise exception 'not allowed'; end if;
  if v_client and (select count(*) from public.submissions where submitted_by = (select auth.uid()) and created_at > now() - interval '1 day') >= 30 then
    raise exception 'at most 30 submissions a day'; end if;
  insert into public.submissions (org_id, site_id, submitted_by, submitted_by_client, kind, title, body)
    values (private.site_org(p_site), p_site, (select auth.uid()), v_client, p_kind, trim(p_title), nullif(trim(coalesce(p_body, '')), ''))
    returning * into s;
  insert into public.audit_log (org_id, site_id, actor, action, target) values (s.org_id, s.site_id, s.submitted_by, 'submission.create', s.id::text);
  return jsonb_build_object('id', s.id, 'status', s.status, 'created_at', s.created_at);
end;
$$;

-- Agency decides; accepting creates a proposed job that still needs agency approval before anything runs.
create or replace function public.review_submission(p_submission uuid, p_decision text, p_note text default null, p_job_kind text default 'client_request', p_risk text default 'medium')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.submissions; j public.jobs;
begin
  select * into s from public.submissions where id = p_submission for update;
  if s.id is null or not private.is_member(s.org_id) then raise exception 'not allowed'; end if;
  if p_decision not in ('accepted', 'rejected', 'needs_clarification') then raise exception 'decision must be accepted, rejected or needs_clarification'; end if;
  if s.status in ('accepted', 'rejected') then raise exception 'submission already decided'; end if;
  if p_decision = 'accepted' then
    insert into public.jobs (org_id, site_id, kind, title, source, priority, risk, requires_approval, inputs, created_by)
      values (s.org_id, s.site_id, p_job_kind, s.title, 'client_submission', 1, p_risk, true, jsonb_build_object('submission', s.id, 'untrusted', true), (select auth.uid()))
      returning * into j;
    insert into public.job_events (job_id, org_id, actor_kind, actor, to_status, note) values (j.id, j.org_id, 'user', (select auth.uid())::text, 'proposed', 'from client submission');
  end if;
  update public.submissions set status = p_decision, agency_note = nullif(trim(coalesce(p_note, '')), ''), decided_by = (select auth.uid()), decided_at = now(), job_id = j.id
    where id = s.id returning * into s;
  insert into public.audit_log (org_id, site_id, actor, action, target, data) values (s.org_id, s.site_id, (select auth.uid()), 'submission.' || p_decision, s.id::text, jsonb_build_object('job', j.id));
  return jsonb_build_object('id', s.id, 'status', s.status, 'job', j.id);
end;
$$;

-- What a client sees of a submission: its own status and the agency's note; never the SEO God analysis.
create or replace function public.my_submissions(p_site uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'title', s.title, 'status', s.status, 'agency_note', s.agency_note, 'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
  from public.submissions s
  where s.site_id = p_site and (private.is_agency_for_site(p_site) or (private.is_client_viewer(p_site) and s.submitted_by_client));
$$;

-- What a client sees of a site: results only. Agent runs, plans, issue links, drafts and integration internals are removed.
create or replace function public.client_sites()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('site', jsonb_build_object('id', s.id, 'name', s.name, 'url', s.url, 'status', s.status, 'last_snapshot_at', s.last_snapshot_at),
    'data', (select x.data - array['runs', 'plan', 'planAt', 'issues', 'drafts', 'proposals', 'candidates', 'integrations', 'source', 'digest'] from public.site_snapshots x where x.site_id = s.id order by x.taken_at desc limit 1),
    'brand', (select jsonb_build_object('name', coalesce(o.brand_name, o.name), 'color', o.brand_color) from public.orgs o where o.id = s.org_id)
  ) order by s.name), '[]'::jsonb)
  from public.sites s join public.client_members m on m.client_id = s.client_id and m.user_id = (select auth.uid());
$$;

-- Private site memory, integrations (no secrets) and the audit log. ------------------------------------------------------
create table public.site_memory (
  id bigserial primary key,
  org_id uuid not null, site_id uuid not null references public.sites (id) on delete cascade,
  kind text not null check (kind in ('identity', 'brand', 'strategy', 'objective', 'decision', 'experiment', 'lesson', 'failure', 'question', 'answer')),
  key text not null check (length(key) between 1 and 120),
  value jsonb not null,
  basis text not null check (basis in ('stated', 'inferred', 'verified', 'answered')),
  confidence numeric(3, 2) check (confidence is null or confidence between 0 and 1),
  source text,
  created_by text not null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);
create index site_memory_site_idx on public.site_memory (site_id, kind, key) where superseded_at is null;

create table public.integrations (
  id bigserial primary key,
  org_id uuid not null, site_id uuid not null references public.sites (id) on delete cascade,
  provider text not null check (provider in ('search_console', 'ga4', 'github', 'crawler', 'bing_webmaster', 'google_sheets', 'other')),
  scope text not null check (scope in ('read', 'write')),
  status text not null default 'unconnected' check (status in ('unconnected', 'connected', 'error', 'revoked')),
  detail jsonb, -- property id, repository name; never a secret
  last_ok_at timestamptz, last_error text,
  created_at timestamptz not null default now(),
  unique (site_id, provider, scope)
);

create table public.audit_log (
  id bigserial primary key,
  org_id uuid not null, site_id uuid,
  actor uuid, action text not null, target text, data jsonb,
  at timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (org_id, at desc);

create trigger jobs_same_org before insert or update of site_id, org_id on public.jobs for each row execute function private.row_same_org();
create trigger submissions_same_org before insert or update of site_id, org_id on public.submissions for each row execute function private.row_same_org();
create trigger site_memory_same_org before insert or update of site_id, org_id on public.site_memory for each row execute function private.row_same_org();
create trigger integrations_same_org before insert or update of site_id, org_id on public.integrations for each row execute function private.row_same_org();

-- Row level security: agency members read their org's rows; client viewers read nothing here directly (they use
-- client_sites and my_submissions). Writes only through the functions above. ------------------------------------------
alter table public.clients enable row level security;
alter table public.client_members enable row level security;
alter table public.client_invites enable row level security;
alter table public.jobs enable row level security;
alter table public.job_events enable row level security;
alter table public.reviews enable row level security;
alter table public.approvals enable row level security;
alter table public.submissions enable row level security;
alter table public.site_memory enable row level security;
alter table public.integrations enable row level security;
alter table public.audit_log enable row level security;
create policy clients_select on public.clients for select to authenticated using ((select private.is_member(org_id)));
create policy client_members_select on public.client_members for select to authenticated using ((select private.is_member(private.client_org(client_id))));
create policy client_invites_select on public.client_invites for select to authenticated using ((select private.is_member(private.client_org(client_id))));
create policy jobs_select on public.jobs for select to authenticated using ((select private.is_member(org_id)));
create policy job_events_select on public.job_events for select to authenticated using ((select private.is_member(org_id)));
create policy reviews_select on public.reviews for select to authenticated using ((select private.is_member(org_id)));
create policy approvals_select on public.approvals for select to authenticated using ((select private.is_member(org_id)));
create policy submissions_select on public.submissions for select to authenticated using ((select private.is_member(org_id)));
create policy site_memory_select on public.site_memory for select to authenticated using ((select private.is_member(org_id)));
create policy integrations_select on public.integrations for select to authenticated using ((select private.is_member(org_id)));
create policy audit_log_select on public.audit_log for select to authenticated using ((select private.is_owner(org_id)));
revoke all on public.clients, public.client_members, public.client_invites, public.jobs, public.job_events, public.reviews, public.approvals,
  public.submissions, public.site_memory, public.integrations, public.audit_log from anon, authenticated;
grant select on public.clients, public.client_members, public.client_invites, public.jobs, public.job_events, public.reviews, public.approvals,
  public.submissions, public.site_memory, public.integrations, public.audit_log to authenticated;
grant all on public.clients, public.client_members, public.client_invites, public.jobs, public.job_events, public.reviews, public.approvals,
  public.submissions, public.site_memory, public.integrations, public.audit_log to service_role;
grant usage on all sequences in schema public to service_role;

-- Agency management of clients (owners and members).
create or replace function public.create_client(p_name text, p_org uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; c public.clients;
begin
  v_org := coalesce(p_org, (select m.org_id from public.org_members m where m.user_id = (select auth.uid()) order by m.created_at limit 1));
  if v_org is null or not private.is_member(v_org) then raise exception 'not allowed'; end if;
  insert into public.clients (org_id, name) values (v_org, trim(p_name)) returning * into c;
  insert into public.audit_log (org_id, actor, action, target) values (v_org, (select auth.uid()), 'client.create', c.id::text);
  return to_jsonb(c);
end;
$$;
create or replace function public.assign_site_client(p_site uuid, p_client uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_agency_for_site(p_site) or private.client_org(p_client) is distinct from private.site_org(p_site) then raise exception 'not allowed'; end if;
  update public.sites set client_id = p_client where id = p_site;
  insert into public.audit_log (org_id, site_id, actor, action, target) values (private.site_org(p_site), p_site, (select auth.uid()), 'site.assign_client', p_client::text);
end;
$$;
create or replace function public.invite_client_user(p_client uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.client_org(p_client); v_email text := lower(trim(p_email)); v_user uuid;
begin
  if v_org is null or not private.is_member(v_org) then raise exception 'not allowed'; end if;
  if exists (select 1 from public.org_members m join auth.users u on u.id = m.user_id where lower(u.email) = v_email) then raise exception 'that person is agency staff'; end if;
  insert into public.client_invites (client_id, email, invited_by) values (p_client, v_email, (select auth.uid())) on conflict (client_id, email) do nothing;
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    insert into public.client_members (client_id, user_id) values (p_client, v_user) on conflict do nothing;
    update public.client_invites set accepted_at = now() where client_id = p_client and email = v_email;
  end if;
  insert into public.audit_log (org_id, actor, action, target) values (v_org, (select auth.uid()), 'client.invite', v_email);
  return jsonb_build_object('client', p_client, 'email', v_email, 'joined', v_user is not null);
end;
$$;

revoke all on function private.move_job(uuid, text, text, text, text, jsonb), public.create_job(uuid, text, text, text, text, boolean, int, jsonb, text, text, uuid[], numeric),
  public.approve_job(uuid, text, text), public.transition_job(uuid, text, text, text, jsonb), public.record_review(uuid, text, text, text, jsonb),
  public.claim_job(text, int), public.fail_job(uuid, text, text), public.submit_to_agency(uuid, text, text, text),
  public.review_submission(uuid, text, text, text, text), public.my_submissions(uuid), public.client_sites(),
  public.create_client(text, uuid), public.assign_site_client(uuid, uuid), public.invite_client_user(uuid, text) from public, anon, authenticated;
grant execute on function public.create_job(uuid, text, text, text, text, boolean, int, jsonb, text, text, uuid[], numeric), public.approve_job(uuid, text, text),
  public.submit_to_agency(uuid, text, text, text), public.review_submission(uuid, text, text, text, text), public.my_submissions(uuid), public.client_sites(),
  public.create_client(text, uuid), public.assign_site_client(uuid, uuid), public.invite_client_user(uuid, text) to authenticated;
grant execute on function public.create_job(uuid, text, text, text, text, boolean, int, jsonb, text, text, uuid[], numeric), public.transition_job(uuid, text, text, text, jsonb),
  public.record_review(uuid, text, text, text, jsonb), public.claim_job(text, int), public.fail_job(uuid, text, text) to service_role;
