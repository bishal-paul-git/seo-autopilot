// Hourly health check of the hosted SEO God (D41). Reads the Worker's run log (public.god_runs) with the service role and
// says whether the scheduler is alive and clean. Used by .github/workflows/god-health.yml, which opens (or closes) one
// GitHub issue labelled seo-god-health, so failures are seen without email. Prints no secrets and no client data: only
// run ids, times, counts and the Worker's own error strings (already capped at 200 characters each).
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/god-health.mjs [--json]

/** Pure: health of the scheduler from its latest runs (newest first). The cron runs every 15 minutes. */
export function assessHealth(runs, now = Date.now(), { staleMinutes = 40, window = 4 } = {}) {
  const problems = [];
  const latest = runs[0];
  if (!latest) return { ok: false, problems: ["no run recorded yet"], latest: null, paused: null };
  const age = Math.round((now - Date.parse(latest.started_at)) / 60000);
  if (age > staleMinutes) problems.push(`no run for ${age} minutes (the cron runs every 15)`);
  const recent = runs.slice(0, window);
  const failing = recent.filter((r) => (r.errors || []).length);
  // One bad run can be a passing hiccup (a site that timed out); the same trouble in every recent run is not.
  if (recent.length >= 2 && failing.length === recent.length) problems.push(`errors in all ${recent.length} latest runs: ${[...new Set(failing.flatMap((r) => r.errors))].slice(0, 5).join(" | ")}`);
  if (latest.finished_at == null) problems.push(`run ${latest.id} has not finished`);
  return { ok: problems.length === 0, problems, latest: { id: latest.id, startedAt: latest.started_at, ageMinutes: age, sitesPlanned: latest.sites_planned, jobsRun: latest.jobs_run, errors: latest.errors || [] }, paused: !!latest.paused };
}

/** Markdown for the issue body and the job summary. */
export function report(h) {
  const l = h.latest;
  return [
    `**SEO God health: ${h.ok ? "OK" : "PROBLEM"}**${h.paused ? " (paused)" : ""}`,
    "",
    ...(h.problems.length ? ["Problems:", ...h.problems.map((p) => `- ${p}`), ""] : []),
    l ? `Latest run ${l.id} started ${l.startedAt} (${l.ageMinutes} min ago): ${l.sitesPlanned} site(s) planned, ${l.jobsRun} job(s) run, ${l.errors.length} error(s).` : "No runs recorded.",
    "",
    "Run log: `select * from public.god_runs order by id desc limit 10;` in the Supabase SQL editor. Pause everything: set the Worker variable `SEO_GOD_PAUSED=true`, or `select public.set_god_paused(true, 'reason');`.",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, ""), key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"); process.exit(2); }
  const r = await fetch(`${url}/rest/v1/god_runs?select=id,started_at,finished_at,paused,sites_planned,jobs_run,errors&order=id.desc&limit=8`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) { console.error(`run log unreadable: HTTP ${r.status}`); process.exit(2); }
  const h = assessHealth(await r.json());
  console.log(process.argv.includes("--json") ? JSON.stringify(h) : report(h));
  process.exit(h.ok ? 0 : 1);
}
