-- Vault write functions as Supabase provides them (for the GitHub execution checks). Local stand-in only: real Vault
-- encrypts at rest; here the secret is stored in the test table that vault.decrypted_secrets already stands in for.
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text);
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into vault.secrets (name, description) values (new_name, new_description) returning id into v;
  insert into vault.decrypted_secrets (name, decrypted_secret) values (new_name, new_secret);
  return v;
end $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null)
returns void language plpgsql as $$
begin
  update vault.decrypted_secrets set decrypted_secret = coalesce(new_secret, decrypted_secret) where name = (select name from vault.secrets where id = secret_id);
end $$;
create or replace function vault.on_secret_delete() returns trigger language plpgsql as $$
begin delete from vault.decrypted_secrets where name = old.name; return old; end $$;
create trigger secrets_delete after delete on vault.secrets for each row execute function vault.on_secret_delete();
