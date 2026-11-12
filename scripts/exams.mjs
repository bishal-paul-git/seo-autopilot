// Agent exams (D48): run each exam case through the PRODUCTION agent path (the agent's file, its playbooks and skills,
// the fact-checker's second opinion for content and high-risk work, the budget rules) and grade the result.
// Costs money on YOUR Anthropic key; capped by --max-usd. Cases are made-up businesses (exams/cases.json), never client data.
//   ANTHROPIC_API_KEY=... node scripts/exams.mjs [--agents a,b] [--max-usd 5] [--model claude-opus-5-5] [--out exams/results] [--publish]
// Writes <out>/<date>-<model>.json (every output and check), <out>/<date>-<model>.md (summary) and a calibration sheet
// for a person to score; --publish also writes exams/latest.json, which the portal shows on each agent's page.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeAgentHandler, PRICES } from "../src/god/agent-runner.mjs";
import { reviewOutput } from "../src/god/review.mjs";
import { MemoryStore } from "../src/god/stores.mjs";
import { caseMemory, gradeExam, scoreboard, examText } from "../src/analysis/exams.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const loadCases = (file = join(ROOT, "exams/cases.json")) => JSON.parse(readFileSync(file, "utf8"));

/** Run the cases; returns { results, spentUsd, skipped }. fetchImpl and apiKey are injectable for tests. */
export async function runExams({ cases, fixtures, apiKey, model = "claude-opus-5-5", fetchImpl = (...a) => fetch(...a), maxUsd = 5, perCaseUsd = 0.5, agents = null, log = () => {} }) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (exams use your own key)");
  if (!PRICES[model]) throw new Error(`no price for ${model}`);
  const results = [], skipped = []; let spent = 0;
  for (const c of cases) {
    if (agents && !agents.includes(c.agent)) continue;
    if (spent + perCaseUsd > maxUsd) { skipped.push({ id: c.id, reason: `would pass the $${maxUsd} cap` }); continue; }
    const store = new MemoryStore(), memory = caseMemory(c, fixtures), site = { id: "exam", name: "Exam site", url: "https://plumber.test/" };
    store.writeMemory("exam", memory);
    const handler = makeAgentHandler({ store, siteOf: async () => site, apiKey, model, fetchImpl });
    const job = { id: c.id, siteId: "exam", kind: `agent:${c.agent}`, agent: c.agent, title: c.instruction || c.id, risk: c.risk || "low", budgetUsd: perCaseUsd, inputs: { agent: c.agent, instruction: c.instruction || null } };
    let out;
    try { out = await handler(job, { budgetUsd: perCaseUsd }); } catch (e) { out = { escalate: `error: ${e.message}`, costUsd: 0 }; }
    spent += Number(out.costUsd || 0);
    const gate = out.escalate ? null : reviewOutput(job, { ...out, costUsd: out.costUsd }, { siteHost: "plumber.test" });
    const g = gradeExam(c, out, memory);
    // The run passes only when the grader's checks pass AND the production reviews would let it through.
    const reviews = [gate && { reviewer: gate.reviewer, verdict: gate.verdict, reasons: gate.reasons }, out.secondReview && { reviewer: out.secondReview.reviewer, verdict: out.secondReview.verdict, reasons: out.secondReview.reasons }].filter(Boolean);
    const reviewsPass = !c.expect?.escalates ? reviews.every((r) => r.verdict === "pass") && !out.escalate : true;
    results.push({ ...g, pass: g.pass && reviewsPass, gradedPass: g.pass, reviews, escalate: out.escalate || null, costUsd: Number(out.costUsd || 0), knowledge: out.proposal?.knowledge || [], output: { proposal: out.proposal || null, claims: out.claims || [], questions: out.questions || [] } });
    log(`${g.pass && reviewsPass ? "pass" : "FAIL"} ${c.id} $${Number(out.costUsd || 0).toFixed(4)}`);
  }
  return { results, spentUsd: Number(spent.toFixed(4)), skipped };
}

export function summaryMarkdown({ results, spentUsd, skipped }, { model, date }) {
  const sb = scoreboard(results, { model, date });
  return `# Agent exams, ${date}

Model: ${model}. Cases: ${results.length}. Spent: $${spentUsd.toFixed(2)} (your key). A case passes when its checks pass and the production reviews (quality gate, and the fact-checker for content and high-risk work) let the output through. Checks are minimum bars, not a judgment of quality: see the calibration sheet.

| Agent | Cases | Passed | Cost |
|---|---|---|---|
${Object.values(sb.agents).map((a) => `| ${a.agent} | ${a.cases} | ${a.passed} | $${a.costUsd.toFixed(2)} |`).join("\n")}

${results.filter((r) => !r.pass).map((r) => `## Failed: ${r.id}\n${r.checks.filter((x) => !x.pass).map((x) => `- ${x.name}${x.detail ? `: ${x.detail}` : ""}`).join("\n")}${r.reviews.filter((v) => v.verdict !== "pass").map((v) => `\n- review ${v.reviewer}: ${v.verdict}${v.reasons?.length ? ` (${v.reasons.join("; ")})` : ""}`).join("")}${r.escalate ? `\n- stopped: ${r.escalate}` : ""}`).join("\n\n")}
${skipped.length ? `\nNot run (cap): ${skipped.map((s) => s.id).join(", ")}\n` : ""}`;
}

/** A sheet for a person (or a person with a helper) to score each output 1 to 5; their scores calibrate a model grader later. */
export function calibrationSheet({ results }, cases, { model, date }) {
  const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
  return `# Scoring sheet: agent exams ${date} (${model})

For each output, give a score from 1 to 5 and one line on why. 5: you would send it to a client as is. 3: useful but needs edits. 1: wrong or harmful. Judge the advice, not the formatting. Return the filled sheet; the scores are used to check the automatic grader.

${results.map((r, i) => `## ${i + 1}. ${r.agent}: ${byId[r.id]?.instruction || r.id}
Case: \`${r.id}\` · automatic checks: ${r.pass ? "pass" : "fail"}

${examText(r.output).split("\n").map((l) => `> ${l}`).join("\n") || "> (no advice: stopped for a person)"}

**Score (1-5):** \n**Why:** \n`).join("\n")}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const model = opt("--model", "claude-opus-5-5"), date = new Date().toISOString().slice(0, 10), out = resolve(opt("--out", join(ROOT, "exams/results")));
  const { cases, fixtures } = loadCases();
  const run = await runExams({ cases, fixtures, apiKey: process.env.ANTHROPIC_API_KEY, model, maxUsd: Number(opt("--max-usd", "5")), agents: opt("--agents") ? opt("--agents").split(",") : null, log: console.log });
  mkdirSync(out, { recursive: true });
  const base = join(out, `${date}-${model}`);
  writeFileSync(`${base}.json`, JSON.stringify({ model, date, ...run }, null, 2) + "\n");
  writeFileSync(`${base}.md`, summaryMarkdown(run, { model, date }));
  writeFileSync(`${base}-scoring-sheet.md`, calibrationSheet(run, cases, { model, date }));
  if (args.includes("--publish")) writeFileSync(join(ROOT, "exams/latest.json"), JSON.stringify(scoreboard(run.results, { model, date }), null, 2) + "\n");
  console.log(summaryMarkdown(run, { model, date }));
  if (run.results.some((r) => !r.pass)) process.exitCode = 1;
}
