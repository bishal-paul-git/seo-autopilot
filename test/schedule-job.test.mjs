import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/jobs/schedule.mjs";

test("schedule on a sitemap-only site is a quiet no-op, not a failure", async () => {
  const logs = []; const orig = console.log; console.log = (m) => logs.push(String(m));
  const out = process.env.GITHUB_OUTPUT; delete process.env.GITHUB_OUTPUT;
  try {
    await run({ site: { content: { type: "sitemap" } }, flags: {} });
    await run({ site: {}, flags: {} });
  } finally { console.log = orig; if (out !== undefined) process.env.GITHUB_OUTPUT = out; }
  assert.match(logs[0], /Nothing to schedule: content\.type is "sitemap"/);
  assert.match(logs[1], /content\.type is "none"/);
});
