// Autopilot policy (D17): which changes publish by themselves and which wait for a person. This is the gate that replaces a
// human approval for routine changes, so its edges are tested here.
import test from "node:test";
import assert from "node:assert/strict";
import { resolvePolicy, classifyChange, decide, DEFAULT_LEVELS, HUMAN_ONLY } from "../src/analysis/autonomy.mjs";

const content = ["src/content/**/*.md"];
const md = (n) => `src/content/blog/${n}.md`;

test("defaults: routine fixes publish with undo, new pages and refreshes publish after checks, risky kinds wait for a person", () => {
  const p = resolvePolicy({});
  assert.equal(p.levels.snippet, "undo");
  assert.equal(p.levels["technical-fix"], "undo");
  assert.equal(p.levels["new-page"], "autopilot");
  for (const k of HUMAN_ONLY) assert.equal(p.levels[k], "prepare", k);
  assert.deepEqual(p.limits, { newPagesPerWeek: 3, changesPerDay: 10 });
});

test("overrides: a site can be stricter or looser, but never lets human-only kinds publish by themselves", () => {
  const p = resolvePolicy({ levels: { "new-page": "prepare", snippet: "autopilot", sensitive: "undo", outreach: "autopilot", bogus: "undo", refresh: "yolo" }, limits: { newPagesPerWeek: 1 } });
  assert.equal(p.levels["new-page"], "prepare");
  assert.equal(p.levels.snippet, "autopilot");
  assert.equal(p.levels.sensitive, "prepare");
  assert.equal(p.levels.outreach, "prepare");
  assert.equal(p.ignored.length, 4);
  assert.equal(p.limits.newPagesPerWeek, 1);
});

test("classifying: labels say the intent, files say what is touched, and the strictest reading wins", () => {
  assert.equal(classifyChange({ files: [md("a")], labels: ["seo-snippet"], contentGlobs: content }).cls, "snippet");
  assert.equal(classifyChange({ files: [md("a")], contentGlobs: content }).cls, "refresh");
  assert.equal(classifyChange({ files: [md("a"), "src/layouts/Base.astro"], labels: ["seo-snippet"], contentGlobs: content }).cls, "template");
  assert.equal(classifyChange({ files: ["public/robots.txt"], labels: ["seo-fix"], contentGlobs: content }).cls, "site-wide-indexing");
  assert.equal(classifyChange({ files: [".github/workflows/seo-daily.yml"], contentGlobs: content }).cls, "infrastructure");
  assert.equal(classifyChange({ files: ["package.json", md("a")], labels: ["seo-refresh"], contentGlobs: content }).cls, "infrastructure");
  // The drafting agent cannot make a new page look like a small fix.
  assert.equal(classifyChange({ files: [md("new")], addedFiles: [md("new")], labels: ["seo-snippet"], contentGlobs: content }).cls, "new-page");
});

test("classifying: sensitive topics in the added text always go to a person, whatever the label", () => {
  const c = classifyChange({ files: [md("a")], labels: ["seo-snippet"], contentGlobs: content, addedText: "+Most people can reduce their tax bill by claiming these expenses." });
  assert.equal(c.cls, "sensitive");
  assert.deepEqual(c.sensitiveTopics, ["tax"]);
  assert.equal(classifyChange({ files: [md("a")], contentGlobs: content, addedText: "+Our team ships invoices faster." }).cls, "refresh");
  assert.equal(classifyChange({ files: [md("a")], contentGlobs: content, addedText: "+tax", review: { topics: { tax: [] } } }).cls, "refresh", "a site can switch a topic off");
});

test("deciding: merges only at autopilot or undo, not paused, within limits", () => {
  const p = resolvePolicy({});
  const snip = classifyChange({ files: [md("a")], labels: ["seo-snippet"], contentGlobs: content });
  assert.deepEqual([decide(snip, p).merge, decide(snip, p).watch], [true, true]);
  assert.equal(decide(snip, resolvePolicy({ paused: true })).merge, false);
  assert.equal(decide(snip, resolvePolicy({ enabled: false })).merge, false);
  assert.match(decide(snip, p, { today: 10 }).reasons.join(" "), /daily limit/);
  const page = classifyChange({ files: [md("n")], addedFiles: [md("n")], labels: ["seo-topic"], contentGlobs: content });
  assert.equal(decide(page, p, { newPagesThisWeek: 2 }).merge, true);
  assert.match(decide(page, p, { newPagesThisWeek: 3 }).reasons.join(" "), /scaled content/);
  assert.equal(decide(classifyChange({ files: ["public/robots.txt"], contentGlobs: content }), p).merge, false);
});

test("every default level is a known level and every human-only kind has a default", () => {
  for (const k of HUMAN_ONLY) assert.ok(k in DEFAULT_LEVELS, k);
});

test("autopilot job: prints the policy, and --decide exits 1 for a held change and 0 for an allowed one", async () => {
  const { run } = await import("../src/jobs/autopilot.mjs");
  const site = { name: "S", content: { type: "markdown", dir: "src/content" }, autopilot: {} };
  const log = console.log; let out = ""; console.log = (m) => { out += m + "\n"; };
  try {
    await run({ site, flags: {} });
    assert.match(out, /Publishes by itself, then watches and reverts on regression: .*snippet/);
    process.exitCode = 0;
    await run({ site, flags: { decide: true, files: "src/content/a.md", labels: "seo-snippet" } });
    assert.equal(process.exitCode, 0); assert.match(out, /MERGE: snippet/);
    await run({ site, flags: { decide: true, files: "public/robots.txt" } });
    assert.equal(process.exitCode, 1); assert.match(out, /HOLD: site-wide-indexing/);
    process.exitCode = 0; process.env.SEO_AUTOPILOT_PAUSED = "true";
    await run({ site, flags: { decide: true, files: "src/content/a.md", labels: "seo-snippet" } });
    assert.equal(process.exitCode, 1); assert.match(out, /paused/);
  } finally { console.log = log; process.exitCode = 0; delete process.env.SEO_AUTOPILOT_PAUSED; }
});

test("picking work: only kinds the policy publishes, nothing held, approved or already drafted, within the limits", async () => {
  const { pickWork } = await import("../src/analysis/autonomy.mjs");
  const p = resolvePolicy({});
  const issues = [
    { number: 9, labels: ["seo-topic"] }, { number: 3, labels: ["seo-refresh", "seo-hold"] }, { number: 4, labels: ["seo-refresh", "seo-drafted"] },
    { number: 5, labels: ["seo-outreach"] }, { number: 6, labels: ["seo-refresh"] }, { number: 7, labels: ["question"] }, { number: 8, labels: ["seo-topic"] },
  ];
  assert.deepEqual(pickWork(issues, p, { max: 5 }).map((x) => [x.number, x.cls]), [[6, "refresh"], [8, "new-page"], [9, "new-page"]]);
  assert.deepEqual(pickWork(issues, p, { max: 5, newPagesThisWeek: 2 }).map((x) => x.number), [6, 8], "one new page left this week");
  assert.deepEqual(pickWork(issues, p, { max: 1 }).map((x) => x.number), [6], "oldest first, one per run");
  assert.deepEqual(pickWork(issues, p, { max: 5, today: 10 }), [], "daily limit reached");
  assert.deepEqual(pickWork(issues, resolvePolicy({ paused: true }), { max: 5 }), []);
  assert.deepEqual(pickWork(issues, resolvePolicy({ levels: { refresh: "prepare", "new-page": "prepare" } }), { max: 5 }), []);
});

test("autopilot job --pick: prints the choice and writes the issue number for the workflow", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const d = mkdtempSync(join(tmpdir(), "seo-pick-"));
  writeFileSync(join(d, "issues.json"), JSON.stringify([{ number: 12, labels: [{ name: "seo-refresh" }] }, { number: 2, labels: [{ name: "seo-hold" }, { name: "seo-topic" }] }]));
  const out = join(d, "out"); writeFileSync(out, "");
  const { run } = await import("../src/jobs/autopilot.mjs");
  const log = console.log; let said = ""; console.log = (m) => { said += m; }; process.env.GITHUB_OUTPUT = out;
  try { await run({ site: { name: "S", content: {}, autopilot: {} }, flags: { pick: true, "issues-file": join(d, "issues.json") } }); }
  finally { console.log = log; delete process.env.GITHUB_OUTPUT; }
  assert.match(said, /#12 \(refresh\)/);
  assert.equal(readFileSync(out, "utf8"), "issue=12\n");
});
