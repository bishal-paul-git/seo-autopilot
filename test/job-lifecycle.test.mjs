import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOVES, STATUSES, canMove, needsApproval, afterFailure, queueOrder } from "../src/core/job-lifecycle.mjs";

const sql = readFileSync(new URL("../cloud/portal/supabase/migrations/20261108000000_r1_contracts.sql", import.meta.url), "utf8");

test("the JS move table and the database's private.job_move_allowed list the same moves", () => {
  const body = /function private\.job_move_allowed[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)[1];
  const fromSql = [...body.matchAll(/\('([a-z_]+)','([a-z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
  assert.deepEqual(fromSql, MOVES.map(([a, b]) => `${a}>${b}`).sort());
  const statusCheck = /status text not null default 'proposed' check \(status in \(([^)]*)\)\)/.exec(sql)[1];
  assert.deepEqual(statusCheck.match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1)), STATUSES);
  for (const [a, b] of MOVES) assert.ok(STATUSES.includes(a) && STATUSES.includes(b), `${a}>${b}`);
});

test("nothing that needs approval queues, runs, authorizes or deploys without it", () => {
  const job = { status: "scoped", risk: "high", source: "seo_god" };
  assert.equal(canMove(job, "queued").reason, "job needs agency approval first");
  assert.ok(canMove(job, "awaiting_approval").ok);
  assert.equal(canMove({ ...job, status: "awaiting_approval" }, "authorized").reason, "only an agency approval can authorize or reject");
  assert.ok(canMove({ ...job, status: "awaiting_approval" }, "authorized", { actor: "agency", approved: true }).ok);
  assert.ok(needsApproval({ source: "client_submission" }) && needsApproval({ risk: "high" }) && !needsApproval({ risk: "medium" }));
  assert.equal(canMove({ status: "awaiting_approval", risk: "low" }, "rejected").reason, "only an agency approval can authorize or reject");
});

test("independent review gates medium and high risk; low-risk read-only work completes directly", () => {
  const med = { status: "awaiting_review", risk: "medium" };
  assert.equal(canMove(med, "authorized").reason, "job needs a passing independent review");
  assert.ok(canMove(med, "authorized", { reviewed: true }).ok);
  assert.ok(canMove({ status: "running", risk: "low" }, "completed").ok);
  assert.ok(!canMove({ status: "running", risk: "medium" }, "completed").ok);
});

test("retries are capped and escalate; illegal moves are refused; queue order follows Q07", () => {
  assert.deepEqual(afterFailure({ attempts: 1, maxAttempts: 3 }), { next: "queued", delayMinutes: 5 });
  assert.deepEqual(afterFailure({ attempts: 3, maxAttempts: 3 }), { next: "escalated", delayMinutes: 0 });
  assert.equal(canMove({ status: "failed", attempts: 3, maxAttempts: 3 }, "queued").reason, "retry cap reached: escalate");
  assert.match(canMove({ status: "completed" }, "running").reason, /cannot move/);
  const q = queueOrder([{ id: "opp", priority: 3, createdAt: "1" }, { id: "fix", priority: 2, createdAt: "2" }, { id: "ask", priority: 1, createdAt: "3" }]);
  assert.deepEqual(q.map((j) => j.id), ["ask", "fix", "opp"]);
});
