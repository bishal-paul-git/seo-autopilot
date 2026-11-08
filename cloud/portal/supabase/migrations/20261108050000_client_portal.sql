-- Client portal, both sides (R1-P2). Owner decisions: clients get reporting plus advisory submissions only; a
-- submission never starts work by itself; only the agency approves. Built on D27's submissions and client accounts.
--   agency_inbox(site)           agency members: the site's client (members, pending invites), the org's clients, and
--                                every submission with its full text and who sent it.
--   review_submission(...)       replaced: an accepted request becomes a job with a budget (it was 0, so it could never
--                                run) and still requires the agency's approval before anything runs.
--   submission_for_job(job)      the worker (service role only) reads the request text of the job it runs; the text is
--                                untrusted and is handled as data.
-- Not applied anywhere.

create or replace function public.agency_inbox(p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.site_org(p_site); v_client uuid;
begin
  if v_org is null or not private.is_member(v_org) then raise exception 'not allowed'; end if;
  select client_id into v_client from public.sites where id = p_site;
  return jsonb_build_object(
    'client', (select jsonb_build_object('id', c.id, 'name', c.name,
        'members', coalesce((select jsonb_agg(u.email order by u.email) from public.client_members m join auth.users u on u.id = m.user_id where m.client_id = c.id), '[]'::jsonb),
        'invites', coalesce((select jsonb_agg(jsonb_build_object('email', i.email, 'accepted', i.accepted_at is not null) order by i.email) from public.client_invites i where i.client_id = c.id), '[]'::jsonb))
      from public.clients c where c.id = v_client),
    'clients', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name) from public.clients c where c.org_id = v_org), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'title', s.title, 'body', s.body, 'status', s.status, 'agencyNote', s.agency_note,
        'byClient', s.submitted_by_client, 'by', (select u.email from auth.users u where u.id = s.submitted_by), 'createdAt', s.created_at, 'decidedAt', s.decided_at,
        'job', (select jsonb_build_object('id', j.id, 'status', j.status) from public.jobs j where j.id = s.job_id)) order by s.created_at desc)
      from public.submissions s where s.site_id = p_site), '[]'::jsonb));
end;
$$;

drop function if exists public.review_submission(uuid, text, text, text, text);
create or replace function public.review_submission(p_submission uuid, p_decision text, p_note text default null, p_job_kind text default 'client_request', p_risk text default 'medium', p_budget_usd numeric default 0.5)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.submissions; j public.jobs;
begin
  select * into s from public.submissions where id = p_submission for update;
  if s.id is null or not private.is_member(s.org_id) then raise exception 'not allowed'; end if;
  if p_decision not in ('accepted', 'rejected', 'needs_clarification') then raise exception 'decision must be accepted, rejected or needs_clarification'; end if;
  if s.status in ('accepted', 'rejected') then raise exception 'submission already decided'; end if;
  if p_risk not in ('low', 'medium', 'high') then raise exception 'risk must be low, medium or high'; end if;
  if coalesce(p_budget_usd, 0) < 0 or p_budget_usd > 50 then raise exception 'budget must be between 0 and 50'; end if;
  if p_decision = 'accepted' then
    -- Always gated: accepting a request lets the SEO God work on it; nothing runs until the agency approves the job.
    insert into public.jobs (org_id, site_id, kind, title, source, priority, risk, requires_approval, inputs, budget_usd, created_by)
      values (s.org_id, s.site_id, p_job_kind, s.title, 'client_submission', 1, p_risk, true, jsonb_build_object('submission', s.id, 'untrusted', true), coalesce(p_budget_usd, 0), (select auth.uid()))
      returning * into j;
    insert into public.job_events (job_id, org_id, actor_kind, actor, to_status, note) values (j.id, j.org_id, 'user', (select auth.uid())::text, 'proposed', 'from client submission');
  end if;
  update public.submissions set status = p_decision, agency_note = nullif(trim(coalesce(p_note, '')), ''), decided_by = (select auth.uid()), decided_at = now(), job_id = j.id
    where id = s.id returning * into s;
  insert into public.audit_log (org_id, site_id, actor, action, target, data) values (s.org_id, s.site_id, (select auth.uid()), 'submission.' || p_decision, s.id::text, jsonb_build_object('job', j.id));
  return jsonb_build_object('id', s.id, 'status', s.status, 'job', j.id);
end;
$$;

create or replace function public.submission_for_job(p_job uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('kind', s.kind, 'title', s.title, 'body', s.body, 'byClient', s.submitted_by_client)
    from public.jobs j join public.submissions s on s.id = (j.inputs->>'submission')::uuid and s.site_id = j.site_id
   where j.id = p_job;
$$;

revoke all on function public.agency_inbox(uuid), public.review_submission(uuid, text, text, text, text, numeric), public.submission_for_job(uuid) from public, anon, authenticated;
grant execute on function public.agency_inbox(uuid), public.review_submission(uuid, text, text, text, text, numeric) to authenticated;
grant execute on function public.submission_for_job(uuid) to service_role;

-- An accepted client request (status "proposed") makes its site due at once, like an agency approval does, so the
-- scheduler sends it to the agency for approval within one run instead of waiting for the site's planning slot.
create or replace function public.god_due_sites(p_limit int default 5, p_min_age interval default interval '6 hours')
returns table (id uuid, org_id uuid, name text, url text) language sql stable security definer set search_path = '' as $$
  select s.id, s.org_id, s.name, s.url from public.sites s
    left join public.god_site_ticks t on t.site_id = s.id
   where s.status <> 'paused'
     and (t.ticked_at is null or t.ticked_at < now() - p_min_age
          or exists (select 1 from public.jobs j where j.site_id = s.id and j.status in ('authorized', 'proposed')))
   order by exists (select 1 from public.jobs j where j.site_id = s.id and j.status in ('authorized', 'proposed')) desc, t.ticked_at nulls first, s.created_at
   limit least(greatest(p_limit, 1), 50);
$$;
