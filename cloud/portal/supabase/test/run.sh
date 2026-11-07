#!/usr/bin/env bash
# Runs every portal SQL check on a throwaway local Postgres 16 database: bash cloud/portal/supabase/test/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=portal_test_$$
psql -q -d postgres -c "drop role if exists anon, authenticated, service_role" >/dev/null 2>&1 || true  # roles are cluster-wide; shim.sql creates them
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
p() { psql -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
# One session: rls2.sql reads temporary tables that rls.sql creates.
p -f shim.sql -f ../migrations/20261030000000_portal.sql -f rls.sql \
  -f ../migrations/20261030120000_portal_approvals_team_brand.sql -f rls2.sql \
  -f shim3.sql -f <(grep -v '^create extension if not exists pg_\(net\|cron\);' ../migrations/20261104000000_portal_url_sites.sql) -f rls3.sql \
  -f shim4.sql -f ../migrations/20261108000000_r1_contracts.sql -f rls4.sql
