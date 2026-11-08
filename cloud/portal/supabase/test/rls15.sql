-- Tenant isolation, exhaustively (Gate E). Every public function a signed-in user or an anonymous visitor may call is
-- called as an outsider: Mallory, the owner of her own new agency, and anon. Every uuid argument is aimed at agency A's
-- records (its org, sites, clients, jobs, submissions), with several values for text arguments so input validation
-- does not hide a missing ownership check. A call fails the test if its result mentions any of agency A's ids or site
-- addresses, or if it changes any of agency A's rows. Each call is rolled back. New functions are covered
-- automatically. Run after rls14.sql.
\set ON_ERROR_STOP on
set role service_role; set request.jwt.claim.role = 'service_role';
select public.set_invite_only(false);
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'mallory@outsider.test');
set role service_role; set request.jwt.claim.role = 'service_role';
select public.set_invite_only(true);
reset role;

do $$
declare
  victim uuid := (select m.org_id from public.org_members m where m.user_id = '00000000-0000-0000-0000-00000000000a' and m.role = 'owner' order by m.created_at limit 1);
  mallory_org uuid := (select org_id from public.org_members where user_id = '00000000-0000-0000-0000-0000000000f1');
  sums text := '';            -- one checksum query over all of agency A's rows
  tokens text[] := '{}';      -- agency A's ids and addresses: none may appear in an outsider's result
  cands uuid[] := '{}';       -- values tried for uuid arguments
  r record; f record; who text; v uuid; tv text; args text; call text; res text; before text; after text;
  calls int := 0; refused int := 0; findings text[] := '{}';
begin
  assert victim is not null and mallory_org is not null and victim <> mallory_org, 'fixtures';
  -- Agency A's rows: tables with org_id directly, and tables with site_id for A's sites.
  for r in select c.table_name, bool_or(c.column_name = 'org_id') has_org, bool_or(c.column_name = 'site_id') has_site, bool_or(c.column_name = 'id' and c.data_type = 'uuid') uuid_id
           from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
           where c.table_schema = 'public' group by c.table_name loop
    if r.table_name = 'orgs' then
      sums := sums || format(' || coalesce((select md5(string_agg(row_to_json(t)::text, '','' order by row_to_json(t)::text)) from public.orgs t where id = %L), '''')', victim);
    elsif r.has_org then
      sums := sums || format(' || coalesce((select md5(string_agg(row_to_json(t)::text, '','' order by row_to_json(t)::text)) from public.%I t where org_id = %L), '''')', r.table_name, victim);
      if r.uuid_id then execute format('select coalesce(array_agg(id), ''{}'') from public.%I where org_id = %L', r.table_name, victim) into strict cands; tokens := tokens || cands::text[]; end if;
    elsif r.has_site then
      sums := sums || format(' || coalesce((select md5(string_agg(row_to_json(t)::text, '','' order by row_to_json(t)::text)) from public.%I t where site_id in (select id from public.sites where org_id = %L)), '''')', r.table_name, victim);
    end if;
  end loop;
  sums := 'select ''''' || sums;
  select coalesce(array_agg(x), '{}') into tokens from (select distinct unnest(tokens || array[victim::text] || array(select url from public.sites where org_id = victim)) x) s;
  select coalesce(array_agg(x::uuid), '{}') into cands from unnest(tokens) x where x ~ '^[0-9a-f-]{36}$';
  assert array_length(cands, 1) >= 8, 'agency A has records to aim at: ' || coalesce(array_length(cands, 1), 0);
  execute sums into before;

  for f in select p.oid, p.proname, p.pronargs, p.proargtypes::oid[] types,
                  has_function_privilege('authenticated', p.oid, 'execute') auth_ok, has_function_privilege('anon', p.oid, 'execute') anon_ok
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.proargmodes is null and p.prorettype <> 'trigger'::regtype
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
           order by p.proname loop
    foreach who in array array['mallory', 'anon'] loop
      continue when (who = 'mallory' and not f.auth_ok) or (who = 'anon' and not f.anon_ok);
      foreach v in array (case when 'uuid'::regtype = any(f.types) or 'uuid[]'::regtype = any(f.types) then cands else array[null::uuid] end) loop
        foreach tv in array array['approve', 'strategy_proposal', 'x'] loop
          select string_agg(case t
                   when 'uuid'::regtype then quote_literal(v) || '::uuid'
                   when 'uuid[]'::regtype then quote_literal(array[v]) || '::uuid[]'
                   when 'text'::regtype then quote_literal(tv)
                   when 'jsonb'::regtype then '''{}''::jsonb'
                   when 'json'::regtype then '''{}''::json'
                   when 'boolean'::regtype then 'false'
                   when 'integer'::regtype then '1'
                   when 'bigint'::regtype then '1'
                   when 'numeric'::regtype then '0'
                   when 'interval'::regtype then '''1 hour''::interval'
                   when 'timestamp with time zone'::regtype then '''2026-01-01''::timestamptz'
                   else 'null::' || format_type(t, null) end, ', ' order by i)
            into args from unnest(f.types) with ordinality u(t, i);
          call := format('select (public.%I(%s))::text', f.proname, coalesce(args, ''));
          calls := calls + 1;
          begin
            if who = 'mallory' then
              perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
              perform set_config('request.jwt.claim.role', 'authenticated', true);
              set local role authenticated;
            else
              perform set_config('request.jwt.claim.sub', '', true);
              perform set_config('request.jwt.claim.role', 'anon', true);
              set local role anon;
            end if;
            execute call into res;
            reset role;
            execute sums into after;
            if after is distinct from before then findings := findings || format('%s as %s changed agency A''s data: %s', f.proname, who, call); end if;
            if res is not null and exists (select 1 from unnest(tokens) k where position(k in res) > 0) then
              findings := findings || format('%s as %s returned agency A''s data: %s', f.proname, who, call);
            end if;
            raise exception 'undo';
          exception when others then
            if sqlerrm <> 'undo' then refused := refused + 1; end if;
          end;
          reset role;
          exit when not ('text'::regtype = any(f.types));
        end loop;
      end loop;
    end loop;
  end loop;
  execute sums into after;
  assert after = before, 'agency A unchanged after the run';
  if array_length(findings, 1) > 0 then raise exception E'tenant isolation failures:\n%', array_to_string(findings, E'\n'); end if;
  raise notice 'tenant isolation: % outsider calls to % functions, % refused, none returned or changed agency A''s data', calls,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')) and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')), refused;
end $$;
\echo all tenant isolation checks passed
