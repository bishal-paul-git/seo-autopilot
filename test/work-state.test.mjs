import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileWork, withWorkLock, writeWorkJson, workView, assertNoRunningReplan } from "../src/core/work-state.mjs";
import { run } from "../src/jobs/work.mjs";
import { buildWorkOrders } from "../src/analysis/work-orders.mjs";
import { agentFacts } from "../src/core/agents.mjs";
import { collectSiteData } from "../src/core/collect.mjs";
import { renderDashboard } from "../src/jobs/dashboard.mjs";
import { runInNewContext } from "node:vm";
import { spawn } from "node:child_process";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "work-evidence-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const site = { id: "sample", url: "https://example.test/", name: "Example", content: { type: "sitemap" }, paths: { state: dir, backlinks: dir, root: dir, data: dir } };
  const orders = buildWorkOrders({ steps: [
    { agent: "seo-snippet-optimizer", rank: 2, targets: ["/guide"], why: "Title is truncated", evidence: ["audit.json: title-long"], prompt: "Improve the title" },
    { agent: "seo-refresher", rank: 3, targets: ["/guide"], why: "Refresh outdated details", evidence: [], prompt: "Refresh the guide" },
  ] }, agentFacts());
  const plan = { generatedAt: "2026-10-25T00:00:00Z", orders };
  writeWorkJson(join(dir, "work-orders.json"), plan);
  const saved = () => JSON.parse(readFileSync(join(dir, "work-status.json"), "utf8"));
  const work = (flags) => run({ site, flags });
  return { site, plan, dir, saved, work, id: orders[0].id };
}

test("work identity preserves unchanged work, invalidates changed work and dependants, and rejects cross-site plans", (t) => {
  const { site, plan, id } = fixture(t);
  const state = reconcileWork(plan, {}, site);
  state.status[id] = "done"; state.results[id] = { build: "pass" };
  state.status[plan.orders[1].id] = "done";
  assert.equal(reconcileWork({ ...plan, generatedAt: "later" }, state, site).status[id], "done");
  const changed = structuredClone(plan); changed.orders[0].targets = ["/another"];
  const reset = reconcileWork(changed, state, site);
  assert.deepEqual(reset.status, { [id]: "pending", [plan.orders[1].id]: "pending" });
  assert.deepEqual(reset.results[id], {});
  assert.equal(reset.archive.length, 2);
  assert.throws(() => reconcileWork(plan, state, { ...site, url: "https://other.test/" }), /another site/);
  assert.throws(() => reconcileWork({ ...plan, site: { id: "other", url: "https://other.test/" } }, {}, site), /another site/);
  const legacy = { status: { [id]: "done" }, results: { [id]: { build: "pass" } } };
  assert.equal(reconcileWork(plan, legacy, site).status[id], "pending", "unbound legacy passes cannot be reused");
});

test("running work cannot be replaced or removed by a new team plan", (t) => {
  const { site, plan, id } = fixture(t);
  const state = reconcileWork(plan, {}, site); state.status[id] = "running";
  assert.doesNotThrow(() => assertNoRunningReplan(state, reconcileWork(plan, state, site)));
  const changed = structuredClone(plan); changed.orders[0].prompt = "Different work";
  assert.throws(() => assertNoRunningReplan(state, reconcileWork(changed, state, site)), /cannot replace running work/);
  assert.throws(() => assertNoRunningReplan(state, reconcileWork({ orders: [] }, state, site)), /cannot replace running work/);
});

test("work transactions fail closed under contention, release locks after errors, and replace state atomically", (t) => {
  const { dir } = fixture(t);
  assert.throws(() => withWorkLock(dir, () => withWorkLock(dir, () => {})), /state is locked/);
  assert.equal(existsSync(join(dir, "work.lock")), false);
  assert.throws(() => withWorkLock(dir, () => { throw new Error("crash"); }), /crash/);
  assert.doesNotThrow(() => withWorkLock(dir, () => writeWorkJson(join(dir, "saved.json"), { ok: true })));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "saved.json"))), { ok: true });
});

test("a separate process cannot mutate work while a writer holds the lock", async (t) => {
  const { dir, site, id } = fixture(t);
  const moduleUrl = new URL("../src/core/work-state.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import { withWorkLock } from ${JSON.stringify(moduleUrl)}; withWorkLock(${JSON.stringify(dir)}, () => { process.stdout.write('locked\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000); });`], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`writer exited before locking: ${code}`)));
  });
  await assert.rejects(run({ site, flags: { start: id } }), /state is locked/);
  assert.equal(existsSync(join(dir, "work-status.json")), false, "refused writer creates no partial state");
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(existsSync(join(dir, "work.lock")), true, "crashed lock requires deliberate recovery");
});

test("attempt lifecycle clears failed checks on retry, retains failures and spend, caps retries and honours pause", async (t) => {
  const { site, saved, work, id } = fixture(t);
  await assert.rejects(work({ check: id, result: "build=pass" }), /running work/);
  await work({ start: id });
  await work({ check: id, result: "build=fail" });
  await work({ fail: id, reason: "Build failed", "cost-usd": "0.20" });
  assert.equal(saved().records[id].attempts[0].failure, "Build failed");
  await work({ retry: id });
  assert.deepEqual(saved().results[id], {});
  site.autopilot = { paused: true };
  await assert.rejects(work({ start: id }), /paused/);
  site.autopilot.paused = false;
  await work({ start: id });
  await assert.rejects(work({ done: id, "cost-usd": "-2" }), /non-negative/);
  await assert.rejects(work({ done: id, "cost-usd": true }), /non-negative/);
  assert.equal(saved().status[id], "running");
  await work({ fail: id, reason: "Validation failed", "cost-usd": "0.30" });
  assert.equal(saved().records[id].costUsd, 0.5);
  await work({ retry: id }); await work({ start: id }); await work({ fail: id });
  assert.equal(saved().records[id].costUsd, null, "missing spend is unknown, not zero");
  await assert.rejects(work({ retry: id }), /retry limit/);
  await assert.rejects(work({ ready: id }), /not run successfully/);
});

test("dashboard data shows incomplete checks as needs review, never treats a plan as agent execution, and escapes output", async (t) => {
  const { site, work, id } = fixture(t);
  assert.equal(workView(site).items[0].status, "queued");
  assert.equal(workView(site).items[0].attempts.length, 0);
  await work({ start: id });
  await work({ done: id, output: "</script><script>alert(1)</script>" });
  const view = workView(site).items[0];
  assert.equal(view.status, "needs review");
  assert.equal(view.publication, "not recorded");
  assert.equal(view.costUsd, null);
  const data = await collectSiteData(site);
  assert.equal(data.work.items[0].status, "needs review");
  assert.equal(data.dataMode, "saved snapshot");
  const html = renderDashboard(data);
  assert.ok(!html.includes("</script><script>alert(1)</script>"));
  assert.match(html, /Generating this page does not refresh/);
  const app = { innerHTML: "" };
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { document: { querySelector: () => app } });
  assert.match(app.innerHTML, /needs review/);
  assert.match(app.innerHTML, /Cost: unknown/);
  assert.match(app.innerHTML, /&lt;\/script&gt;/, "output reference rendered as text");
});

test("team refuses changed running work without overwriting the existing plan", async (t) => {
  const { site, dir } = fixture(t);
  const team = (await import("../src/jobs/team.mjs")).run;
  writeFileSync(join(dir, "site-profile.json"), JSON.stringify({ mode: "edit", signals: {} }));
  writeFileSync(join(dir, "audit.json"), JSON.stringify({ issues: [{ rule: "title-long", url: "https://example.test/guide" }] }));
  await team({ site, flags: { dry: true } });
  await run({ site, flags: { start: "seo-snippet-optimizer" } });
  const before = readFileSync(join(dir, "work-orders.json"), "utf8");
  writeFileSync(join(dir, "audit.json"), JSON.stringify({ issues: [{ rule: "title-long", url: "https://example.test/new-guide" }] }));
  await assert.rejects(team({ site, flags: { dry: true } }), /cannot replace running work/);
  assert.equal(readFileSync(join(dir, "work-orders.json"), "utf8"), before);
});
