import test from "node:test";
import assert from "node:assert/strict";
import { pickBatch, applyOutcome, fieldValue, isBotCheckText, shouldTick, looksSuccessful, robotsAllows, DEFAULT_CONFIG } from "../src/backlinks/rules.mjs";

const T = (id, relevance, mode = "auto", extra = {}) => ({ id, relevance, mode, paid: false, ...extra });
const day = "2026-10-12";

test("never picks manual, skip or paid targets", () => {
  const out = pickBatch([T("a", 5, "manual"), T("b", 5, "skip"), T("c", 5, "auto", { paid: true }), T("d", 1)], {}, day);
  assert.deepEqual(out.map((t) => t.id), ["d"]);
});

test("respects the daily cap, counting earlier attempts today", () => {
  const targets = Array.from({ length: 9 }, (_, i) => T("t" + i, 9 - i));
  assert.equal(pickBatch(targets, {}, day).length, 5);
  assert.equal(pickBatch(targets, { dayCounts: { [day]: 3 } }, day).length, 2);
  assert.equal(pickBatch(targets, { dayCounts: { [day]: 5 } }, day).length, 0);
});

test("highest relevance first", () => {
  assert.deepEqual(pickBatch([T("lo", 1), T("hi", 5), T("mid", 3)], {}, day).map((t) => t.id), ["hi", "mid", "lo"]);
});

test("a transient failure retries once the next day, then is logged as failed", () => {
  const state = {};
  let rec = applyOutcome(state, "x", { kind: "transient", reason: "timeout" }, day);
  assert.equal(rec.status, "retry");
  assert.equal(rec.nextAttemptAfter, "2026-10-13");
  assert.equal(pickBatch([T("x", 3)], state, day).length, 0, "not due yet");
  assert.equal(pickBatch([T("x", 3)], state, "2026-10-13").length, 1, "due the next day");
  rec = applyOutcome(state, "x", { kind: "transient", reason: "timeout again" }, "2026-10-13");
  assert.equal(rec.status, "failed");
  assert.equal(rec.history.length, 2);
  assert.equal(pickBatch([T("x", 3)], state, "2026-10-14").length, 0, "failed targets are never retried");
});

test("bot checks and unknown fields stop for a human, with no retry", () => {
  const state = {};
  const rec = applyOutcome(state, "y", { kind: "needs_human", reason: "captcha" }, day);
  assert.equal(rec.status, "needs_human");
  assert.equal(pickBatch([T("y", 5)], state, "2026-10-20").length, 0);
});

test("a submitted target is not submitted twice", () => {
  const state = {};
  applyOutcome(state, "z", { kind: "submitted", reason: "ok" }, day);
  assert.equal(pickBatch([T("z", 5)], state, "2026-10-20").length, 0);
});

const profile = { name: "Acme Co", contactName: "Alex Example", email: "hello@acme.test", url: "https://acme.test/", tagline: "t", longDescription: "long", pricing: "Contact for pricing", category: "AI automation" };
test("maps common field labels to profile values", () => {
  assert.equal(fieldValue("Your email", profile), "hello@acme.test");
  assert.equal(fieldValue("Tool name", profile), "Acme Co");
  assert.equal(fieldValue("Startup Name", profile), "Acme Co");
  assert.equal(fieldValue("Product URL", profile), "https://acme.test/");
  assert.equal(fieldValue("Website URL", profile), "https://acme.test/");
  assert.equal(fieldValue("Your Name", profile), "Alex Example");
  assert.equal(fieldValue("Description", profile), "long");
  assert.equal(fieldValue("Headline (5-8 words)", profile), "t");
  assert.equal(fieldValue("Pricing", profile), "Contact for pricing");
  assert.equal(fieldValue("Marketing spend next 90 days", profile), null);
});

test("detects bot checks and never treats marketing opt-ins as consent", () => {
  assert.ok(isBotCheckText("Quick Check: What is 2+3?"));
  assert.ok(isBotCheckText("Please complete the CAPTCHA"));
  assert.ok(!isBotCheckText("Tell us about your product"));
  assert.ok(shouldTick("I agree to the terms and conditions"));
  assert.ok(!shouldTick("Send me the newsletter and offers"));
  assert.ok(!shouldTick("I agree to receive marketing updates"));
});

test("recognises success wording and respects robots.txt", () => {
  assert.ok(looksSuccessful("Thank you, your listing is pending review"));
  assert.ok(!looksSuccessful("Fill in the form below"));
  assert.ok(robotsAllows("User-agent: *\nDisallow: /admin", "/submit"));
  assert.ok(!robotsAllows("User-agent: *\nDisallow: /submit", "/submit/new"));
  assert.ok(robotsAllows("User-agent: bot\nDisallow: /", "/submit"));
});

test("default cap is five a day with one retry", () => {
  assert.equal(DEFAULT_CONFIG.maxPerDay, 5);
  assert.equal(DEFAULT_CONFIG.maxAttempts, 2);
});
