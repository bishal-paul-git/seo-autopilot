// Independent review (§6): a different actor from the one that produced the work checks it before it can be approved
// or deployed. This deterministic reviewer covers the checks that need no model: evidence present, scope kept to the
// job's own site, change size within the risk class, no untrusted instruction carried into actions, and numbers only
// with a source. Model-based review (seo-editor) plugs in through the same interface: (job, output) -> verdict.

export const REVIEWER = "quality-gate@1";

const INJECTION = /\b(ignore (all |your |previous )?(rules|instructions)|disregard (the )?(above|previous)|you are now|system prompt|run this command|curl\s+http|rm\s+-rf)\b/i;

/**
 * job: { id, siteId, kind, risk, agent }. output: { evidence: [...], changes: [{ url, field, from, to }], claims: [{ text, source }], actions: [string] }
 * Returns { reviewer, producer, verdict: "pass" | "fail" | "needs_changes", reasons: [...] }.
 */
export function reviewOutput(job, output = {}, { siteHost = null, maxChanges = { low: 0, medium: 25, high: 200 } } = {}) {
  const reasons = [];
  const producer = job.agent || job.kind;
  if (producer === REVIEWER) return { reviewer: REVIEWER, producer, verdict: "fail", reasons: ["a reviewer cannot review its own work"] };
  if (!Array.isArray(output.evidence) || output.evidence.length === 0) reasons.push("no evidence recorded");
  const changes = output.changes || [];
  if (changes.length > (maxChanges[job.risk] ?? 0)) reasons.push(`${changes.length} changes exceed the ${job.risk}-risk limit of ${maxChanges[job.risk] ?? 0}`);
  if (siteHost) for (const c of changes) { try { if (new URL(c.url).hostname.replace(/^www\./, "") !== siteHost.replace(/^www\./, "")) reasons.push(`change outside the site: ${c.url}`); } catch { reasons.push(`change without a valid URL: ${c.url}`); } }
  for (const c of output.claims || []) if (/\d/.test(c.text || "") && !c.source) reasons.push(`number without a source: "${String(c.text).slice(0, 80)}"`);
  for (const a of output.actions || []) if (INJECTION.test(a)) reasons.push("an action repeats instruction-like text from untrusted input");
  const cost = Number(output.costUsd) || 0, budget = Number(job.budgetUsd) || 0;
  if (cost > budget + 1e-9) reasons.push(`over budget: spent $${cost.toFixed(4)} of $${budget.toFixed(4)}`);
  // Hard failures are not retried: retrying an out-of-scope, manipulated or overspending run would repeat it.
  const verdict = reasons.length === 0 ? "pass" : reasons.some((r) => /outside the site|instruction-like|own work|over budget/.test(r)) ? "fail" : "needs_changes";
  return { reviewer: REVIEWER, producer, verdict, reasons };
}
