-- auth.role() as Supabase provides it (the JWT's role claim), for the R1 contracts checks.
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
grant execute on function auth.role() to anon, authenticated, service_role;
