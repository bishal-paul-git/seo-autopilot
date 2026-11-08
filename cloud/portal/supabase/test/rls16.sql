-- Verified execution through GitHub (20261108110000_github_execution.sql, D37). Run after rls15.sql.
\set ON_ERROR_STOP on
-- A completed advice result on Alice's site (fixture written directly: how it got there is covered elsewhere).
with x as (
  insert into public.jobs (org_id, site_id, kind, title, source, status, risk, outputs)
  values ((select org_id from public.sites where id = (select v from ids where k = 'alice_site')), (select v from ids where k = 'alice_site'), 'agent:title-tuner', 'Fix titles', 'seo_god', 'completed', 'low',
    '{"proposal": {"recommendations": [{"title": "Shorten the home page title", "url": "https://plumber.test/", "why": "61 characters", "evidence": ["audit: title-too-long"], "effort": "small"}]}}')
  returning id)
insert into ids select 'advice_done', id from x;

-- Members cannot connect GitHub (owner only); outsiders and clients cannot either; bad input is refused.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b'; set request.jwt.claim.role = 'authenticated';
do $$ begin
  begin perform public.connect_github((select v from ids where k = 'alice_site'), 'acme/site', 'github_pat_' || repeat('x', 30)); raise exception 'another agency connected GitHub';
  exception when raise_exception then if sqlerrm not like 'only an owner%' then raise; end if; end;
  begin perform public.site_integrations((select v from ids where k = 'alice_site')); raise exception 'another agency read integrations';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ begin
  begin perform public.request_implementation((select v from ids where k = 'advice_done'), 0); raise exception 'implementation without GitHub';
  exception when raise_exception then if sqlerrm <> 'connect GitHub for this website first' then raise; end if; end;
  begin perform public.connect_github((select v from ids where k = 'alice_site'), 'not a repo', 'github_pat_' || repeat('x', 30)); raise exception 'bad repo accepted';
  exception when raise_exception then if sqlerrm not like 'repository must%' then raise; end if; end;
  begin perform public.connect_github((select v from ids where k = 'alice_site'), '../etc', 'github_pat_' || repeat('x', 30)); raise exception 'dot path accepted';
  exception when raise_exception then if sqlerrm not like 'repository must%' then raise; end if; end;
  begin perform public.connect_github((select v from ids where k = 'alice_site'), 'acme/site', 'short'); raise exception 'bad token accepted';
  exception when raise_exception then if sqlerrm not like 'that does not look%' then raise; end if; end;
  -- The owner connects; the answer never contains the token.
  assert (public.connect_github((select v from ids where k = 'alice_site'), 'acme/plumber-site', 'github_pat_' || repeat('a', 30)))::text not like '%github_pat%', 'token not echoed';
  assert (public.site_integrations((select v from ids where k = 'alice_site')))::text not like '%github_pat%', 'token not shown to members';
  assert (public.site_integrations((select v from ids where k = 'alice_site')))->0->>'repo' = 'acme/plumber-site';
  -- Members cannot read the token from tables or the service function.
  begin perform public.github_target((select v from ids where k = 'alice_site')); raise exception 'member read the token';
  exception when insufficient_privilege then null; end;
  begin perform 1 from vault.decrypted_secrets; raise exception 'member read the vault';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- The Worker (service role) gets repository and token for a connected site.
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ declare t jsonb := public.github_target((select v from ids where k = 'alice_site')); begin
  assert t->>'repo' = 'acme/plumber-site' and t->>'token' = 'github_pat_' || repeat('a', 30), 'service gets the target';
  assert public.github_target((select v from ids where k = 'bob_site')) is null, 'no target for an unconnected site';
  perform public.record_integration_status((select v from ids where k = 'alice_site'), 'github', false, 'Bad credentials');
end $$;
reset role;
-- Members see the error; reconnecting replaces the token in place (one secret per site).
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ declare r jsonb; begin
  r := public.site_integrations((select v from ids where k = 'alice_site'))->0;
  assert r->>'status' = 'error' and r->>'lastError' = 'Bad credentials', 'error visible';
  perform public.connect_github((select v from ids where k = 'alice_site'), 'acme/plumber-site', 'github_pat_' || repeat('b', 30));
end $$;
reset role;
do $$ begin
  assert (select count(*) from vault.secrets where name like 'github_token:%') = 1, 'one secret per site';
  assert (select decrypted_secret from vault.decrypted_secrets where name like 'github_token:%') = 'github_pat_' || repeat('b', 30), 'replaced';
  assert (select count(*) from public.audit_log where action = 'integration.connect') = 2, 'connections audited';
end $$;
-- Requesting implementation drafts an ungated work-order job, once per recommendation; bad requests are refused.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
do $$ declare j public.jobs; j2 public.jobs; begin
  j := public.request_implementation((select v from ids where k = 'advice_done'), 0);
  assert j.kind = 'implement' and not j.requires_approval and j.status = 'proposed' and j.risk = 'medium', 'drafting is ungated';
  assert j.inputs->'recommendation'->>'title' = 'Shorten the home page title' and (j.inputs->>'sourceJob')::uuid = (select v from ids where k = 'advice_done');
  j2 := public.request_implementation((select v from ids where k = 'advice_done'), 0);
  assert j2.id = j.id, 'idempotent';
  begin perform public.request_implementation((select v from ids where k = 'advice_done'), 5); raise exception 'missing recommendation accepted';
  exception when raise_exception then if sqlerrm <> 'no such recommendation' then raise; end if; end;
  begin perform public.request_implementation((select id from public.jobs where site_id = (select v from ids where k = 'alice_site') and status <> 'completed' limit 1), 0); raise exception 'unfinished job accepted';
  exception when raise_exception then if sqlerrm <> 'only accepted advice can be implemented' then raise; end if; end;
end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b'; set request.jwt.claim.role = 'authenticated';
do $$ begin
  begin perform public.request_implementation((select v from ids where k = 'advice_done'), 0); raise exception 'another agency requested implementation';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
reset role;
-- Disconnecting removes the token; the Worker then has no target.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated';
select public.disconnect_github((select v from ids where k = 'alice_site'));
reset role;
do $$ begin
  assert not exists (select 1 from vault.decrypted_secrets where name like 'github_token:%'), 'token deleted';
  assert (select status from public.integrations where provider = 'github') = 'revoked';
end $$;
set role service_role; set request.jwt.claim.role = 'service_role';
do $$ begin assert public.github_target((select v from ids where k = 'alice_site')) is null, 'no target after disconnect'; end $$;
reset role;
\echo all GitHub execution checks passed
