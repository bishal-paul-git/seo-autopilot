// Every job module must at least parse and export run() and description, so a syntax slip can never ship in a release.
import test from "node:test";
import assert from "node:assert/strict";
import { JOBS } from "../src/jobs/index.mjs";

for (const [name, load] of Object.entries(JOBS)) {
  test(`job ${name} loads`, async () => {
    const m = await load();
    assert.equal(typeof m.run, "function");
    assert.equal(typeof m.description, "string");
  });
}
