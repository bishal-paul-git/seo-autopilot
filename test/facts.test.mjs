// Brief 01 item 3: the facts guard. Every claim needs a verified fact or a source link; ordinary prose must not trip it.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findClaims, checkFacts, jsonStrings } from "../src/analysis/facts.mjs";

const kinds = (t) => findClaims(t).map((c) => `${c.kind}:${c.claim}`);

test("claims: percentages, money, N+, multipliers, rankings, awards and client lists are found", () => {
  assert.deepEqual(kinds("We cut costs by 47% for 500+ clients."), ["percentage:47%", "count:500+"]);
  assert.deepEqual(kinds("Plans from $9.99, or 1,200 GBP a year."), ["money:$9.99", "money:1,200 GBP"]);
  assert.deepEqual(kinds("It is 3x faster and the #1 choice."), ["multiplier:3x faster", "ranking:#1"]);
  assert.deepEqual(kinds("An award-winning team, trusted by banks, as seen in the Times."), ["award:award-winning", "named clients:trusted by", "named clients:as seen in"]);
});

test("ordinary prose does not trip the guard", () => {
  for (const t of ["Open 24/7 with step 1 and step 2.", "A product catalogue used by customers.", "Can AI give advice to our clients?", "In 2026 we moved offices.", "Call 0800 123 456."]) assert.deepEqual(findClaims(t), [], t);
});

test("the sentence is kept whole across decimal points, so the evidence reads properly", () => {
  const [c] = findClaims("Intro. Starter at $9.99 a month. Next.");
  assert.equal(c.sentence, "Starter at $9.99 a month.");
});

test("a verified fact covers only the claim inside its own text, not every number in the same string", () => {
  const facts = [{ match: "Starter at $9.99 a month", source: "pricing page", status: "owner-confirmed" }, { match: "default 15% commission", source: "terms", status: "needs-owner-check" }];
  const r = checkFacts([{ where: "p", text: "Starter at $9.99 a month, Builder at $19.99 a month. A default 15% commission, so sellers keep 85%." }], facts);
  assert.deepEqual(r.verified.map((c) => c.claim), ["$9.99"]);
  assert.deepEqual(r.pending.map((c) => c.claim), ["15%"]);
  assert.deepEqual(r.unverified.map((c) => c.claim), ["$19.99", "85%"]);
});

test("a source link in the same sentence counts as sourced, not as verified", () => {
  const r = checkFacts([{ where: "p", text: "About 60% of people search on mobile ([study](https://example.org/s)). Another 30% do not." }], []);
  assert.deepEqual(r.sourced.map((c) => c.claim), ["60%"]);
  assert.deepEqual(r.unverified.map((c) => c.claim), ["30%"]);
});

test("JSON strings are walked with their path; URLs, slugs, images and dates are skipped", () => {
  const s = jsonStrings({ title: "Up 20%", url: "https://x/50%", slug: "100-plus", images: ["a-50%.png"], faqs: [{ a: "From $5" }], publishAt: "2026-01-01" });
  assert.deepEqual(s, [{ where: "title", text: "Up 20%" }, { where: "faqs[0].a", text: "From $5" }]);
});

const quiet = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

test("facts job: reads json content files, writes the report, and exits 1 only in strict mode", async () => {
  const { run } = await import("../src/jobs/facts.mjs");
  const root = mkdtempSync(join(tmpdir(), "seo-facts-"));
  mkdirSync(join(root, "content")); mkdirSync(join(root, "seo-autopilot"));
  writeFileSync(join(root, "content", "pages.json"), JSON.stringify([{ slug: "a", title: "We save 30% on average", body: "Trusted by 200+ firms." }]));
  writeFileSync(join(root, "content", "broken.json"), "{ not json");
  writeFileSync(join(root, "seo-autopilot", "verified-facts.json"), JSON.stringify({ facts: [{ match: "We save 30% on average", source: "2025 customer survey", status: "owner-confirmed" }] }));
  const site = { id: "s", name: "S", url: "https://s.test/", sitemap: "https://s.test/sitemap.xml", content: { type: "json", include: ["content/*.json"] }, paths: { root, state: join(root, ".state"), data: join(root, "seo-autopilot") } };
  const code = process.exitCode;
  await quiet(() => run({ site, flags: {} }));
  assert.equal(process.exitCode, code, "warn mode never fails the run");
  const r = JSON.parse(readFileSync(join(root, ".state", "facts.json"), "utf8"));
  assert.deepEqual(r.verified.map((c) => c.claim), ["30%"]);
  assert.deepEqual(r.unverified.map((c) => `${c.where}|${c.claim}`), ["content/pages.json: [0].body|Trusted by", "content/pages.json: [0].body|200+"]);
  assert.deepEqual(r.broken, ["content/broken.json: not valid JSON"]);
  await quiet(() => run({ site, flags: { strict: true, files: "content/pages.json" } }));
  assert.equal(process.exitCode, 1); process.exitCode = code;
  assert.match(readFileSync(join(root, ".state", "facts.md"), "utf8"), /\*\*200\+\*\* \(count\)/);
});

test("router: unverified claims send the fact-checker; strict mode makes it a blocker", async () => {
  const { routeAgents } = await import("../src/analysis/agent-router.mjs");
  const base = { profile: { mode: "edit", signals: { structuredData: ["Organization"] } } };
  const facts = { unverified: [{ where: "content/a.json: [0].body", claim: "47%" }] };
  const step = (f) => routeAgents({ ...base, facts: f }).steps.find((s) => s.agent === "seo-fact-checker");
  assert.equal(step(facts).phase, "content");
  assert.deepEqual(step(facts).evidence, ["content/a.json: [0].body: 47%"]);
  assert.equal(step({ ...facts, strict: true }).phase, "block");
  assert.equal(step({ unverified: [] }), undefined);
});
