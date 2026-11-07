-- Checks for the D25 migration (sites added by address): validation, limits, tenant boundaries, the wake-up call, and
-- the service-only claim and store functions. Run after rls.sql and rls2.sql, with shim3.sql loaded before the migration.
\set ON_ERROR_STOP on
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare v jsonb; begin
  v := public.add_site_by_url('HTTPS://WWW.Example.COM/Path/Page');
  assert v->>'url' = 'https://www.example.com/Path/Page', 'host lower-cased, path kept: ' || (v->>'url');
  assert v->>'mode' = 'url' and v->>'status' = 'scanning' and v->>'scan_state' = 'queued', 'queued for a scan';
  assert v->>'name' = 'example.com', 'name from the host';
  assert (public.add_site_by_url('https://shop.example.org', 'Shop')->>'url') = 'https://shop.example.org/', 'trailing slash added';
  begin perform public.add_site_by_url('https://www.example.com/Path/Page'); raise exception 'duplicate accepted'; exception when raise_exception then if sqlerrm not like 'that website is already%' then raise; end if; end;
  begin perform public.add_site_by_url('http://example.net/'); raise exception 'http accepted'; exception when raise_exception then if sqlerrm not like 'use the public%' then raise; end if; end;
  begin perform public.add_site_by_url('https://127.0.0.1/'); raise exception 'ip accepted'; exception when raise_exception then if sqlerrm not like 'use the public%' then raise; end if; end;
  begin perform public.add_site_by_url('https://localhost/'); raise exception 'localhost accepted'; exception when raise_exception then if sqlerrm not like 'use the public%' then raise; end if; end;
  begin perform public.add_site_by_url('https://db.internal/'); raise exception 'internal accepted'; exception when raise_exception then if sqlerrm not like 'use the public%' then raise; end if; end;
  begin perform public.add_site_by_url('https://a.com:8443/'); raise exception 'port accepted'; exception when raise_exception then if sqlerrm not like 'use the public%' then raise; end if; end;
  -- A member editing the url column directly cannot point an address-only site at a private host.
  begin update public.sites set url = 'https://169.254.169.254/' where name = 'Shop'; raise exception 'private url via update'; exception when check_violation then null; end;
end $$;
reset role;
do $$ begin assert (select count(*) from net.calls) = 2, 'each add wakes the scanner once'; assert (select headers->>'x-scan-secret' from net.calls limit 1) = 'test-secret', 'secret header'; end $$;

-- Bob (agency B) cannot see, scan or claim Alice's sites.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from public.sites where mode = 'url') = 0, 'bob sees no url sites of agency A';
  begin perform public.scan_now((select id from public.sites limit 1)); raise exception 'bob scanned'; exception when raise_exception then if sqlerrm <> 'not found' then raise; end if; end;
  begin perform public.claim_scan(); raise exception 'bob claimed'; exception when insufficient_privilege then null; end;
  begin perform public.finish_scan(gen_random_uuid(), '{}'::jsonb); raise exception 'bob stored'; exception when insufficient_privilege then null; end;
  begin perform public.scan_secret_ok('test-secret'); raise exception 'bob read secret'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin begin perform public.add_site_by_url('https://x.example/'); raise exception 'anon added'; exception when insufficient_privilege then null; end; end $$;
reset role;

-- The scan function (service role): secret check, claim one site at a time, store, schedule the next day.
set role service_role;
do $$ declare a jsonb; b jsonb; c jsonb; begin
  assert public.scan_secret_ok('test-secret') and not public.scan_secret_ok('nope'), 'secret check';
  a := public.claim_scan(); b := public.claim_scan(); c := public.claim_scan();
  assert a is not null and b is not null and c is null and a->>'id' <> b->>'id', 'two due sites, claimed once each';
  assert (public.finish_scan((a->>'id')::uuid, '{"version":1}'::jsonb)->>'ok')::boolean, 'stored';
  assert not (public.finish_scan((b->>'id')::uuid, null, 'could not read')->>'ok')::boolean, 'failure recorded';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.sites where mode = 'url' and status = 'live' and scan_state = 'done' and next_scan_at > now() + interval '23 hours') = 1, 'live, next scan tomorrow';
  assert (select count(*) from public.sites where mode = 'url' and scan_state = 'failed' and scan_error = 'could not read' and next_scan_at > now() + interval '5 hours') = 1, 'failed, retry in 6 hours';
  assert (select count(*) from cron.job where jobname = 'seo-autopilot-scan' and schedule = '*/10 * * * *') = 1, 'cron scheduled';
end $$;

-- Scan now: refused within 30 minutes of a scan; then queues and wakes the scanner.
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  begin perform public.scan_now((select id from public.sites where status = 'live' and mode = 'url')); raise exception 'rescanned too soon'; exception when raise_exception then if sqlerrm not like 'scanned less than%' then raise; end if; end;
  assert (public.scan_now((select id from public.sites where scan_state = 'failed'))->>'state') = 'queued', 'failed site can be rescanned';
end $$;
reset role;
select 'all address-only site checks passed' as result;
