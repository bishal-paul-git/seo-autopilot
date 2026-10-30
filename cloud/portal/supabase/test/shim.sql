-- Minimal stand-in for what Supabase provides, so the migration and rls.sql run on plain Postgres 16:
-- the API roles, auth.users and auth.uid() (read from the request.jwt.claim.sub setting, as Supabase does).
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('sub', auth.uid(), 'email', (select email from auth.users where id = auth.uid())) $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role; -- only so the auth.jwt() stand-in can read the email
-- Supabase grants table access to the API roles by default; the migration must take away what it does not want.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
