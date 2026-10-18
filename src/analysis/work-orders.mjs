// Work orders: the agent plan turned into units of work with an owner, the pages they touch, what must finish first, and
// which checks must pass before a person is asked to approve. Pure: pass the plan and agent facts in, get orders back.
// The order of work and parallel safety live here, in code, not in agent prompts.
//
//   order = { id, agent, department, phase, rank, edits, scope: "pages"|"site", targets, dependsOn, validators, why,
//             evidence, prompt, status }
// Two orders may run at once unless both edit files and touch the same page (or either touches the whole site).
// Advisory agents (no file edits) never take locks. A person still approves everything that goes live.

export const STATUSES = ["pending", "running", "done", "failed"];
export const CHECKS = ["build", "facts", "audit", "redirects"];
export const VALIDATOR_AGENTS = ["seo-fact-checker", "seo-compliance-auditor", "seo-editor"];
const BLOCK = 1;

/** The checks a change by this agent must pass before approval. Advisory agents produce advice a person reads: none. */
export function validatorsFor(agent, { department, edits }, { sensitive = false } = {}) {
  if (!edits || department === "quality" || department === "command") return [];
  if (agent === "seo-redirect-guardian") return ["build", "redirects"];
  if (agent === "seo-schema-engineer") return ["build", "audit"];
  if (department === "content" || department === "ai-search") {
    return ["build", "facts", "seo-fact-checker", ...(sensitive ? ["seo-compliance-auditor"] : []), "seo-editor"];
  }
  return ["build", "audit"];
}

const overlaps = (a, b) => a.scope === "site" || b.scope === "site" || a.targets.some((t) => b.targets.includes(t));

/**
 * Plan steps (from routeAgents) to work orders. `agents` maps an agent name to { department, edits }.
 * `sensitivePaths` are pages that need a qualified reviewer (from the ymyl report): content changes there also go to the
 * compliance auditor.
 */
export function buildWorkOrders(plan, agents, { sensitivePaths = [] } = {}) {
  const orders = (plan?.steps || []).map((s) => {
    const info = agents[s.agent];
    if (!info) throw new Error(`unknown agent in plan: ${s.agent}`);
    const targets = (s.targets || []).filter((t) => t !== "*");
    const scope = !targets.length || (s.targets || []).includes("*") ? "site" : "pages";
    const sensitive = targets.some((t) => sensitivePaths.includes(t));
    return { id: s.agent, agent: s.agent, department: info.department, phase: s.phase, rank: s.rank, edits: Boolean(info.edits), scope, targets: scope === "site" ? [] : targets,
      dependsOn: [], validators: validatorsFor(s.agent, info, { sensitive }), why: s.why, evidence: s.evidence, prompt: s.prompt, status: "pending" };
  });
  for (const b of orders) {
    for (const a of orders) {
      if (a === b || a.rank >= b.rank) continue;
      // Blockers (crawling, indexing, consent) come before later work on the same pages, or before everything if site-wide.
      const blocker = a.rank === BLOCK && overlaps(a, b);
      // Earlier edits to a page come before later edits to the same page.
      const sameFiles = a.edits && b.edits && overlaps(a, b);
      if (blocker || sameFiles) b.dependsOn.push(a.id);
    }
    // The report judges the week's work, so it comes last.
    if (b.agent === "seo-reporter") b.dependsOn = orders.filter((o) => o !== b).map((o) => o.id);
  }
  return orders;
}

/** Problems with an order's shape. Empty means valid. `known` is the set of agent names that exist. */
export function validateWorkOrder(o, known = null) {
  const errs = [];
  if (!o || typeof o !== "object") return ["not an object"];
  for (const k of ["id", "agent", "department", "why", "prompt"]) if (typeof o[k] !== "string" || !o[k]) errs.push(`${k} missing`);
  if (known && !known.has(o.agent)) errs.push(`unknown agent ${o.agent}`);
  if (!STATUSES.includes(o.status)) errs.push(`status must be one of ${STATUSES.join(", ")}`);
  if (!["pages", "site"].includes(o.scope)) errs.push("scope must be pages or site");
  if (!Array.isArray(o.targets) || o.targets.some((t) => typeof t !== "string" || !t.startsWith("/"))) errs.push("targets must be page paths");
  if (o.scope === "pages" && !o.targets?.length) errs.push("a pages-scoped order needs targets");
  if (!Array.isArray(o.dependsOn) || o.dependsOn.includes(o.id)) errs.push("dependsOn must be a list without the order itself");
  if (!Array.isArray(o.validators) || o.validators.some((v) => !CHECKS.includes(v) && !VALIDATOR_AGENTS.includes(v))) errs.push("unknown validator");
  return errs;
}

/** Problems across a set of orders: unknown dependencies and cycles. */
export function validateOrders(orders, known = null) {
  const errs = orders.flatMap((o) => validateWorkOrder(o, known).map((e) => `${o.id}: ${e}`));
  const ids = new Set(orders.map((o) => o.id));
  if (ids.size !== orders.length) errs.push("duplicate order ids");
  for (const o of orders) for (const d of o.dependsOn || []) if (!ids.has(d)) errs.push(`${o.id}: depends on unknown ${d}`);
  if (!errs.length && waves(orders).flat().length !== orders.length) errs.push("dependency cycle");
  return errs;
}

/**
 * Which pending orders may start now. `status` maps id to a status (missing = the order's own). An order is ready when every
 * dependency is done and, if it edits files, no running or already-chosen editing order touches the same pages.
 */
export function readyOrders(orders, status = {}) {
  const st = (o) => status[o.id] ?? o.status;
  const byId = new Map(orders.map((o) => [o.id, o]));
  const busy = orders.filter((o) => st(o) === "running" && o.edits);
  const out = [];
  for (const o of [...orders].sort((a, b) => a.rank - b.rank)) {
    if (st(o) !== "pending") continue;
    if (!o.dependsOn.every((d) => st(byId.get(d)) === "done")) continue;
    if (o.edits && [...busy, ...out.filter((x) => x.edits)].some((x) => overlaps(x, o))) continue;
    out.push(o);
  }
  return out;
}

/** The orders grouped into waves that could each run in parallel, assuming every order succeeds. */
export function waves(orders) {
  const status = Object.fromEntries(orders.map((o) => [o.id, "pending"]));
  const out = [];
  for (let guard = 0; guard <= orders.length; guard++) {
    const next = readyOrders(orders, status);
    if (!next.length) break;
    out.push(next.map((o) => o.id));
    for (const o of next) status[o.id] = "done";
  }
  return out;
}

/** May this order's change be put to a person for approval? Only when every validator has passed. */
export function approvalReady(order, results = {}) {
  const failed = order.validators.filter((v) => results[v] === "fail");
  const missing = order.validators.filter((v) => results[v] !== "pass" && results[v] !== "fail");
  return { ready: !failed.length && !missing.length, failed, missing };
}

/** A plain-English section for agent-plan.md. */
export function ordersMarkdown(orders) {
  const w = waves(orders);
  const line = (id) => {
    const o = orders.find((x) => x.id === id);
    const where = o.scope === "site" ? "whole site" : `${o.targets.length} page(s)`;
    return `- **${o.agent}** (${o.department}, ${o.edits ? "edits files" : "advice only"}, ${where})${o.dependsOn.length ? `, after ${o.dependsOn.join(", ")}` : ""}${o.validators.length ? `. Must pass: ${o.validators.join(", ")}` : ""}`;
  };
  return `## Work orders\nRun each wave's orders in any order or at the same time; a wave starts when the one before it is done. Editing orders never share pages. Nothing goes to a person for approval until its checks pass.\n\n${w.map((ids, i) => `### Wave ${i + 1}\n${ids.map(line).join("\n")}`).join("\n\n")}\n`;
}
