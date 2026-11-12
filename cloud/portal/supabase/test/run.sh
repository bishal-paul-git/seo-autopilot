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
  -f shim4.sql -f ../migrations/20261108000000_r1_contracts.sql -f rls4.sql \
  -f ../migrations/20261108010000_r1_memory.sql -f rls5.sql \
  -f ../migrations/20261108020000_r1_scheduler.sql -f rls6.sql \
  -f ../migrations/20261108030000_cloudflare_execution.sql -f rls7.sql \
  -f ../migrations/20261108040000_agency_console.sql -f rls8.sql \
  -f ../migrations/20261108050000_client_portal.sql -f rls9.sql \
  -f ../migrations/20261108060000_learning.sql -f rls10.sql \
  -f ../migrations/20261108070000_operations.sql -f rls11.sql \
  -f ../migrations/20261108080000_security_fixes.sql -f rls12.sql \
  -f ../migrations/20261108090000_strategy_draft.sql -f rls13.sql \
  -f ../migrations/20261108100000_invite_only.sql -f rls14.sql \
  -f shim5.sql -f ../migrations/20261108110000_github_execution.sql -f ../migrations/20261108120000_notifications_reports.sql \
  -f ../migrations/20261108130000_email.sql \
  -f rls15.sql -f rls16.sql -f rls17.sql -f rls18.sql \
  -f ../migrations/20261112000000_activity.sql -f rls19.sql \
  -f ../migrations/20261113000000_business_brief.sql -f rls20.sql \
  -f ../migrations/20261114000000_agent_pages.sql -f rls21.sql \
  -f ../migrations/20261115000000_gsc_sites.sql -f rls22.sql \
  -f ../migrations/20261116000000_budgets_alerts.sql -f rls23.sql
