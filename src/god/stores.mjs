// Job stores behind one interface, so the worker runs the same way in tests and against Supabase:
//   createJob(spec) claimJob(worker) transition(id, to, actor, note, data) recordReview(id, review) failJob(id, actor, error)
//   approve(id, decision, user)  (agency only; the Supabase store has no such method: approvals come from the portal)
// MemoryStore enforces the lifecycle with src/core/job-lifecycle.mjs (the same table and gates as the database).
// SupabaseStore calls the RPCs of migration 20261108000000_r1_contracts.sql with the service role key.
import { canMove, needsApproval } from "../core/job-lifecycle.mjs";

export class MemoryStore {
  constructor() { this.jobs = new Map(); this.events = []; this.reviews = []; this.approvals = []; this.n = 0; }
  createJob(s) {
    for (const j of this.jobs.values()) if (j.siteId === s.siteId && s.idempotencyKey && j.idempotencyKey === s.idempotencyKey) return j;
    const j = { id: `job-${++this.n}`, status: "proposed", attempts: 0, maxAttempts: 3, risk: "low", priority: 3, source: "seo_god", dependsOn: [], createdAt: String(this.n).padStart(6, "0"), ...s };
    j.requiresApproval = needsApproval(j);
    this.jobs.set(j.id, j); this.events.push({ jobId: j.id, to: "proposed", actor: "planner" });
    return j;
  }
  get(id) { return this.jobs.get(id); }
  #ctx(id) {
    const a = this.approvals.filter((x) => x.jobId === id).at(-1), r = this.reviews.filter((x) => x.jobId === id).at(-1);
    return { approved: a?.decision === "approve", reviewed: r?.verdict === "pass" };
  }
  transition(id, to, actor, note, data, as = "worker") {
    const j = this.jobs.get(id); if (!j) throw new Error("job not found");
    const r = canMove(j, to, { ...this.#ctx(id), actor: as }); if (!r.ok) throw new Error(r.reason);
    this.events.push({ jobId: id, from: j.status, to, actor, note, data });
    j.status = to; if (to === "running") j.attempts++;
    return j;
  }
  claimJob(worker) {
    const ready = [...this.jobs.values()].filter((j) => j.status === "queued" && !j.lease && (j.dependsOn || []).every((d) => this.jobs.get(d)?.status === "completed"))
      .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
    for (const j of ready) { try { this.transition(j.id, "running", worker, "claimed"); j.lease = worker; return j; } catch { /* gated */ } }
    return null;
  }
  recordReview(id, review) {
    const j = this.jobs.get(id);
    if (j.status !== "awaiting_review") throw new Error("job is not waiting for review");
    if (review.reviewer === (j.agent || j.kind)) throw new Error("reviews_independent");
    this.reviews.push({ jobId: id, ...review });
  }
  failJob(id, actor, error) {
    const j = this.transition(id, "failed", actor, error); j.error = error; j.lease = null;
    return this.transition(id, j.attempts < j.maxAttempts ? "queued" : "escalated", "system", "retry");
  }
  approve(id, decision, user) {
    const j = this.jobs.get(id); if (j.status !== "awaiting_approval") throw new Error("job is not waiting for approval");
    this.approvals.push({ jobId: id, decision, user });
    return this.transition(id, decision === "approve" ? "authorized" : decision === "reject" ? "rejected" : "scoped", user, decision, null, "agency");
  }
  release(id) { const j = this.jobs.get(id); if (j) j.lease = null; }
}

/** Supabase adapter: PostgREST RPC calls with the service role key (never shipped to a browser). */
export class SupabaseStore {
  constructor({ url, key, fetchImpl = fetch }) { this.url = url.replace(/\/$/, ""); this.key = key; this.fetch = fetchImpl; }
  async #rpc(fn, args) {
    const r = await this.fetch(`${this.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    const t = await r.text();
    if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch { /* text */ } throw new Error(`${fn}: ${m}`.slice(0, 300)); }
    return t ? JSON.parse(t) : null;
  }
  static #job(r) { return r && r.id ? { id: r.id, siteId: r.site_id, kind: r.kind, title: r.title, status: r.status, risk: r.risk, priority: r.priority, requiresApproval: r.requires_approval, attempts: r.attempts, maxAttempts: r.max_attempts, agent: r.agent, inputs: r.inputs, source: r.source } : null; }
  async createJob(s) { return SupabaseStore.#job(await this.#rpc("create_job", { p_site: s.siteId, p_kind: s.kind, p_title: s.title, p_source: s.source || "seo_god", p_risk: s.risk || "low", p_requires_approval: !!s.requiresApproval, p_priority: s.priority || 3, p_inputs: s.inputs || {}, p_idempotency_key: s.idempotencyKey || null, p_objective: s.why || null })); }
  async claimJob(worker) { return SupabaseStore.#job(await this.#rpc("claim_job", { p_worker: worker })); }
  async transition(id, to, actor, note = null, data = null) { return SupabaseStore.#job(await this.#rpc("transition_job", { p_job: id, p_to: to, p_actor: actor, p_note: note, p_data: data })); }
  async recordReview(id, rv) { return this.#rpc("record_review", { p_job: id, p_reviewer: rv.reviewer, p_verdict: rv.verdict, p_rationale: (rv.reasons || []).join("; ") || null, p_evidence: rv.evidence || null }); }
  async failJob(id, actor, error) { return SupabaseStore.#job(await this.#rpc("fail_job", { p_job: id, p_actor: actor, p_error: error })); }
}
