// SEO God planning for ONE website (Q03: an independent director per site). Turns the site's latest reports, its
// approved strategy and its private memory into job specifications for the queue. Pure and deterministic: the same
// inputs give the same jobs, and every job says why it exists and which evidence caused it.
//
// Rules from the owner's decisions:
//   - Before the agency has approved a strategy, only read-only discovery and the strategy proposal itself are planned
//     (§3: "initial strategy needs agency approval before execution").
//   - Order: explicit requests (priority 1), critical maintenance (2), opportunities (3) (Q07).
//   - Every job carries an idempotency key for its period, so planning twice does not queue the same work twice.
import { routeAgents } from "../analysis/agent-router.mjs";
import { departmentOf, agentRisk } from "./departments.mjs";
import { needsApproval } from "../core/job-lifecycle.mjs";

const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y) / 864e5 + 1) / 7)).padStart(2, "0")}`;
};

/**
 * site: { id, url }. reports: the same report objects the engine writes (audit, priorities, profile, speed, geo, ...).
 * strategy: { status: "approved" | "proposed" | "none", objectives?: [...] }. agents: [{ name, department, mayEdit }]
 * from the registry. now: ISO time. Returns { strategyApproved, jobs: [{ kind, title, department, risk, priority,
 * source, requiresApproval, idempotencyKey, inputs, why }] }.
 */
export function planSite({ site, reports = {}, strategy = { status: "none" }, agents = [], now = new Date().toISOString() }) {
  const week = isoWeek(new Date(now)), day = now.slice(0, 10);
  const approved = strategy?.status === "approved";
  const jobs = [];
  const add = (j) => jobs.push({ source: "seo_god", requiresApproval: needsApproval(j), ...j, idempotencyKey: `${j.kind}:${j.period || week}`, inputs: { site: site.id, ...(j.inputs || {}) } });

  // Maintenance that keeps the site's picture current (read-only, always allowed).
  const lastScan = reports.audit?.generatedAt ? Date.parse(reports.audit.generatedAt) : 0;
  if (!lastScan || Date.parse(now) - lastScan > 36 * 3600e3) {
    add({ kind: "scan", title: "Read the site and refresh the audit", department: "technical", risk: "low", priority: 2, period: day, why: lastScan ? "last audit is older than 36 hours" : "no audit yet" });
  }
  if (!approved) {
    // D1 (owner review, 2026-11-08): the draft is deterministic and free (scan, the site's own statements, the audit;
    // no AI call), so it is drafted at once; the agency's single approval adopts it. Same priority as the scan and
    // created after it, so the scan runs first and the draft reuses it.
    if (strategy?.status !== "proposed") add({ kind: "strategy_proposal", title: "Draft the initial SEO strategy for agency approval", department: "research", risk: "medium", priority: 2, why: "no approved strategy: nothing else may execute until the agency adopts one" });
    return { strategyApproved: false, jobs };
  }

  // Delegation: the existing deterministic router decides which specialists are needed and in what order.
  const plan = routeAgents({ profile: reports.profile || null, audit: reports.audit || null, priorities: reports.priorities || null, inspect: reports.inspect || {}, speed: reports.speed || null, geo: reports.geo || null });
  const byName = new Map(agents.map((a) => [a.name, a]));
  for (const step of plan.steps || []) {
    const a = byName.get(step.agent) || { name: step.agent };
    const risk = agentRisk(step.agent, a);
    add({
      kind: `agent:${step.agent}`, title: String(step.why || step.agent).slice(0, 200), department: departmentOf({ agent: step.agent, agentDir: a.department }),
      risk, priority: /critical|index|crawl|broken|noindex|robots/i.test(String(step.why)) ? 2 : 3,
      inputs: { agent: step.agent, instruction: step.instruction || null, evidence: (step.evidence || []).slice(0, 10) }, why: step.why || "",
    });
  }
  return { strategyApproved: true, jobs: dedupe(jobs) };
}

/** One job per idempotency key, keeping the most urgent. */
export function dedupe(jobs) {
  const by = new Map();
  for (const j of jobs) { const k = j.idempotencyKey; if (!by.has(k) || j.priority < by.get(k).priority) by.set(k, j); }
  return [...by.values()].sort((a, b) => a.priority - b.priority || a.kind.localeCompare(b.kind));
}
