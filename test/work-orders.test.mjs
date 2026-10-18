// Work orders: sequencing, page locks and the approval gate are code, so they are tested like code.
import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkOrders, validateWorkOrder, validateOrders, readyOrders, waves, approvalReady, validatorsFor, ordersMarkdown } from "../src/analysis/work-orders.mjs";
import { routeAgents } from "../src/analysis/agent-router.mjs";
import { agentFacts } from "../src/core/agents.mjs";

const facts = agentFacts();
const known = new Set(Object.keys(facts));
const step = (agent, rank, targets = []) => ({ agent, rank, phase: ["onboard", "block", "fix", "content", "grow", "report"][rank], why: "w", evidence: [], prompt: "p", targets });
const ids = (os) => os.map((o) => o.id).sort();

test("agent facts: only agents whose tools allow edits count as editing; validators never edit", () => {
  assert.equal(facts["seo-technical-fixer"].edits, true);
  assert.equal(facts["seo-snippet-optimizer"].edits, true);
  for (const a of ["seo-strategist", "seo-fact-checker", "seo-editor", "seo-compliance-auditor", "seo-link-builder"]) assert.equal(facts[a].edits, false, a);
});

test("validators: content changes need build, facts, fact-checker and editor; sensitive pages add compliance; advice needs none", () => {
  assert.deepEqual(validatorsFor("seo-refresher", facts["seo-refresher"]), ["build", "facts", "seo-fact-checker", "seo-editor"]);
  assert.deepEqual(validatorsFor("seo-refresher", facts["seo-refresher"], { sensitive: true }), ["build", "facts", "seo-fact-checker", "seo-compliance-auditor", "seo-editor"]);
  assert.deepEqual(validatorsFor("seo-redirect-guardian", facts["seo-redirect-guardian"]), ["build", "redirects"]);
  assert.deepEqual(validatorsFor("seo-schema-engineer", facts["seo-schema-engineer"]), ["build", "audit"]);
  assert.deepEqual(validatorsFor("seo-strategist", facts["seo-strategist"]), []);
});

test("a site-wide blocker comes before everything; a page blocker only before work on its pages", () => {
  const orders = buildWorkOrders({ steps: [step("seo-technical-fixer", 1), step("seo-snippet-optimizer", 3, ["/a"]), step("seo-strategist", 3)] }, facts);
  assert.deepEqual(orders.find((o) => o.id === "seo-snippet-optimizer").dependsOn, ["seo-technical-fixer"]);
  assert.deepEqual(orders.find((o) => o.id === "seo-strategist").dependsOn, ["seo-technical-fixer"]);
  const scoped = buildWorkOrders({ steps: [step("seo-indexing-monitor", 1, ["/x"]), step("seo-snippet-optimizer", 3, ["/a"]), step("seo-refresher", 3, ["/x"])] }, facts);
  assert.deepEqual(scoped.find((o) => o.id === "seo-snippet-optimizer").dependsOn, []);
  assert.deepEqual(scoped.find((o) => o.id === "seo-refresher").dependsOn, ["seo-indexing-monitor"]);
});

test("locks: two editing orders on the same page never run together; different pages and advice run in parallel", () => {
  const orders = buildWorkOrders({ steps: [step("seo-snippet-optimizer", 3, ["/a", "/b"]), step("seo-internal-linker", 3, ["/b"]), step("seo-refresher", 3, ["/c"]), step("seo-researcher", 3), step("seo-strategist", 3)] }, facts);
  assert.deepEqual(ids(readyOrders(orders)), ["seo-refresher", "seo-researcher", "seo-snippet-optimizer", "seo-strategist"]);
  // While the snippet optimizer is running on /b, the internal linker waits; once it is done, the linker may start.
  assert.ok(!readyOrders(orders, { "seo-snippet-optimizer": "running" }).some((o) => o.id === "seo-internal-linker"));
  assert.ok(readyOrders(orders, { "seo-snippet-optimizer": "done" }).some((o) => o.id === "seo-internal-linker"));
  assert.deepEqual(waves(orders).map((w) => [...w].sort()), [["seo-refresher", "seo-researcher", "seo-snippet-optimizer", "seo-strategist"], ["seo-internal-linker"]], "two waves");
});

test("a site-scoped editing order locks the whole site", () => {
  const orders = buildWorkOrders({ steps: [step("seo-performance-fixer", 2), step("seo-schema-engineer", 2, ["/a"])] }, facts);
  assert.equal(readyOrders(orders).length, 1);
  assert.equal(waves(orders).length, 2);
});

test("the reporter waits for everything; validation finds bad orders, unknown dependencies and cycles", () => {
  const orders = buildWorkOrders({ steps: [step("seo-strategist", 3), step("seo-reporter", 5), step("seo-researcher", 3)] }, facts);
  assert.deepEqual(orders.find((o) => o.id === "seo-reporter").dependsOn.sort(), ["seo-researcher", "seo-strategist"]);
  assert.deepEqual(validateOrders(orders, known), []);
  const bad = { ...orders[0], status: "maybe", targets: ["no-slash"], scope: "pages", validators: ["vibes"] };
  assert.deepEqual(validateWorkOrder(bad, known).length, 3);
  assert.match(validateOrders([{ ...orders[0], dependsOn: ["ghost"] }], known).join(" "), /unknown ghost/);
  const a = { ...orders[0], id: "a", dependsOn: ["b"] }, b = { ...orders[2], id: "b", dependsOn: ["a"] };
  assert.match(validateOrders([a, b], known).join(" "), /cycle/);
  assert.throws(() => buildWorkOrders({ steps: [step("seo-nobody", 3)] }, facts), /unknown agent/);
});

test("approval gate: ready only when every validator passed", () => {
  const [o] = buildWorkOrders({ steps: [step("seo-refresher", 3, ["/a"])] }, facts);
  assert.deepEqual(approvalReady(o, { build: "pass", facts: "pass" }), { ready: false, failed: [], missing: ["seo-fact-checker", "seo-editor"] });
  assert.equal(approvalReady(o, { build: "pass", facts: "fail", "seo-fact-checker": "pass", "seo-editor": "pass" }).ready, false);
  assert.equal(approvalReady(o, { build: "pass", facts: "pass", "seo-fact-checker": "pass", "seo-editor": "pass" }).ready, true);
});

test("end to end from the router: every order is valid, waves cover all of them, blockers are in wave 1", () => {
  const plan = routeAgents({
    profile: { mode: "edit", signals: { structuredData: ["Organization"] } },
    audit: { issues: [{ rule: "robots-blocks-all", url: "https://a.test/" }, { rule: "title-long", url: "https://a.test/b" }, { rule: "orphan", url: "https://a.test/o" }] },
    links: { items: [{ from: "https://a.test/b", to: "https://a.test/o", reason: "mention" }] },
    ymyl: { pages: [{ url: "https://a.test/b", status: "needs reviewer", topics: ["health"], missing: ["reviewer"] }] },
  });
  const orders = buildWorkOrders(plan, facts, { sensitivePaths: ["/b"] });
  assert.deepEqual(validateOrders(orders, known), []);
  const w = waves(orders);
  assert.equal(w.flat().length, orders.length);
  assert.deepEqual(w[0].filter((id) => orders.find((o) => o.id === id).rank === 1), ["seo-technical-fixer"]);
  assert.equal(orders.find((o) => o.id === "seo-technical-fixer").scope, "site", "robots.txt blocking all is a whole-site order");
  assert.ok(orders.find((o) => o.id === "seo-snippet-optimizer").validators.includes("seo-compliance-auditor"), "a sensitive page adds the compliance check");
  assert.match(ordersMarkdown(orders), /### Wave 1[\s\S]*seo-technical-fixer[\s\S]*### Wave 2/);
});

test("team and work jobs: the plan becomes work orders, starts are refused until dependencies and pages are free, approval needs every check", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const state = mkdtempSync(join(tmpdir(), "seo-work-"));
  writeFileSync(join(state, "site-profile.json"), JSON.stringify({ mode: "edit", signals: { structuredData: ["Organization"] } }));
  writeFileSync(join(state, "audit.json"), JSON.stringify({ issues: [{ rule: "robots-blocks-all", url: "https://s.test/" }, { rule: "title-long", url: "https://s.test/b" }] }));
  const site = { id: "s", name: "S", url: "https://s.test/", labels: {}, content: { type: "sitemap" }, paths: { state, root: state, data: state } };
  const log = console.log; console.log = () => {};
  const work = (await import("../src/jobs/work.mjs")).run;
  const out = [];
  try {
    await (await import("../src/jobs/team.mjs")).run({ site, flags: { dry: true } });
    const file = JSON.parse(readFileSync(join(state, "work-orders.json"), "utf8"));
    assert.ok(file.orders.length >= 3 && file.waves.length >= 2);
    assert.match(readFileSync(join(state, "agent-plan.md"), "utf8"), /## Work orders/);
    await assert.rejects(work({ site, flags: { start: "seo-snippet-optimizer" } }), /Waiting for: seo-technical-fixer/);
    await work({ site, flags: { start: "seo-technical-fixer" } });
    await assert.rejects(work({ site, flags: { done: "seo-snippet-optimizer" } }), /only a running order/);
    await work({ site, flags: { done: "seo-technical-fixer" } });
    await work({ site, flags: { start: "seo-snippet-optimizer" } });
    await assert.rejects(work({ site, flags: { check: "seo-snippet-optimizer", result: "vibes=pass" } }), /name=pass\|fail/);
    await work({ site, flags: { check: "seo-snippet-optimizer", result: "build=pass,facts=pass,seo-fact-checker=pass" } });
    console.log = (m) => out.push(m);
    process.exitCode = 0;
    await work({ site, flags: { ready: "seo-snippet-optimizer" } });
    assert.equal(process.exitCode, 1); assert.match(out.pop(), /Not run yet: seo-editor/);
    await work({ site, flags: { check: "seo-snippet-optimizer", result: "seo-editor=pass" } });
    process.exitCode = 0;
    await work({ site, flags: { ready: "seo-snippet-optimizer" } });
    assert.equal(process.exitCode, 0); assert.match(out.pop(), /every check passed/);
  } finally { console.log = log; process.exitCode = 0; }
  const saved = JSON.parse(readFileSync(join(state, "work-status.json"), "utf8"));
  assert.equal(saved.status["seo-technical-fixer"], "done");
  assert.equal(saved.status["seo-snippet-optimizer"], "running");
});
