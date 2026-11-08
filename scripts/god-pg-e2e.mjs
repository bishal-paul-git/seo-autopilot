// End-to-end check of SEO God orchestration against the REAL database gates (the four portal migrations on a local
// Postgres 16), not the in-memory mirror. Two agencies' sites, planner → enqueue → worker → agency approval → completion,
// with the same store interface the worker uses in production (here through psql as the service role instead of
// PostgREST). Run as a database superuser: node scripts/god-pg-e2e.mjs   (needs psql, createdb; leaves nothing behind)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { planSite } from "../src/god/planner.mjs";
import { runOnce, enqueue } from "../src/god/worker.mjs";
import { tick } from "../src/god/tick.mjs";
import { makeHandlers } from "../src/god/handlers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const t = join(root, "cloud/portal/supabase/test"), m = join(root, "cloud/portal/supabase/migrations");
const DB = `god_e2e_${process.pid}`;
const psql = (sql, role = null) => execFileSync("psql", ["-qtAX", "-v", "ON_ERROR_STOP=1", "-d", DB], { input: (role ? `set role ${role}; set request.jwt.claim.role = '${role}';\n` : "") + sql, encoding: "utf8" }).trim();
const lit = (v) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const json = (v) => `${lit(JSON.stringify(v ?? {}))}::jsonb`;

/** The worker's store interface over the contract functions, called as the service role. */
const mapJob = (j) => (j && j.id ? { id: j.id, siteId: j.site_id, kind: j.kind, status: j.status, risk: j.risk, requiresApproval: j.requires_approval, attempts: j.attempts, maxAttempts: j.max_attempts, agent: j.agent, inputs: j.inputs, budgetUsd: Number(j.budget_usd ?? 0), costUsd: Number(j.cost_usd ?? 0), outputs: j.outputs ?? null, idempotencyKey: j.idempotency_key ?? null } : null);
const val = (sql) => { const out = psql(`select (${sql})::text;`, "service_role"); return out.split("\n").pop(); };
class PsqlStore {
  row(sql) { const out = psql(`select to_jsonb(r) from (${sql}) r;`, "service_role"); const r = out ? JSON.parse(out.split("\n").pop()) : null; return mapJob(r && (r.j || r)); }
  listJobs(site) { return JSON.parse(val(`select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.site_jobs(${lit(site)}::uuid) x`)).map(mapJob); }
  recordOutput(id, { outputs = null, costUsd = 0, note = null } = {}) { return this.row(`select public.record_job_output(${lit(id)}::uuid, ${outputs ? json(outputs) : "null"}, ${Number(costUsd) || 0}, ${lit(note)}) as j`); }
  spendSince(site, since) { return Number(val(`public.site_spend(${lit(site)}::uuid, ${lit(since)}::timestamptz)`)); }
  writeMemory(site, items) { return Number(val(`public.remember(${lit(site)}::uuid, ${lit(JSON.stringify(items))}::jsonb)`)); }
  readMemory(site, kind = null) { return JSON.parse(val(`public.recall(${lit(site)}::uuid, ${lit(kind)})`)); }
  listSites() { return JSON.parse(val(`select coalesce(jsonb_agg(to_jsonb(g)), '[]') from public.god_sites() g`)); }
  createJob(s) { return this.row(`select public.create_job(${lit(s.siteId)}::uuid, ${lit(s.kind)}, ${lit(s.title)}, ${lit(s.source || "seo_god")}, ${lit(s.risk || "low")}, ${!!s.requiresApproval}, ${s.priority || 3}, ${json(s.inputs)}, ${lit(s.idempotencyKey)}, ${lit(s.why)}) as j`); }
  claimJob(w) { return this.row(`select public.claim_job(${lit(w)}) as j`); }
  transition(id, to, actor, note = null) { return this.row(`select public.transition_job(${lit(id)}::uuid, ${lit(to)}, ${lit(actor)}, ${lit(note)}) as j`); }
  recordReview(id, rv) { psql(`select public.record_review(${lit(id)}::uuid, ${lit(rv.reviewer)}, ${lit(rv.verdict)}, ${lit((rv.reasons || []).join("; "))});`, "service_role"); }
  failJob(id, actor, err) { return this.row(`select public.fail_job(${lit(id)}::uuid, ${lit(actor)}, ${lit(err)}) as j`); }
}

const check = (ok, msg) => { if (!ok) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };
try { execFileSync("psql", ["-qd", "postgres", "-c", "drop role if exists anon, authenticated, service_role"], { stdio: "ignore" }); } catch { /* roles still owned by another test database */ }
execFileSync("createdb", [DB]);
try {
  const strip = (f) => readFileSync(f, "utf8").replace(/^create extension if not exists pg_(net|cron);$/gm, "");
  psql([readFileSync(join(t, "shim.sql"), "utf8"), readFileSync(join(m, "20261030000000_portal.sql"), "utf8"), readFileSync(join(m, "20261030120000_portal_approvals_team_brand.sql"), "utf8"),
    readFileSync(join(t, "shim3.sql"), "utf8"), strip(join(m, "20261104000000_portal_url_sites.sql")), readFileSync(join(t, "shim4.sql"), "utf8"), readFileSync(join(m, "20261108000000_r1_contracts.sql"), "utf8"),
    readFileSync(join(m, "20261108010000_r1_memory.sql"), "utf8"), readFileSync(join(m, "20261108020000_r1_scheduler.sql"), "utf8"),
    readFileSync(join(m, "20261108090000_strategy_draft.sql"), "utf8")].join("\n"));
  psql(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'alice@a.test'), ('00000000-0000-0000-0000-00000000000b', 'bob@b.test');`);
  const site = (user, name, url) => JSON.parse(psql(`set role authenticated; set request.jwt.claim.sub = '${user}'; set request.jwt.claim.role = 'authenticated'; select public.create_site(${lit(name)}, ${lit(url)})->'site';`).split("\n").pop()).id;
  const A = site("00000000-0000-0000-0000-00000000000a", "Plumber", "https://plumber.test/"), B = site("00000000-0000-0000-0000-00000000000b", "Bakery", "https://bakery.test/");
  const store = new PsqlStore(), now = new Date().toISOString();
  for (const id of [A, B]) await enqueue(store, id, planSite({ site: { id }, reports: {}, strategy: { status: "none" }, now }));
  await enqueue(store, A, planSite({ site: { id: A }, reports: {}, strategy: { status: "none" }, now }));
  check(Number(psql("select count(*) from public.jobs")) === 4, "planned twice for site A: still 2 jobs per site (idempotent in the database)");
  // D35: the scan runs, the strategy is drafted at once from it (no approval to start), and waits for the agency to adopt it.
  const sites = store.listSites().map((x) => ({ id: x.id, name: x.name, url: x.url }));
  const fakeScan = async (x) => ({ discovered: { name: { value: x.name, source: x.url }, phones: [], emails: [], addresses: [], hours: [], socials: [], topics: [] }, profile: { platform: { name: "WordPress" } }, audit: { generatedAt: new Date().toISOString(), summary: { pagesCrawled: 4 }, issues: [{ rule: "title-missing", severity: "high", url: x.url + "x" }], pages: [] }, snapshot: {} });
  const gh = makeHandlers({ store, siteOf: async (id) => sites.find((x) => x.id === id), scan: fakeScan });
  const seen = [];
  const handlers = { ...gh, scan: async (job) => { seen.push(job.siteId); return gh.scan(job); } };
  const r = []; for (let i = 0; i < 5; i++) r.push(await runOnce({ store, handlers }));
  check(r.slice(0, 4).map((x) => x?.outcome).sort().join() === "awaiting_approval,awaiting_approval,completed,completed" && r[4] === null, "both scans completed, both drafts made and sent to the agency; nothing else ran");
  check(seen.sort().join() === [A, B].sort().join(), "each scan ran for its own site");
  check(psql("select string_agg(status, ',' order by status) from public.jobs where kind = 'strategy_proposal'") === "awaiting_approval,awaiting_approval", "strategy drafts wait for the agency in the database");
  check(psql(`select outputs->'proposal'->>'approval' from public.jobs where kind = 'strategy_proposal' and site_id = ${lit(A)}`) === "agency", "the drafted strategy is stored on the job for the agency to read");
  let refused = ""; try { psql(`select public.transition_job((select id from public.jobs where kind = 'strategy_proposal' and site_id = ${lit(A)}), 'authorized', 'worker-1');`, "service_role"); } catch (e) { refused = String(e.stderr || e.message); }
  check(/only an agency approval/.test(refused), "the worker cannot adopt its own draft, although drafting needed no approval");
  let crossed = ""; try { psql(`set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b'; set request.jwt.claim.role = 'authenticated'; select public.approve_job((select id from public.jobs where kind = 'strategy_proposal' and site_id = ${lit(A)}), 'approve');`); } catch (e) { crossed = String(e.stderr || e.message); }
  check(/not allowed/.test(crossed), "agency B cannot approve agency A's strategy");
  const ok = psql(`set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; set request.jwt.claim.role = 'authenticated'; select (public.approve_job((select id from public.jobs where kind = 'strategy_proposal' and site_id = ${lit(A)}), 'approve', 'adopt')).status;`).split("\n").pop();
  check(ok === "authorized", "agency A adopts its own strategy");
  // Agency B asks for changes to its draft: the scheduler redrafts it and sends it back.
  psql(`set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b'; set request.jwt.claim.role = 'authenticated'; select public.approve_job((select id from public.jobs where kind = 'strategy_proposal' and site_id = ${lit(B)}), 'request_changes', 'we answered your questions');`);
  check(Number(psql("select count(*) from public.audit_log where action = 'job.approve'")) >= 1 && Number(psql("select count(*) from public.job_events")) >= 12, "every move and every decision are recorded");

  const t1 = await tick({ store, sites, handlers: gh });
  check(t1.sites.find((x) => x.site === A).strategy === "approved" && psql(`select status from public.jobs where kind = 'strategy_proposal' and site_id = ${lit(A)}`) === "completed", "one approval: strategy adopted, job completed");
  check(store.readMemory(A, "strategy")[0].value.status === "approved", "site memory: A approved");
  check(t1.sites.find((x) => x.site === B).moved.some((mv) => mv.to === "queued") && psql(`select status from public.jobs where kind = 'strategy_proposal' and site_id = ${lit(B)}`) === "awaiting_approval", "site B: changes requested, redrafted, back with its own agency");
  check(t1.sites.find((x) => x.site === B).strategy === "proposed", "site B still has no adopted strategy");
  console.log("all orchestration checks passed against the database");
} finally { execFileSync("dropdb", ["--if-exists", DB]); }
