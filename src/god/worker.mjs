// The SEO God worker: claim one ready job, run its handler within its budget and time limit, record the evidence, have
// it independently reviewed when the risk requires, and move it on. Failures go through the store's capped retry and
// escalate. The worker never approves anything: gated work waits in awaiting_approval for the agency.
import { reviewOutput } from "./review.mjs";

/**
 * store: MemoryStore or SupabaseStore. handlers: { [kind or "agent:*"]: async (job, ctx) => output }. output: { evidence,
 * changes, claims, actions, costUsd, deploy?: async () => ({ ref, rollback }) , verify?: async () => boolean }.
 * Returns a summary of what happened to the claimed job, or null when nothing was ready.
 */
export async function runOnce({ store, handlers, worker = "worker-1", timeoutMs = 120_000, siteHostOf = () => null, log = () => {} }) {
  const job = await store.claimJob(worker);
  if (!job) return null;
  const handler = handlers[job.kind] || handlers[job.kind.split(":")[0] + ":*"];
  try {
    if (!handler) throw new Error(`no handler for ${job.kind}`);
    const output = await Promise.race([handler(job, { worker }), new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs).unref?.())]);
    if (job.risk === "low" && !job.requiresApproval && !(output.changes || []).length) {
      await store.transition(job.id, "completed", worker, "done", { evidence: output.evidence || [] });
      log(`completed ${job.kind}`); return { job: job.id, outcome: "completed" };
    }
    await store.transition(job.id, "awaiting_review", worker, "ready for review", { evidence: output.evidence || [], changes: (output.changes || []).length });
    const review = reviewOutput(job, output, { siteHost: siteHostOf(job) });
    await store.recordReview(job.id, review);
    if (review.verdict !== "pass") {
      await store.transition(job.id, review.verdict === "fail" ? "failed" : "queued", review.reviewer, review.reasons.join("; "));
      log(`review ${review.verdict} ${job.kind}`); return { job: job.id, outcome: `review_${review.verdict}`, reasons: review.reasons };
    }
    if (job.requiresApproval) { await store.transition(job.id, "awaiting_approval", review.reviewer, "reviewed; waiting for the agency"); return { job: job.id, outcome: "awaiting_approval" }; }
    await store.transition(job.id, "authorized", review.reviewer, "reviewed");
    if (!output.deploy) { await store.transition(job.id, "completed", worker, "no deployment needed"); return { job: job.id, outcome: "completed" }; }
    await store.transition(job.id, "deploying", worker, "deploying");
    const dep = await output.deploy();
    await store.transition(job.id, "verifying", worker, "deployed", { ref: dep?.ref, rollback: dep?.rollback || null });
    if (output.verify && !(await output.verify())) {
      if (dep?.rollback) await dep.rollback();
      await store.transition(job.id, "failed", worker, dep?.rollback ? "verification failed; rolled back" : "verification failed; no automatic rollback, escalate");
      return { job: job.id, outcome: "rolled_back" };
    }
    await store.transition(job.id, "completed", worker, "verified");
    return { job: job.id, outcome: "deployed" };
  } catch (e) {
    const after = await store.failJob(job.id, worker, String(e.message || e).slice(0, 300));
    log(`failed ${job.kind}: ${e.message}`); return { job: job.id, outcome: after?.status === "escalated" ? "escalated" : "retry", error: e.message };
  } finally { store.release?.(job.id); }
}

/** Schedule planner output into the store: create each job and move routine ones to the queue, gated ones to approval. */
export async function enqueue(store, siteId, plan, actor = "seo-god") {
  const out = [];
  for (const spec of plan.jobs) {
    const j = await store.createJob({ ...spec, siteId });
    if (j.status !== "proposed") { out.push(j); continue; } // idempotent repeat: leave the existing job where it is
    await store.transition(j.id, "scoped", actor, spec.why || "planned");
    out.push(await store.transition(j.id, j.requiresApproval ? "awaiting_approval" : "queued", actor, j.requiresApproval ? "needs agency approval" : "queued"));
  }
  return out;
}
