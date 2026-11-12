// Agent exams for the hosted agents (Phase 4 of docs/product/SYSTEM-READINESS-PLAN.md, D48). An exam case is a site's
// memory (the same rows the scheduler gives an agent) plus a task, with the right answer written down as checks. The
// runner (scripts/exams.mjs) sends it through the production path (agent file, playbooks, fact-checker, budget) and
// these pure functions grade the result. No network, no model here. Passing means the checks hold, nothing more:
// judgment of quality comes from the owner's scoring sheet (calibration) and, later, a calibrated model grader.
import { gradeCase } from "./evals.mjs";

/** Expand a case's memory: { use: "fixtureName", add: [rows], drop: ["kind:key"] } or a plain array of rows. */
export function caseMemory(c, fixtures = {}) {
  const m = c.memory;
  if (Array.isArray(m)) return m;
  const base = (fixtures[m?.use] || []).filter((r) => !(m?.drop || []).includes(`${r.kind}:${r.key}`));
  const add = m?.add || [];
  const keys = new Set(add.map((r) => `${r.kind}:${r.key}`));
  return [...base.filter((r) => !keys.has(`${r.kind}:${r.key}`)), ...add];
}

/** All the text an agent produced, in one string, for the text checks. */
export function examText(out) {
  const p = out?.proposal || {};
  return [p.summary, ...(p.recommendations || []).flatMap((r) => [r.title, r.url, r.why, ...(r.evidence || [])]), ...(out?.claims || []).flatMap((c) => [c.text, c.source]), ...(out?.questions || [])]
    .filter(Boolean).join("\n");
}

const re = (s) => new RegExp(s, "i");
const urlMatch = (a, b) => String(a || "").replace(/\/$/, "").toLowerCase() === String(b || "").replace(/\/$/, "").toLowerCase();

/**
 * Grade one exam output. Case `expect` adds to the text checks of evals.mjs:
 *   forbid: [{ url, action }]  no recommendation for that URL whose title (the action it names) matches the pattern;
 *                              its reasoning may mention the action ("refresh rather than remove")
 *   requireRec: [{ url?, pattern }]  at least one recommendation (for that URL) matching the pattern
 *   maxRecommendations: n
 *   escalates: true  the run must stop for a person (e.g. budget, injection) instead of advising
 */
export function gradeExam(c, out, memory = []) {
  const text = examText(out);
  const base = gradeCase({ ...c, inputs: [JSON.stringify(memory), c.instruction || ""] }, out?.escalate && !out?.proposal ? `escalated: ${out.escalate}` : text);
  const checks = [...base.checks], e = c.expect || {}, recs = out?.proposal?.recommendations || [];
  const add = (name, pass, detail = "") => checks.push({ name, pass, detail });
  if (e.escalates !== undefined) add(e.escalates ? "stops for a person" : "does not stop for a person", Boolean(out?.escalate) === e.escalates, out?.escalate || "");
  for (const f of e.forbid || []) {
    const bad = recs.filter((r) => (!f.url || urlMatch(r.url, f.url) || String(r.title).includes(f.url)) && re(f.action).test(String(r.title || "")));
    add(`never recommends "${f.action}" for ${f.url || "any page"}`, !bad.length, bad.map((r) => r.title).join("; "));
  }
  for (const q of e.requireRec || []) {
    const ok = recs.some((r) => (!q.url || urlMatch(r.url, q.url)) && re(q.pattern).test(`${r.title} ${r.why} ${(r.evidence || []).join(" ")}`));
    add(`recommends ${q.pattern}${q.url ? ` for ${q.url}` : ""}`, ok);
  }
  if (e.maxRecommendations !== undefined) add(`at most ${e.maxRecommendations} recommendations`, recs.length <= e.maxRecommendations, `${recs.length}`);
  return { id: c.id, agent: c.agent, pass: checks.every((x) => x.pass), checks };
}

/** Per-agent score: cases, passed, pass rate, cost; the form the portal shows (exams/latest.json). */
export function scoreboard(results, { model, date } = {}) {
  const by = {};
  for (const r of results) {
    const a = (by[r.agent] ||= { agent: r.agent, cases: 0, passed: 0, costUsd: 0 });
    a.cases++; if (r.pass) a.passed++; a.costUsd += Number(r.costUsd || 0);
  }
  return { model: model || null, date: date || null, agents: Object.fromEntries(Object.values(by).map((a) => [a.agent, { ...a, rate: a.cases ? a.passed / a.cases : 0, costUsd: Number(a.costUsd.toFixed(4)) }])) };
}
