#!/usr/bin/env node
// Measures CPU time (not wall time) of each SEO God step on real websites, to decide where each step can run:
// Cloudflare Workers Free allows 10 ms CPU per invocation (and per Workflow step); Supabase Edge Functions allow 2 s.
// Node and Workers both run V8, so these numbers are an estimate of Workers CPU, not a measurement inside Workers.
//   NODE_USE_ENV_PROXY=1 node scripts/cf-measure.mjs https://example.com [more URLs] > measurements.json
import { scanSite } from "../src/hosted/scan.mjs";
import { buildDossier, dossierMemory } from "../src/god/onboarding.mjs";
import { reportMemory } from "../src/god/handlers.mjs";
import { planSite } from "../src/god/planner.mjs";
import { strategyStatus, reportsFrom } from "../src/god/tick.mjs";
import { agentInput, agentPrompt, parseReply } from "../src/god/agent-runner.mjs";

const cpu = async (fn) => { const t = process.cpuUsage(); const out = await fn(); const d = process.cpuUsage(t); return { ms: (d.user + d.system) / 1000, out }; };
const urls = process.argv.slice(2);
if (!urls.length) { console.error("usage: node scripts/cf-measure.mjs <url> [...]"); process.exit(2); }
const results = [];
for (const url of urls) {
  const site = { id: "measure", name: new URL(url).hostname, url };
  const w0 = Date.now();
  const scan = await cpu(() => scanSite(site, { maxPages: 60 }));
  const wall = Date.now() - w0, r = scan.out, pages = r.audit.summary.pagesCrawled;
  const dossier = await cpu(() => { const d = buildDossier({ site, discovered: r.discovered, profile: r.profile, audit: r.audit }); return [...dossierMemory(d), ...reportMemory(r)]; });
  const memory = dossier.out.map((m) => ({ ...m, value: m.value }));
  const compact = JSON.stringify(reportMemory(r)), compactParse = await cpu(() => JSON.parse(compact));
  const plan = await cpu(() => planSite({ site, reports: reportsFrom(memory), strategy: { status: strategyStatus([], [{ kind: "strategy", key: "initial", value: { status: "approved" } }]) }, now: new Date().toISOString() }));
  const prompt = await cpu(() => agentPrompt("seo-reporter").length + agentInput({ kind: "agent:seo-reporter", title: "Report", inputs: { agent: "seo-reporter" } }, memory, site).length);
  const reply = JSON.stringify({ summary: "s", recommendations: [...Array(8)].map((_, i) => ({ title: `t${i}`, url, why: "w".repeat(300), evidence: ["e"], effort: "small" })), claims: [], questions: [] });
  const parse = await cpu(() => parseReply(reply));
  results.push({ url, pages, wallMs: wall, cpuMs: { scanTotal: round(scan.ms), scanPerPage: round(scan.ms / Math.max(1, pages)), dossierAndMemory: round(dossier.ms), compactReportParse: round(compactParse.ms), planSite: round(plan.ms), agentPromptBuild: round(prompt.ms), agentReplyParse: round(parse.ms) }, compactReportBytes: compact.length, plannedJobs: plan.out.jobs.length });
}
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, note: "CPU from process.cpuUsage in Node (same V8 as Workers); an estimate of Workers CPU, includes first-call JIT warm-up", results }, null, 1));
function round(n) { return Math.round(n * 100) / 100; }
