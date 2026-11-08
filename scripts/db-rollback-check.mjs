#!/usr/bin/env node
// Release 1 rollback check on a throwaway local Postgres (no production access). Builds the schema production has today
// (the two portal migrations), applies the Release 1 chain, runs cloud/portal/supabase/rollback/release-1.sql and checks
// that the catalog is back to the original exactly; then applies the chain again, as a redeploy after a rollback would.
//   node scripts/db-rollback-check.mjs            (default chain)       node scripts/db-rollback-check.mjs --diff (list changes)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const R = fileURLToPath(new URL("..", import.meta.url));
const M = R + "cloud/portal/supabase/migrations/", T = R + "cloud/portal/supabase/test/";
export const CHAIN = ["20261108000000_r1_contracts.sql", "20261108010000_r1_memory.sql", "20261108020000_r1_scheduler.sql", "20261108030000_cloudflare_execution.sql", "20261108040000_agency_console.sql", "20261108050000_client_portal.sql", "20261108060000_learning.sql", "20261108070000_operations.sql", "20261108080000_security_fixes.sql", "20261108090000_strategy_draft.sql", "20261108100000_invite_only.sql", "20261108110000_github_execution.sql", "20261108120000_notifications_reports.sql"];
const { existsSync } = await import("node:fs");
const chain = CHAIN.filter((f) => existsSync(M + f));
const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: "utf8", ...o });
const psql = (db, sql) => sh("psql", ["-qAtX", "-v", "ON_ERROR_STOP=1", "-d", db], { input: sql });
const strip = (f) => readFileSync(f, "utf8").replace(/^create extension if not exists pg_(net|cron);$/gm, "");
const BASE = [T + "shim.sql", M + "20261030000000_portal.sql", M + "20261030120000_portal_approvals_team_brand.sql"];
const FULL = [T + "shim3.sql", "!" + M + "20261104000000_portal_url_sites.sql", T + "shim4.sql", ...chain.map((f) => M + f)];
const CAT = `select json_build_object(
 'tables', (select json_agg(n.nspname||'.'||c.relname||':'||c.relkind::text order by 1) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v','m','S')),
 'columns', (select json_agg(table_schema||'.'||table_name||'.'||column_name||' '||data_type||' '||coalesce(column_default,'')||' '||is_nullable order by 1) from information_schema.columns where table_schema in ('public','private')),
 'constraints', (select json_agg(conrelid::regclass||'.'||conname||' '||md5(pg_get_constraintdef(oid)) order by 1) from pg_constraint where connamespace in ('public'::regnamespace,'private'::regnamespace)),
 'indexes', (select json_agg(schemaname||'.'||indexname order by 1) from pg_indexes where schemaname in ('public','private')),
 'triggers', (select json_agg(tgrelid::regclass||'.'||tgname||' '||tgfoid::regproc order by 1) from pg_trigger where not tgisinternal),
 'functions', (select json_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||md5(regexp_replace(p.prosrc,'\\s+','','g'))||' '||coalesce(p.proacl::text,'') order by 1) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and not exists (select 1 from pg_depend dp where dp.objid=p.oid and dp.deptype='e')),
 'policies', (select json_agg(schemaname||'.'||tablename||'.'||policyname||' '||md5(coalesce(qual,'')||coalesce(with_check,'')) order by 1) from pg_policies),
 'acl', (select json_agg(n.nspname||'.'||c.relname||' '||coalesce(c.relacl::text,'') order by 1) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v')),
 'types', (select json_agg(n.nspname||'.'||t.typname order by 1) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','private') and t.typtype in ('e','c','d') and not exists (select 1 from pg_depend dp where dp.objid=t.oid and dp.deptype='e') and not exists (select 1 from pg_class c where c.reltype=t.oid)),
 'rls', (select json_agg(n.nspname||'.'||c.relname||' '||c.relrowsecurity::text order by 1) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r')
)`;
const mk = (db, files) => {
  try { sh("dropdb", ["--if-exists", db]); } catch {}
  sh("createdb", [db]);
  psql(db, files.map((f) => f.startsWith("!") ? strip(f.slice(1)) : readFileSync(f, "utf8")).join("\n"));
};
const snap = (db) => JSON.parse(psql(db, CAT));
try { sh("psql", ["-qd", "postgres", "-c", "drop role if exists anon, authenticated, service_role"]); } catch {}
mk("cd_base", BASE); const base = snap("cd_base");
sh("dropdb", ["cd_base"]); try { sh("psql", ["-qd", "postgres", "-c", "drop role if exists anon, authenticated, service_role"]); } catch {}
mk("cd_full", [...BASE, ...FULL]); const full = snap("cd_full");
const diff = (a, b) => { const out = {}; for (const k of Object.keys(a)) { const A = new Set(a[k] || []), B = new Set(b[k] || []); const add = [...B].filter((x) => !A.has(x)), rem = [...A].filter((x) => !B.has(x)); if (add.length || rem.length) out[k] = { add, rem }; } return out; };
let failed = false;
if (process.argv.includes("--diff")) console.log(JSON.stringify(diff(base, full), null, 1));
else {
  psql("cd_full", readFileSync(R + "cloud/portal/supabase/rollback/release-1.sql", "utf8"));
  const d = diff(base, snap("cd_full"));
  if (Object.keys(d).length) { failed = true; console.log("not ok - rollback leaves differences:\n" + JSON.stringify(d, null, 1)); }
  else console.log(`ok - after ${chain.length + 1} migrations, the rollback restores the original catalog exactly`);
  psql("cd_full", FULL.slice(1).map((f) => f.startsWith("!") ? strip(f.slice(1)) : readFileSync(f, "utf8")).join("\n"));
  const again = diff(full, snap("cd_full"));
  if (Object.keys(again).length) { failed = true; console.log("not ok - re-applying after rollback differs:\n" + JSON.stringify(again, null, 1)); }
  else console.log("ok - the chain applies again cleanly after the rollback");
}
sh("dropdb", ["cd_full"]);
process.exit(failed ? 1 : 0);
