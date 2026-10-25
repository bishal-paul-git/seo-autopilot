// Evidence belongs to the exact work, in the exact site. An agent name alone is not an identity.
import { createHash, randomUUID } from "node:crypto";
import { openSync, closeSync, unlinkSync, renameSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readJson } from "./util.mjs";
import { readyOrders, approvalReady } from "../analysis/work-orders.mjs";

const canonical = (x) => Array.isArray(x) ? x.map(canonical) : x && typeof x === "object"
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical(x[k])])) : x;
export const workScope = (site) => ({ id: site.id, url: site.url });
export function orderFingerprint(order, site) {
  const { status, ...definition } = order;
  return createHash("sha256").update(JSON.stringify(canonical({ site: workScope(site), definition }))).digest("hex");
}

/** Never adopt legacy checks without an identity. Keep history for changed/removed work for operator review. */
export function reconcileWork(plan, saved = {}, site) {
  if (plan.site && JSON.stringify(canonical(plan.site)) !== JSON.stringify(canonical(workScope(site)))) throw new Error("work plan belongs to another site");
  if (saved.site && JSON.stringify(canonical(saved.site)) !== JSON.stringify(canonical(workScope(site)))) throw new Error("work state belongs to another site");
  const state = { version: 2, site: workScope(site), plan: plan.generatedAt, status: {}, results: {}, records: {}, fingerprints: {}, log: saved.log || [], archive: saved.archive || [] };
  const sameSite = JSON.stringify(canonical(saved.site)) === JSON.stringify(canonical(state.site));
  const definitions = new Map((plan.orders || []).map((o) => [o.id, o]));
  const cache = new Map();
  const fingerprint = (o, seen = new Set()) => {
    if (cache.has(o.id)) return cache.get(o.id);
    if (seen.has(o.id)) throw new Error("work plan contains a dependency cycle");
    const chain = new Set([...seen, o.id]);
    const parents = (o.dependsOn || []).map((id) => {
      if (!definitions.has(id)) throw new Error(`work plan depends on unknown ${id}`);
      return [id, fingerprint(definitions.get(id), chain)];
    });
    const fp = orderFingerprint({ ...o, dependencyFingerprints: parents }, site);
    cache.set(o.id, fp);
    return fp;
  };
  for (const o of plan.orders || []) {
    const fp = fingerprint(o);
    state.fingerprints[o.id] = fp;
    const keep = sameSite && saved.fingerprints?.[o.id] === fp;
    state.status[o.id] = keep ? saved.status?.[o.id] || "pending" : "pending";
    state.results[o.id] = keep ? saved.results?.[o.id] || {} : {};
    state.records[o.id] = keep ? saved.records?.[o.id] || { attempts: [] } : { attempts: [] };
  }
  for (const id of Object.keys(saved.status || {})) {
    if (sameSite && saved.fingerprints?.[id] === state.fingerprints[id]) continue;
    state.archive.push({ id, fingerprint: saved.fingerprints?.[id] || null, status: saved.status[id], results: saved.results?.[id] || {}, record: saved.records?.[id] || null, reason: "Work changed, was removed, or has no verifiable site/definition identity" });
  }
  state.archive = state.archive.slice(-200);
  return state;
}

export function assertNoRunningReplan(saved, next) {
  for (const [id, status] of Object.entries(saved.status || {})) {
    if (status === "running" && (!next.fingerprints[id] || !saved.fingerprints?.[id] || saved.fingerprints[id] !== next.fingerprints[id])) throw new Error(`cannot replace running work ${id}; finish or fail it before replanning`);
  }
}

/** Exclusive local transaction. A crashed lock fails closed; never steal an in-progress process's lock. */
export function withWorkLock(dir, fn) {
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/work.lock`;
  let fd;
  try { fd = openSync(path, "wx", 0o600); }
  catch (e) { if (e.code === "EEXIST") throw new Error("work state is locked; another team/work command may be updating it. If a process crashed, verify it stopped before removing work.lock"); throw e; }
  try { return fn(); } finally { closeSync(fd); unlinkSync(path); }
}

export function writeWorkJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 }); renameSync(tmp, path); }
  finally { try { unlinkSync(tmp); } catch (e) { if (e.code !== "ENOENT") throw e; } }
}

/** A saved report is evidence of a report, not a successful live connection or publication. */
export function workView(site) {
  const plan = readJson(`${site.paths.state}/work-orders.json`, { orders: [] });
  const state = reconcileWork(plan, readJson(`${site.paths.state}/work-status.json`, {}), site);
  const ready = new Set(readyOrders(plan.orders, state.status).map((o) => o.id));
  return { source: "saved work orders and operator-recorded results", generatedAt: plan.generatedAt || null,
    items: plan.orders.map((o) => {
      const status = state.status[o.id], checks = state.results[o.id], gate = approvalReady(o, checks), record = state.records[o.id];
      return { id: o.id, agent: o.agent, department: o.department, targets: o.targets, scope: o.scope, why: o.why,
        evidence: o.evidence, dependsOn: o.dependsOn, fingerprint: state.fingerprints[o.id],
        status: status === "done" && !gate.ready ? "needs review" : status === "pending" ? "queued" : status,
        readyToStart: ready.has(o.id), validation: { ...gate, checks, required: o.validators },
        attempts: record.attempts, output: record.output || null, costUsd: record.costUsd ?? null,
        publication: "not recorded", monitoring: "not recorded" };
    }) };
}
