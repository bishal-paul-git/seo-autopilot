// Production 2026-11-19/20: one job the database refused to move stopped a whole site's planning; jobs made by hand had
// no budget and could not run; reviewed advice spent the fact-checker's share. These tests keep all three fixed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/god/stores.mjs";
import { advance, jobBudget, estimateCost, isChecked, CHECKED_RUN_FACTOR } from "../src/god/tick.mjs";
import { runOnce } from "../src/god/worker.mjs";
import { makeAgentHandler, callNeedUsd } from "../src/god/agent-runner.mjs";

const NOW = "2026-11-20T10:00:00Z";
const SITE = { id: "A", name: "Plumber", url: "https://plumber.test/" };
const AGENTS = [{ name: "seo-schema-engineer", publishable: true }, { name: "seo-indexing-monitor", publishable: false }];

test("advance: a job the database refuses to move is reported; the site's other jobs still move", async () => {
  const store = new MemoryStore(); store.clock = () => NOW;
  const bad = store.createJob({ siteId: "A", kind: "agent:seo-indexing-monitor", title: "bad", requiresApproval: false });
  const good = store.createJob({ siteId: "A", kind: "agent:seo-indexing-monitor", title: "good", requiresApproval: false });
  const real = store.transition.bind(store);
  store.transition = (id, ...rest) => { if (id === bad.id) throw new Error("transition_job: job needs agency approval first"); return real(id, ...rest); };
  const r = await advance(store, SITE, store.listJobs("A"), [], "seo-god", { now: NOW });
  assert.equal(store.get(good.id).status, "queued", "the other job moved on");
  assert.ok(r.moved.some((m) => m.job === good.id));
  const w = r.waiting.find((x) => x.job === bad.id);
  assert.match(w.reason, /could not move this job: transition_job: job needs agency approval first/);
});

test("advance: a failure following website changes does not stop the rest", async () => {
  const store = new MemoryStore(); store.clock = () => NOW;
  const impl = store.createJob({ siteId: "A", kind: "implement", title: "fix", requiresApproval: false });
  store.get(impl.id).status = "deploying";
  const other = store.createJob({ siteId: "A", kind: "scan", title: "scan", requiresApproval: false });
  const r = await advance(store, SITE, store.listJobs("A"), [], "seo-god", { now: NOW, github: async () => { throw new Error("GitHub down"); } });
  assert.equal(store.get(other.id).status, "queued");
  assert.ok(r.waiting.length >= 1);
});

test("budgets: a job made without one runs with its kind's standard estimate; reviewed advice gets more", () => {
  assert.equal(estimateCost("agent:seo-indexing-monitor", { agentRunUsd: 0.5 }), 0.5);
  assert.equal(estimateCost("agent:seo-schema-engineer", { agentRunUsd: 0.5, checked: true }), 0.5 * CHECKED_RUN_FACTOR);
  assert.equal(estimateCost("scan", { agentRunUsd: 0.5, checked: true }), 0, "free work stays free");
  assert.equal(isChecked({ kind: "agent:seo-schema-engineer", inputs: {} }, AGENTS), true, "publishable");
  assert.equal(isChecked({ kind: "agent:seo-indexing-monitor", risk: "high", inputs: {} }, AGENTS), true, "high risk");
  assert.equal(isChecked({ kind: "agent:seo-indexing-monitor", inputs: {} }, AGENTS), false);
  assert.equal(isChecked({ kind: "agent:seo-fact-checker", risk: "high", inputs: {} }, AGENTS), false, "the reviewer is not reviewed");
  assert.equal(jobBudget({ kind: "agent:seo-indexing-monitor", budgetUsd: 0 }, { agentRunUsd: 0.25, agents: AGENTS }), 0.25);
  assert.equal(jobBudget({ kind: "agent:seo-indexing-monitor", budgetUsd: 0.1 }, { agentRunUsd: 0.25, agents: AGENTS }), 0.1, "a budget someone set is kept");
});

test("worker: a $0 job runs with the budget runOnce is given, not $0", async () => {
  const store = new MemoryStore(); store.clock = () => NOW;
  const j = store.createJob({ siteId: "A", kind: "agent:seo-indexing-monitor", title: "t", requiresApproval: false });
  store.transition(j.id, "scoped", "t"); store.transition(j.id, "queued", "t");
  let seen = null;
  const handlers = { "agent:*": async (_job, ctx) => { seen = ctx.budgetUsd; return { escalate: "stop here", evidence: [], costUsd: 0 }; } };
  await runOnce({ store, handlers, budgetOf: (x) => jobBudget(x, { agentRunUsd: 0.5, agents: AGENTS }) });
  assert.equal(seen, 0.5);
});

const SITE_MEMORY = () => { const s = new MemoryStore(); s.clock = () => NOW; s.writeMemory("A", [{ kind: "strategy", key: "initial", value: { status: "approved" }, basis: "verified" }]); return s; };
const GOOD = { summary: "s", recommendations: [{ title: "Add FAQ schema to /x", why: "w", evidence: ["e"], impact: "medium", effort: "low", risk: "low", needsApproval: false }], claims: [], questions: [] };
const reply = (o) => ({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(o) }], usage: { input_tokens: 3000, output_tokens: 1000 } });
const VERDICT = reply({ verdict: "pass", problems: [], summary: "ok" });
const seq = (list, calls) => async (_u, o) => { calls.push(JSON.parse(o.body)); return new Response(JSON.stringify(list[Math.min(calls.length - 1, list.length - 1)]), { status: 200 }); };

test("runner: reviewed advice keeps the fact-checker's share aside; the agent's reply is capped below the whole budget", async () => {
  const calls = [], store = SITE_MEMORY();
  const out = await makeAgentHandler({ store, siteOf: async () => SITE, apiKey: "k", fetchImpl: seq([reply(GOOD), VERDICT], calls) })({ siteId: "A", kind: "agent:seo-schema-engineer", title: "T", risk: "low", inputs: { agent: "seo-schema-engineer" } }, { budgetUsd: 0.35 });
  assert.equal(calls.length, 2); assert.equal(out.secondReview.verdict, "pass");
  const plain = []; await makeAgentHandler({ store, siteOf: async () => SITE, apiKey: "k", fetchImpl: seq([reply(GOOD)], plain) })({ siteId: "A", kind: "agent:seo-indexing-monitor", title: "T", risk: "low", inputs: { agent: "seo-indexing-monitor" } }, { budgetUsd: 0.35 });
  assert.ok(calls[0].max_tokens < plain[0].max_tokens, `reviewed run leaves room: ${calls[0].max_tokens} < ${plain[0].max_tokens}`);
  // The reserve covers the reviewer's input and a 1,500-token verdict at the worst price.
  const reserveTokens = (plain[0].max_tokens - calls[0].max_tokens) * 25 / 1e6;
  assert.ok(reserveTokens >= 1500 * 25 / 1e6, "at least a minimal verdict is reserved");
});

test("runner: a budget too small for the run and its review escalates before spending anything", async () => {
  const calls = [], store = SITE_MEMORY();
  const out = await makeAgentHandler({ store, siteOf: async () => SITE, apiKey: "k", fetchImpl: seq([reply(GOOD)], calls) })({ siteId: "A", kind: "agent:seo-schema-engineer", title: "T", inputs: { agent: "seo-schema-engineer" } }, { budgetUsd: 0.12 });
  assert.equal(calls.length, 0, "no model call");
  assert.match(out.escalate, /too small for this run and its fact-check/);
  assert.equal(out.costUsd, 0);
  assert.ok(callNeedUsd("claude-opus-5-5", 3000, 1500) > 0);
});
