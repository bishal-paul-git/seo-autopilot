// Runs the work orders from `team`: what may start now, and a record of what is running, done, and which checks passed.
//   npx seo-autopilot run work                         what is ready, running and waiting, and why
//   npx seo-autopilot run work --start seo-refresher    refuses unless its dependencies are done and its pages are free
//   npx seo-autopilot run work --check seo-refresher --result build=pass,facts=pass,seo-editor=fail
//   npx seo-autopilot run work --done seo-refresher     (or --fail) when the agent has finished its part
//   npx seo-autopilot run work --ready seo-refresher    exits 1 unless every check has passed (use it before asking for approval)
// State: <state>/<site>/work-status.json (v2). work.lock serializes local mutations. Only unchanged site/order/dependency
// identities retain results after planning. It never runs an agent or approves anything. See docs/work-tracking.md.
import { readJson } from "../core/util.mjs";
import { readyOrders, approvalReady, STATUSES } from "../analysis/work-orders.mjs";
import { reconcileWork, withWorkLock, writeWorkJson } from "../core/work-state.mjs";

export const description = "Track the agents' work orders: what may start now (dependencies, page locks), and which checks passed";

export async function run({ site, flags = {} }) {
  const commands = ["start", "check", "done", "fail", "retry", "ready"].filter((k) => flags[k]);
  if (commands.length > 1) throw new Error("use one work action at a time");
  const paused = site.autopilot?.paused || process.env.SEO_AUTOPILOT_PAUSED === "true";
  if (paused && (flags.start || flags.retry)) throw new Error("autopilot is paused; starting or retrying work is disabled");
  const update = () => track({ site, flags });
  return commands.length && !flags.ready ? withWorkLock(site.paths.state, update) : update();
}

function track({ site, flags }) {
  const s = site.paths.state;
  const file = readJson(`${s}/work-orders.json`, null);
  if (!file?.orders?.length) { console.log("No work orders yet: run `seo-autopilot run team` first."); return; }
  const orders = file.orders;
  const saved = reconcileWork(file, readJson(`${s}/work-status.json`, {}), site);
  const { status, results, records, log } = saved;
  const st = (o) => status[o.id] ?? "pending";
  const pick = (name) => {
    const o = orders.find((x) => x.id === flags[name]);
    if (!o) throw new Error(`no work order "${flags[name]}" in work-orders.json (orders: ${orders.map((x) => x.id).join(", ")})`);
    return o;
  };
  const save = (what) => {
    log.push({ at: new Date().toISOString(), what });
    writeWorkJson(`${s}/work-status.json`, { ...saved, updatedAt: new Date().toISOString(), log: log.slice(-200) });
    console.log(what);
  };

  if (flags.start) {
    const o = pick("start");
    if (st(o) !== "pending") throw new Error(`${o.id} is ${st(o)}, not pending`);
    if (!readyOrders(orders, status).some((x) => x.id === o.id)) {
      const waiting = o.dependsOn.filter((d) => status[d] !== "done");
      const busy = orders.filter((x) => st(x) === "running" && x.edits && o.edits).map((x) => x.id);
      throw new Error(`${o.id} cannot start yet.${waiting.length ? ` Waiting for: ${waiting.join(", ")}.` : ""}${busy.length ? ` Pages may be held by: ${busy.join(", ")}.` : ""}`);
    }
    status[o.id] = "running";
    results[o.id] = {};
    records[o.id].attempts.push({ number: records[o.id].attempts.length + 1, startedAt: new Date().toISOString() });
    records[o.id].costUsd = null;
    return save(`started ${o.id}${o.edits ? ` (holds ${o.scope === "site" ? "the whole site" : o.targets.join(", ")})` : ""}`);
  }
  if (flags.retry) {
    const o = pick("retry");
    if (st(o) !== "failed") throw new Error(`${o.id}: only failed work may be retried`);
    if (records[o.id].attempts.length >= 3) throw new Error(`${o.id}: retry limit reached (3 attempts); review the failure and revise the plan`);
    status[o.id] = "pending";
    results[o.id] = {};
    delete records[o.id].output;
    return save(`queued retry for ${o.id}; previous failure retained in attempts`);
  }
  if (flags.check) {
    const o = pick("check");
    if (st(o) !== "running") throw new Error(`${o.id}: checks may only be recorded for running work`);
    const pairs = String(flags.result || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => x.split("="));
    if (!pairs.length || pairs.some(([k, v, extra]) => extra !== undefined || !o.validators.includes(k) || !["pass", "fail"].includes(v))) throw new Error(`--result must be name=pass|fail for this order's checks: ${o.validators.join(", ") || "(none)"}`);
    results[o.id] = { ...(results[o.id] || {}), ...Object.fromEntries(pairs) };
    return save(`checks for ${o.id}: ${pairs.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }
  for (const end of ["done", "fail"]) {
    if (!flags[end]) continue;
    const o = pick(end);
    if (st(o) !== "running") throw new Error(`${o.id} is ${st(o)}; only a running order can be marked ${end}`);
    const cost = flags["cost-usd"] === undefined ? null : Number(flags["cost-usd"]);
    if (cost !== null && (typeof flags["cost-usd"] === "boolean" || String(flags["cost-usd"]).trim() === "" || !Number.isFinite(cost) || cost < 0)) throw new Error("--cost-usd must be a non-negative number for this attempt");
    const record = records[o.id], attempt = record.attempts.at(-1);
    attempt.finishedAt = new Date().toISOString();
    attempt.status = end === "done" ? "done" : "failed";
    attempt.checks = { ...results[o.id] };
    attempt.costUsd = cost;
    if (end === "fail") attempt.failure = String(flags.reason || "No failure detail supplied").slice(0, 2000);
    if (flags.output) { attempt.output = String(flags.output).slice(0, 2000); record.output = attempt.output; }
    // Unknown spend stays unknown rather than being reported as zero.
    record.costUsd = record.attempts.every((a) => a.costUsd != null) ? record.attempts.reduce((sum, a) => sum + a.costUsd, 0) : null;
    status[o.id] = end === "done" ? "done" : "failed";
    return save(`${o.id} ${status[o.id]}`);
  }
  if (flags.ready) {
    const o = pick("ready");
    if (!["running", "done"].includes(st(o))) throw new Error(`${o.id}: work has not run successfully`);
    const r = approvalReady(o, results[o.id]);
    console.log(r.ready ? `${o.id}: every check passed. It can go to a person for approval.` : `${o.id}: not ready for approval.${r.failed.length ? ` Failed: ${r.failed.join(", ")}.` : ""}${r.missing.length ? ` Not run yet: ${r.missing.join(", ")}.` : ""}`);
    if (!r.ready) process.exitCode = 1;
    return;
  }

  const ready = new Set(readyOrders(orders, status).map((o) => o.id));
  const groups = Object.fromEntries(STATUSES.map((x) => [x, []]));
  for (const o of orders) groups[st(o)].push(o);
  const line = (o) => `- ${o.id}${ready.has(o.id) ? " (ready to start)" : st(o) === "pending" ? ` (waiting for ${o.dependsOn.filter((d) => status[d] !== "done").join(", ") || "pages to be free"})` : ""}${o.validators.length ? `; checks: ${o.validators.map((v) => `${v} ${results[o.id]?.[v] || "not run"}`).join(", ")}` : ""}`;
  console.log(STATUSES.map((x) => groups[x].length ? `${x}:\n${groups[x].map(line).join("\n")}` : "").filter(Boolean).join("\n\n"));
}
