import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRegistry, toMarkdown } from "../scripts/build-registry.mjs";

test("docs/registry.md and registry.json match the code (run node scripts/build-registry.mjs)", async () => {
  const r = await buildRegistry();
  assert.equal(readFileSync(new URL("../docs/registry.md", import.meta.url), "utf8"), toMarkdown(r));
  assert.deepEqual(JSON.parse(readFileSync(new URL("../docs/registry.json", import.meta.url), "utf8")), JSON.parse(JSON.stringify(r)));
});

test("registry facts: every job has a purpose, every agent a department and a risk level", async () => {
  const r = await buildRegistry();
  for (const j of r.jobs) assert.ok(j.purpose && j.mode && j.permissions, j.name);
  for (const a of r.agents) assert.ok(a.department && a.risk && a.purpose, a.name);
  // Only the technical fixer may run an unrestricted shell (CLAUDE.md rule 1).
  assert.deepEqual(r.agents.filter((a) => a.mayRunShell).map((a) => a.name), ["seo-technical-fixer"]);
});
