// Agent exams (D48): every case can tell a good answer from a bad one, and the runner uses the production path
// (playbooks, fact-checker, budget) with a spending cap. Mocked model; no network, no cost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { caseMemory, gradeExam, scoreboard, examText } from "../src/analysis/exams.mjs";
import { loadCases, runExams, summaryMarkdown, calibrationSheet } from "../scripts/exams.mjs";
import { listAgents } from "../src/core/agents.mjs";

const { cases, fixtures } = loadCases();
const names = new Set(listAgents().map((a) => a.name));

test("cases: real agents, unique ids, memory expands, and each case passes its good sample and fails its bad one", () => {
  assert.ok(cases.length >= 10);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, "unique ids");
  for (const c of cases) {
    assert.ok(names.has(c.agent), `${c.id}: ${c.agent} exists`);
    const mem = caseMemory(c, fixtures);
    assert.ok(mem.length > 3, `${c.id}: memory`);
    assert.ok(c.samples?.good && c.samples?.bad, `${c.id}: samples`);
    const good = gradeExam(c, c.samples.good, mem), bad = gradeExam(c, c.samples.bad, mem);
    assert.ok(good.pass, `${c.id}: good sample fails: ${JSON.stringify(good.checks.filter((x) => !x.pass))}`);
    assert.ok(!bad.pass, `${c.id}: bad sample passes`);
  }
  const noGsc = cases.find((c) => c.id === "pruner-without-search-data");
  assert.ok(!caseMemory(noGsc, fixtures).some((m) => m.key === "search_console"), "drop works");
  const injected = caseMemory(cases.find((c) => c.id === "link-builder-resists-injection"), fixtures).filter((m) => m.key === "description");
  assert.equal(injected.length, 1, "add replaces the fixture row with the same key");
});

test("grader: escalation, recommendation limits and the text it reads", () => {
  const c = { id: "x", agent: "seo-reporter", expect: { escalates: true, maxRecommendations: 1 } };
  assert.ok(gradeExam(c, { escalate: "budget" }).pass);
  assert.ok(!gradeExam(c, { proposal: { summary: "s", recommendations: [{ title: "a" }, { title: "b" }] } }).pass);
  assert.match(examText({ proposal: { summary: "S", recommendations: [{ title: "T", url: "U", why: "W", evidence: ["E"] }] }, claims: [{ text: "C", source: "Src" }], questions: ["Q"] }), /S\nT\nU\nW\nE\nC\nSrc\nQ/);
  const f = { id: "f", agent: "seo-content-pruner", expect: { forbid: [{ url: "https://p.test/a", action: "\\b(remove|delete|noindex)\\b" }] } };
  const rec = (title) => ({ proposal: { summary: "s", recommendations: [{ title, url: "https://p.test/a" }] } });
  assert.ok(gradeExam(f, rec("Refresh /a in place; do not delete or noindex it")).pass, "a negated action is not the action");
  assert.ok(gradeExam(f, rec("Refresh and expand /a (keep, do not merge or remove)")).pass);
  assert.ok(!gradeExam(f, rec("Check /a, then remove it (410) or 301 it")).pass, "the affirmed action still fails");
  assert.ok(!gradeExam(f, rec("Remove /a, not the homepage")).pass);
  const sb = scoreboard([{ agent: "a", pass: true, costUsd: 0.1 }, { agent: "a", pass: false, costUsd: 0.2 }], { model: "m", date: "d" });
  assert.deepEqual(sb.agents.a, { agent: "a", cases: 2, passed: 1, costUsd: 0.3, rate: 0.5 });
});

test("runner: production path with playbooks and the fact-checker, graded, capped, and a scoring sheet", async () => {
  const calls = [];
  const reply = (obj) => ({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }], usage: { input_tokens: 5000, output_tokens: 1000 } });
  const fetchImpl = async (url, o) => {
    const body = JSON.parse(o.body); calls.push(body);
    if (/ANOTHER agent's advice/.test(body.system)) return new Response(JSON.stringify(reply({ verdict: "pass", problems: [], summary: "ok" })), { status: 200 });
    const c = cases.find((x) => body.system.includes(`# SEO ${x.agent === "seo-content-pruner" ? "content pruner" : "\u0000"}`)) ? cases[0] : null;
    return new Response(JSON.stringify(reply({ ...(c ? c.samples.good.proposal : { summary: "No data yet. Supply this: connect Search Console.", recommendations: [] }), claims: [], questions: [] })), { status: 200 });
  };
  await assert.rejects(runExams({ cases, fixtures, apiKey: "" }), /ANTHROPIC_API_KEY/);
  const run = await runExams({ cases, fixtures, apiKey: "k", fetchImpl, agents: ["seo-content-pruner"], maxUsd: 0.55, perCaseUsd: 0.5 });
  assert.equal(run.results.length, 1, "the cap stops the second case");
  assert.equal(run.skipped.length, 2);
  const r = run.results[0];
  assert.equal(r.id, "pruner-keeps-a-linked-page");
  assert.ok(r.knowledge.includes("knowledge/refreshing-and-pruning-content.md"), "the agent got its playbooks");
  assert.deepEqual(r.reviews.map((v) => v.reviewer), ["quality-gate@1", "seo-fact-checker"], "both production reviews ran");
  assert.ok(r.pass, JSON.stringify(r.checks.filter((x) => !x.pass)));
  assert.ok(calls[0].system.includes('<reference name="knowledge/refreshing-and-pruning-content.md">'));
  assert.equal(r.costUsd, 2 * (5000 * 4 / 1e6 + 1000 * 20 / 1e6));
  const md = summaryMarkdown(run, { model: "claude-opus-5-5", date: "2026-11-12" });
  assert.match(md, /\| seo-content-pruner \| 1 \| 1 \|/); assert.match(md, /Not run \(cap\)/);
  const sheet = calibrationSheet(run, cases, { model: "claude-opus-5-5", date: "2026-11-12" });
  assert.match(sheet, /Score \(1-5\)/); assert.match(sheet, /> Keep the 2019 guide/);
});
