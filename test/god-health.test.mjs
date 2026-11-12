import { test } from "node:test";
import assert from "node:assert/strict";
import { assessHealth, report } from "../scripts/god-health.mjs";

const NOW = Date.parse("2026-11-12T01:30:00Z");
const run = (id, minsAgo, extra = {}) => ({ id, started_at: new Date(NOW - minsAgo * 60000).toISOString(), finished_at: new Date(NOW - minsAgo * 60000 + 2000).toISOString(), paused: false, sites_planned: 0, jobs_run: 0, errors: [], ...extra });

test("healthy: a recent run, errors only in some runs", () => {
  const h = assessHealth([run(9, 15), run(8, 30, { errors: ["plan: timeout"] }), run(7, 45)], NOW);
  assert.equal(h.ok, true); assert.deepEqual(h.problems, []); assert.equal(h.latest.ageMinutes, 15);
});

test("stale: no run for longer than the threshold", () => {
  const h = assessHealth([run(9, 75)], NOW);
  assert.equal(h.ok, false); assert.match(h.problems[0], /no run for 75 minutes/);
});

test("the same errors in every recent run are a problem; a missing run log is a problem", () => {
  const e = { errors: ["due: HTTP 401"] };
  const h = assessHealth([run(4, 5, e), run(3, 20, e), run(2, 35, e), run(1, 50, e)], NOW);
  assert.equal(h.ok, false); assert.match(h.problems.join(" "), /errors in all 4 latest runs: due: HTTP 401/);
  assert.equal(assessHealth([], NOW).ok, false);
});

test("paused is reported but is not a problem; the report never has more than run facts", () => {
  const h = assessHealth([run(9, 10, { paused: true })], NOW);
  assert.equal(h.ok, true); assert.equal(h.paused, true);
  const md = report(h);
  assert.match(md, /OK\*\* \(paused\)/); assert.match(md, /Latest run 9/);
});
