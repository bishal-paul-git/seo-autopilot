// Runs the work orders from `team`: what may start now, and a record of what is running, done, and which checks passed.
//   npx seo-autopilot run work                         what is ready, running and waiting, and why
//   npx seo-autopilot run work --start seo-refresher    refuses unless its dependencies are done and its pages are free
//   npx seo-autopilot run work --check seo-refresher --result build=pass,facts=pass,seo-editor=fail
//   npx seo-autopilot run work --done seo-refresher     (or --fail) when the agent has finished its part
//   npx seo-autopilot run work --ready seo-refresher    exits 1 unless every check has passed (use it before asking for approval)
// State: <state>/<site>/work-status.json. Running editing orders hold their pages; that file is the lock. A new `team` run
// replaces the orders; the status of orders that still exist is kept. It never runs an agent or approves anything.
import { readJson, writeJson } from "../core/util.mjs";
import { readyOrders, approvalReady, STATUSES } from "../analysis/work-orders.mjs";

export const description = "Track the agents' work orders: what may start now (dependencies, page locks), and which checks passed";

export async function run({ site, flags = {} }) {
  const s = site.paths.state;
  const file = readJson(`${s}/work-orders.json`, null);
  if (!file?.orders?.length) { console.log("No work orders yet: run `seo-autopilot run team` first."); return; }
  const orders = file.orders;
  const saved = readJson(`${s}/work-status.json`, { status: {}, results: {}, log: [] });
  const ids = new Set(orders.map((o) => o.id));
  // Forget orders the latest plan no longer contains.
  const status = Object.fromEntries(Object.entries(saved.status || {}).filter(([id]) => ids.has(id)));
  const results = Object.fromEntries(Object.entries(saved.results || {}).filter(([id]) => ids.has(id)));
  const log = saved.log || [];
  const st = (o) => status[o.id] ?? "pending";
  const pick = (name) => {
    const o = orders.find((x) => x.id === flags[name]);
    if (!o) throw new Error(`no work order "${flags[name]}" in work-orders.json (orders: ${orders.map((x) => x.id).join(", ")})`);
    return o;
  };
  const save = (what) => {
    log.push({ at: new Date().toISOString(), what });
    writeJson(`${s}/work-status.json`, { updatedAt: new Date().toISOString(), plan: file.generatedAt, status, results, log: log.slice(-200) });
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
    return save(`started ${o.id}${o.edits ? ` (holds ${o.scope === "site" ? "the whole site" : o.targets.join(", ")})` : ""}`);
  }
  if (flags.check) {
    const o = pick("check");
    const pairs = String(flags.result || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => x.split("="));
    if (!pairs.length || pairs.some(([k, v]) => !o.validators.includes(k) || !["pass", "fail"].includes(v))) throw new Error(`--result must be name=pass|fail for this order's checks: ${o.validators.join(", ") || "(none)"}`);
    results[o.id] = { ...(results[o.id] || {}), ...Object.fromEntries(pairs) };
    return save(`checks for ${o.id}: ${pairs.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }
  for (const end of ["done", "fail"]) {
    if (!flags[end]) continue;
    const o = pick(end);
    if (st(o) !== "running") throw new Error(`${o.id} is ${st(o)}; only a running order can be marked ${end}`);
    status[o.id] = end === "done" ? "done" : "failed";
    return save(`${o.id} ${status[o.id]}`);
  }
  if (flags.ready) {
    const o = pick("ready");
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
