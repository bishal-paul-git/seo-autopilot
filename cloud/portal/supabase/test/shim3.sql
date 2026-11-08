-- Stand-ins for pg_net, pg_cron and Vault, so the D25 migration runs on plain Postgres 16 (after shim.sql). The test
-- runner removes the migration's two "create extension" lines; everything else runs unchanged.
create extension if not exists pgcrypto;
create schema if not exists extensions;
create schema net; create table net.calls (id bigserial primary key, url text, headers jsonb, body jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net.calls (url, headers, body) values (url, headers, body) returning id $$;
create schema cron; create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(name text, sched text, cmd text) returns bigint language sql as $$ insert into cron.job values (name, sched, cmd) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
create schema vault; create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
insert into vault.decrypted_secrets values ('scan_url', 'https://ref.supabase.co/functions/v1/scan'), ('scan_secret', 'test-secret');
