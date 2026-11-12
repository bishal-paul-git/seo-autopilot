// One scheduler tick (R1-A2, D28): for every site, move agency decisions forward, plan with that site's own SEO God,
// queue only work that fits the site's daily budget and has a runner, then let the worker run a bounded number of
// jobs. Each site is planned independently; one site's failure does not stop the others. Nothing here approves work:
// it only carries out decisions the agency already recorded.
import { planSite } from "./planner.mjs";
import { enqueue, runOnce } from "./worker.mjs";
import { learn, applyLessons } from "./learning.mjs";
import { trafficDue } from "./search-console.mjs";
import { rulesOnPage, verifyChange, WAIT_FOR_PR_DAYS } from "./github.mjs";
import { withAnswers } from "./onboarding.mjs";

const OPEN = new Set(["proposed", "scoped", "queued", "running", "awaiting_review", "awaiting_approval", "authorized", "deploying", "verifying", "failed", "escalated"]);

/** Estimated cost of one job, in US dollars. Read-only discovery costs nothing; agent runs use the configured estimate. */
export const estimateCost = (kind, { agentRunUsd = 0.5 } = {}) => (kind.startsWith("agent:") ? agentRunUsd : 0);

/** Where the site's strategy stands, from its memory and its strategy jobs. */
export function strategyStatus(jobs, memory) {
  const s = memory.find((m) => m.kind === "strategy" && m.key === "initial");
  if (s?.value?.status === "approved") return "approved";
  return jobs.some((j) => j.kind === "strategy_proposal" && OPEN.has(j.status)) ? "proposed" : "none";
}

/** The reports the planner reads, rebuilt from the compact copies the scan handler keeps in memory. */
export function reportsFrom(memory) {
  const r = {};
  for (const m of memory) if (m.kind === "report") r[m.key] = m.value;
  return r;
}

/**
 * Carry out agency decisions already recorded: an approved job that has not run yet is queued; an approved strategy
 * proposal that has run is accepted (the strategy becomes "approved" in memory and the job completes). An approved
 * change that has run waits for its apply step, which needs an authorized integration (R1-E1): reported, not touched.
 */
export async function advance(store, site, jobs, memory, actor = "seo-god", { github = null, now = new Date().toISOString() } = {}) {
  const moved = [], waiting = [];
  // D37: approved work orders reach GitHub here, and the pull requests they lead to are followed and verified.
  const ex = await executeChanges(store, site, jobs, memory, actor, github, now);
  moved.push(...ex.moved); waiting.push(...ex.waiting);
  // Work created outside the planner (an accepted client request, a job an agency member added) enters the lifecycle
  // here: gated work goes to the agency for approval, never straight to the queue.
  for (const j of jobs.filter((x) => x.status === "proposed")) {
    await store.transition(j.id, "scoped", actor, j.source === "client_submission" ? "client request accepted by the agency" : "scoped");
    const to = j.requiresApproval ? "awaiting_approval" : "queued";
    await store.transition(j.id, to, actor, j.requiresApproval ? "needs agency approval" : "queued");
    moved.push({ job: j.id, kind: j.kind, to });
  }
  // The agency asked for changes (approve_job "request_changes" moves the job to scoped): redo it. Gated work is not
  // re-queued here: it waits for a new approval to start.
  for (const j of jobs.filter((x) => x.status === "scoped" && !x.requiresApproval)) {
    await store.transition(j.id, "queued", actor, "the agency asked for changes: redo it");
    moved.push({ job: j.id, kind: j.kind, to: "queued" });
  }
  for (const j of jobs.filter((x) => x.status === "authorized")) {
    if (!j.attempts) { await store.transition(j.id, "queued", actor, "approved by the agency: run it"); moved.push({ job: j.id, kind: j.kind, to: "queued" }); continue; }
    if (j.kind === "implement") continue; // handled by executeChanges
    if (j.kind === "strategy_proposal") {
      const base = memory.find((m) => m.kind === "strategy" && m.key === "initial")?.value || j.outputs?.proposal || {};
      const answers = Object.fromEntries(memory.filter((m) => m.kind === "answer").map((m) => [m.key, m.value?.value]));
      const open = memory.filter((m) => m.kind === "question" && answers[m.key] == null).length;
      const draft = withAnswers(base, answers, open);
      await store.writeMemory(site.id, [{ kind: "strategy", key: "initial", value: { ...draft, status: "approved", approvedJob: j.id }, basis: "verified", confidence: null, source: "agency approval" }]);
      await store.transition(j.id, "completed", actor, "strategy accepted by the agency");
      moved.push({ job: j.id, kind: j.kind, to: "completed" }); continue;
    }
    // Advice only (no changes to a website): approving the result is the end of it.
    if (!(j.outputs?.changes || []).length) {
      await store.transition(j.id, "completed", actor, "result accepted by the agency");
      moved.push({ job: j.id, kind: j.kind, to: "completed" }); continue;
    }
    waiting.push({ job: j.id, kind: j.kind, reason: "approved; its apply step needs an authorized integration (R1-E1)" });
  }
  return { moved, waiting };
}

const DAY = 864e5;
const ageDays = (from, now) => (Date.parse(now) - Date.parse(from || now)) / DAY;

/**
 * Verified execution (D37). For each implement job:
 * - authorized (the agency approved the exact work order): open the issue in the site's repository and start the site's
 *   seo-implement workflow, then move to deploying. The issue number is saved before the workflow is started, so a
 *   failure in between never opens a second issue.
 * - deploying: follow the pull request on branch seo/issue-<n>. Merged: move to verifying and ask for a fresh scan.
 *   Closed without merging, or no pull request after WAIT_FOR_PR_DAYS: hand to a person. Open: wait (people decide).
 * - verifying: compare the page's problems in the first scan after the merge with the baseline taken when the work order
 *   was sent. New high-severity problems: hand to a person with the pull request to revert. Otherwise: completed.
 * github: async (site) => client from github.mjs (makeGitHub) or null when the site has no connected repository.
 * Nothing here merges, approves or edits anything: the merge stays with a person or the site's own policy (D17).
 */
export async function executeChanges(store, site, jobs, memory, actor, github, now) {
  const moved = [], waiting = [];
  const mine = jobs.filter((j) => j.kind === "implement" && ((j.status === "authorized" && j.attempts) || j.status === "deploying" || j.status === "verifying"));
  if (!mine.length) return { moved, waiting };
  let gh = null, ghError = null;
  if (mine.some((j) => j.status !== "verifying")) {
    try { gh = github ? await github(site) : null; } catch (e) { ghError = String(e.message || e); }
  }
  const status = async (ok, err) => { try { await store.recordIntegrationStatus?.(site.id, "github", ok, err || null); } catch { /* best effort */ } };
  const stop = async (j, why) => {
    await store.transition(j.id, "failed", actor, why.slice(0, 300));
    await store.transition(j.id, "escalated", "system", "needs a person");
    moved.push({ job: j.id, kind: j.kind, to: "escalated", why });
  };
  const audit = reportsFrom(memory).audit || null;
  for (const j of mine) {
    const d = j.outputs?.deploy || {};
    try {
      if (j.status === "verifying") {
        const v = verifyChange(d, audit, now);
        if (!v.done) { waiting.push({ job: j.id, kind: j.kind, reason: `verifying: waiting for a scan after pull request #${d.pr} was merged` }); continue; }
        await store.recordOutput(j.id, { outputs: { ...j.outputs, verification: { ...v, at: now, auditAt: audit?.generatedAt || null } } });
        if (!v.ok) { await stop(j, `${v.summary}; if the pull request caused it, revert #${d.pr} in GitHub`); continue; }
        await store.transition(j.id, "completed", actor, v.summary.slice(0, 300), { pr: d.prUrl || null });
        moved.push({ job: j.id, kind: j.kind, to: "completed", why: v.summary });
        continue;
      }
      if (!gh) { waiting.push({ job: j.id, kind: j.kind, reason: ghError ? `GitHub: ${ghError}` : "approved; connect GitHub for this website to open the pull request" }); continue; }
      if (j.status === "authorized") {
        const order = j.outputs?.proposal?.workOrder;
        if (!order?.title) { waiting.push({ job: j.id, kind: j.kind, reason: "approved, but the work order is missing: ask for it again" }); continue; }
        let deploy = d;
        if (!deploy.issue) {
          const issue = await gh.createIssue(order);
          deploy = { repo: gh.repo, issue: issue.number, issueUrl: issue.url, url: order.url || null, baseline: order.url ? rulesOnPage(audit, order.url) : [], baselineAuditAt: audit?.generatedAt || null, openedAt: now };
          await store.recordOutput(j.id, { outputs: { ...j.outputs, deploy } });
        }
        await gh.dispatch(deploy.issue, await gh.defaultBranch());
        await store.recordOutput(j.id, { outputs: { ...j.outputs, deploy: { ...deploy, dispatchedAt: now } } });
        await store.transition(j.id, "deploying", actor, `issue #${deploy.issue} opened in ${deploy.repo}; seo-implement started`, { issue: deploy.issueUrl });
        await status(true);
        moved.push({ job: j.id, kind: j.kind, to: "deploying" });
        continue;
      }
      // deploying
      const pr = await gh.pullForIssue(d.issue);
      await status(true);
      if (pr?.merged) {
        await store.recordOutput(j.id, { outputs: { ...j.outputs, deploy: { ...d, pr: pr.number, prUrl: pr.url, mergedAt: pr.mergedAt } } });
        await store.transition(j.id, "verifying", actor, `pull request #${pr.number} merged; verifying with the next scan`, { pr: pr.url });
        // A fresh read of the site soon after the merge is the verification's evidence.
        const scan = await store.createJob({ siteId: site.id, kind: "scan", title: "Read the site to verify a merged change", source: "seo_god", risk: "low", priority: 1, requiresApproval: false, idempotencyKey: `scan:verify:${j.id}`, inputs: { site: site.id, verifies: j.id } });
        if (scan.status === "proposed") { await store.transition(scan.id, "scoped", actor, "verify a merged change"); await store.transition(scan.id, "queued", actor, "queued"); }
        moved.push({ job: j.id, kind: j.kind, to: "verifying" });
      } else if (pr && pr.state === "closed") {
        await stop(j, `pull request #${pr.number} was closed without merging`);
      } else if (pr) {
        waiting.push({ job: j.id, kind: j.kind, reason: `pull request #${pr.number} is waiting for review in GitHub` });
      } else if (ageDays(d.dispatchedAt, now) > WAIT_FOR_PR_DAYS) {
        const issue = await gh.issue(d.issue).catch(() => null);
        await stop(j, issue?.state === "closed" ? `issue #${d.issue} was closed without a pull request` : `no pull request ${WAIT_FOR_PR_DAYS} days after issue #${d.issue}: check that seo-implement is installed and can run`);
      } else {
        waiting.push({ job: j.id, kind: j.kind, reason: `waiting for seo-implement to open a pull request for issue #${d.issue}` });
      }
    } catch (e) {
      const m = String(e.message || e).slice(0, 300);
      await status(false, m);
      waiting.push({ job: j.id, kind: j.kind, reason: `GitHub: ${m}` });
    }
  }
  return { moved, waiting };
}

/** Jobs that wait on a person, with the decision each one needs. */
export const waitingOn = (jobs) => jobs.filter((j) => ["awaiting_approval", "escalated"].includes(j.status))
  .map((j) => ({ job: j.id, kind: j.kind, reason: j.status === "escalated" ? "failed repeatedly: needs a person" : j.attempts ? "waiting for the agency to approve the result" : "waiting for the agency to approve starting it" }));

/**
 * store: MemoryStore or SupabaseStore (with listJobs, readMemory, writeMemory, spendSince). sites: [{ id, url, name }]
 * (default: store.listSites()). handlers: the worker's handlers; only kinds with a handler are queued.
 * opts: { now, paused (kill switch), dailyBudgetUsd (per site; default 0 = free work only), budgets: { [siteId]: usd },
 * agentRunUsd, maxJobs (per tick, all sites), agents (registry entries), worker, timeoutMs, log }.
 * Returns a plain report of what happened for each site and each job run.
 */
export async function tick({ store, sites = null, handlers = {}, now = new Date().toISOString(), paused = false, dailyBudgetUsd = 0, budgets = {}, agentRunUsd = 0.5, maxJobs = 5, agents = [], worker = "seo-god-worker", timeoutMs = 120_000, log = () => {}, github = null }) {
  if (paused) return { now, paused: true, sites: [], runs: [] };
  const list = sites || (await store.listSites());
  const dayStart = `${now.slice(0, 10)}T00:00:00.000Z`;
  const has = (kind) => Boolean(handlers[kind] || handlers[kind.split(":")[0] + ":*"]);
  const report = { now, paused: false, sites: [], runs: [] };
  const hostOf = new Map();
  for (const site of list) {
    try { hostOf.set(site.id, new URL(site.url).hostname); } catch { /* invalid address: the scan refuses it */ }
    const entry = { site: site.id, url: site.url, strategy: null, queued: [], deferred: [], moved: [], waiting: [], spentTodayUsd: 0, budgetUsd: 0 };
    try {
      let jobs = await store.listJobs(site.id);
      let memory = (await store.readMemory(site.id)) || [];
      const adv = await advance(store, site, jobs, memory, "seo-god", { github, now });
      entry.moved = adv.moved; entry.waiting = adv.waiting;
      if (adv.moved.length) { jobs = await store.listJobs(site.id); memory = (await store.readMemory(site.id)) || []; }
      // Learn from what happened since the last run, before deciding what to do next.
      const learned = learn({ memory, jobs, now });
      if (learned.rows.length) { await store.writeMemory(site.id, learned.rows); memory = (await store.readMemory(site.id)) || []; }
      entry.learning = { experiments: learned.experiments.length, open: learned.experiments.filter((e) => e.status === "open").length, lessons: learned.lessons.length };
      entry.strategy = strategyStatus(jobs, memory);
      const budget = budgets[site.id] ?? dailyBudgetUsd;
      const spent = await store.spendSince(site.id, dayStart);
      // Money already promised to open work counts against today's budget, so a tick cannot queue more than the day allows.
      let reserved = spent + jobs.filter((j) => OPEN.has(j.status) && j.status !== "failed").reduce((a, j) => a + Math.max(0, (Number(j.budgetUsd) || 0) - (Number(j.costUsd) || 0)), 0);
      entry.spentTodayUsd = round(spent); entry.budgetUsd = budget;
      const plan = planSite({ site, reports: reportsFrom(memory), strategy: { status: entry.strategy }, agents, now });
      const keep = [], existing = new Set(jobs.map((j) => j.idempotencyKey).filter(Boolean));
      // Measure accepted advice in Search Console once its after-window is complete (only with a Google key).
      if (has("search_console") && trafficDue(learned.experiments, now).length) plan.jobs.push({ kind: "search_console", title: "Measure accepted advice in Search Console", department: "analytics", risk: "low", priority: 3, source: "seo_god", requiresApproval: false, idempotencyKey: `search_console:${now.slice(0, 10)}`, inputs: { site: site.id }, why: "accepted advice has a complete 14-day after-window" });
      const guided = applyLessons(plan.jobs, learned.lessons);
      entry.deferred.push(...guided.deferred); entry.adjusted = guided.adjusted;
      for (const spec of guided.keep) {
        if (!has(spec.kind)) { entry.deferred.push({ kind: spec.kind, reason: "no runner for this kind yet" }); continue; }
        if (existing.has(spec.idempotencyKey)) continue; // already planned this period; its budget is already reserved
        const est = estimateCost(spec.kind, { agentRunUsd });
        if (est > 0 && reserved + est > budget + 1e-9) { entry.deferred.push({ kind: spec.kind, reason: `over today's budget ($${round(reserved)} used or reserved of $${budget})` }); continue; }
        reserved += est; keep.push({ ...spec, budgetUsd: est });
      }
      const created = await enqueue(store, site.id, { jobs: keep });
      entry.queued = created.map((j) => ({ job: j.id, kind: j.kind, status: j.status }));
      const after = await store.listJobs(site.id);
      entry.strategy = strategyStatus(after, memory); // as it stands after this tick's planning, before the worker runs
      entry.waiting.push(...waitingOn(after));
    } catch (e) { entry.error = String(e.message || e).slice(0, 300); log(`site ${site.id}: ${entry.error}`); }
    report.sites.push(entry);
  }
  for (let i = 0; i < maxJobs; i++) {
    const r = await runOnce({ store, handlers, worker, timeoutMs, siteHostOf: (job) => hostOf.get(job.siteId) || null, log });
    if (!r) break;
    report.runs.push(r);
  }
  return report;
}

const round = (n) => Math.round(n * 1e4) / 1e4;
