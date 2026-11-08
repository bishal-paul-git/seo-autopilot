// The Release 1 job lifecycle (docs/product/R1-CONTRACTS.md), for engine code that plans or runs jobs before they reach
// the database. The database enforces the same rules in private.move_job (migration 20261108000000_r1_contracts.sql);
// test/job-lifecycle.test.mjs checks both tables list the same moves. Pure: no I/O.

export const STATUSES = ["proposed", "scoped", "queued", "running", "awaiting_review", "awaiting_approval", "authorized", "deploying", "verifying", "completed", "failed", "cancelled", "rejected", "escalated"];
export const FINAL = new Set(["completed", "cancelled", "rejected"]);

export const MOVES = [
  ["proposed", "scoped"], ["proposed", "cancelled"], ["proposed", "rejected"],
  ["scoped", "queued"], ["scoped", "awaiting_approval"], ["scoped", "cancelled"],
  ["queued", "running"], ["queued", "cancelled"],
  ["running", "awaiting_review"], ["running", "completed"], ["running", "failed"],
  ["awaiting_review", "awaiting_approval"], ["awaiting_review", "authorized"], ["awaiting_review", "queued"], ["awaiting_review", "failed"],
  ["awaiting_approval", "authorized"], ["awaiting_approval", "rejected"], ["awaiting_approval", "scoped"],
  ["authorized", "queued"], ["authorized", "deploying"], ["authorized", "completed"],
  ["deploying", "verifying"], ["deploying", "failed"],
  ["verifying", "completed"], ["verifying", "failed"],
  ["failed", "queued"], ["failed", "escalated"],
  ["escalated", "queued"], ["escalated", "cancelled"],
];
const allowed = new Set(MOVES.map(([a, b]) => `${a}>${b}`));

/** Jobs that always need an agency approval: high risk, anything from a client submission, or flagged by policy. */
export const needsApproval = ({ risk = "low", source = "agency", requiresApproval = false } = {}) => Boolean(requiresApproval || risk === "high" || source === "client_submission");

/**
 * Whether a job may move to `to`. job: { status, risk, source, requiresApproval, attempts, maxAttempts }.
 * ctx: { approved: latest agency decision is "approve", reviewed: latest independent review passed, actor: "agency" | "worker" }.
 * Returns { ok, reason }. Mirrors private.move_job and public.transition_job.
 */
export function canMove(job, to, { approved = false, reviewed = false, actor = "worker" } = {}) {
  const from = job.status, gated = needsApproval(job), risk = job.risk || "low";
  if (!allowed.has(`${from}>${to}`)) return { ok: false, reason: `job cannot move from ${from} to ${to}` };
  // Work waiting for the agency is decided only by the agency, even when starting it needed no approval (D35).
  if (actor === "worker" && (to === "rejected" || (to === "authorized" && (gated || from === "awaiting_approval")))) return { ok: false, reason: "only an agency approval can authorize or reject" };
  if (gated && ["queued", "running", "authorized", "deploying"].includes(to) && !approved) return { ok: false, reason: "job needs agency approval first" };
  if (from === "awaiting_review" && ["awaiting_approval", "authorized"].includes(to) && risk !== "low" && !reviewed) return { ok: false, reason: "job needs a passing independent review" };
  if (from === "running" && to === "completed" && (risk !== "low" || gated)) return { ok: false, reason: "only low-risk jobs without approval can complete straight from running" };
  if (from === "failed" && to === "queued" && (job.attempts ?? 0) >= (job.maxAttempts ?? 3)) return { ok: false, reason: "retry cap reached: escalate" };
  return { ok: true, reason: "" };
}

/** After a failure: retry with a growing delay while under the cap, otherwise escalate to the agency. */
export function afterFailure({ attempts = 0, maxAttempts = 3 } = {}) {
  return attempts < maxAttempts ? { next: "queued", delayMinutes: 5 * attempts } : { next: "escalated", delayMinutes: 0 };
}

/** Order of work (owner decision Q07): explicit requests first, critical maintenance second, then opportunities by value. */
export function queueOrder(jobs) {
  return [...jobs].sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3) || String(a.createdAt).localeCompare(String(b.createdAt)));
}
