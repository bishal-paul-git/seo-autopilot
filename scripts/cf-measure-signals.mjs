#!/usr/bin/env node
// CPU estimate for the D57 steps at their largest (synthetic site at every size cap), offline:
//   - planning one site with full memory (parse the recall answer, rebuild the reports, detect alerts, route, plan);
//   - the Search Console snapshot's work after Google answers (parse 5 answers and the saved reports, merge the history);
//   - the priorities job (parse the saved reports, the CLI's search analysis and priority engine);
//   - one URL inspection batch (parse 20 answers, merge, bound, serialise);
//   - one agent prompt's data block with every new report;
//   - D60: the strategy draft from every report (the strategy job and the strategy_redraft job, each its own invocation).
// Workers Free allows 10 ms CPU per invocation. Node and Workers both run V8: an estimate, not a measurement in Workers.
// "first" includes JIT warm-up (a fresh Worker isolate); "warm" is the median of 20 more runs.
//   node scripts/cf-measure-signals.mjs            (PART=parse|alerts|reports|plan|inspect|prio measures one piece in a fresh process)
import { mergeHistory } from "../src/analysis/search-history.mjs";
import { detectAlerts } from "../src/analysis/alerts.mjs";
import { prioritiesFrom, plannerReports } from "../src/god/insights.mjs";
import { boundResults, INSPECT_KEEP, INSPECT_PER_DAY } from "../src/god/inspect.mjs";
import { planSite } from "../src/god/planner.mjs";
import { alertsFor } from "../src/god/tick.mjs";
import { agentInput } from "../src/god/agent-runner.mjs";
import { SNAPSHOT_PAGES, SNAPSHOT_QUERIES, SNAPSHOT_PAIRS } from "../src/god/search-console.mjs";
import { buildDossier } from "../src/god/onboarding.mjs";
import { draftReports, strategyRedraftDue } from "../src/god/handlers.mjs";

const SITE = { id: "m", name: "Measure", url: "https://example.test/" }, NOW = "2026-11-30T12:00:00Z";
const words = ["boiler", "repair", "leeds", "service", "combi", "install", "cost", "emergency", "plumber", "heating", "radiator", "leak", "best", "near", "me"];
const q = (i) => `${words[i % 15]} ${words[(i * 7) % 15]} ${words[(i * 11) % 15]} ${i}`;
const u = (i) => `https://example.test/${words[i % 15]}-${words[(i * 3) % 15]}-${i}`;
const row = (keys, i) => ({ keys, clicks: (i * 37) % 50, impressions: 100 + ((i * 91) % 4000), ctr: 0.0123, position: 1 + ((i * 13) % 40) });
const day = (n) => new Date(Date.parse("2026-11-27T00:00:00Z") - n * 864e5).toISOString().slice(0, 10);
const answers = {
  pages: JSON.stringify({ rows: Array.from({ length: SNAPSHOT_PAGES }, (_, i) => row([u(i)], i)) }),
  queries: JSON.stringify({ rows: Array.from({ length: SNAPSHOT_QUERIES }, (_, i) => row([q(i)], i)) }),
  pairs: JSON.stringify({ rows: Array.from({ length: SNAPSHOT_PAIRS }, (_, i) => row([u(i % 120), q(i)], i)) }),
  daily: JSON.stringify({ rows: Array.from({ length: 35 }, (_, i) => row([day(i)], i)) }),
  inspect: Array.from({ length: INSPECT_PER_DAY }, () => JSON.stringify({ inspectionResult: { inspectionResultLink: "https://search.google.com/x".repeat(3), indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", lastCrawlTime: NOW, pageFetchState: "SUCCESSFUL", googleCanonical: u(1), userCanonical: u(1), sitemap: [u(0)], referringUrls: [u(2), u(3)], crawledAs: "MOBILE" }, mobileUsabilityResult: { verdict: "PASS" }, richResultsResult: { verdict: "PASS", detectedItems: [{ richResultType: "FAQ", items: [{ name: "x", issues: [] }] }] } } })),
};
const rowOf = (x) => ({ clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position });
const snapshotFrom = () => {
  const pages = JSON.parse(answers.pages).rows, queries = JSON.parse(answers.queries).rows, pairs = JSON.parse(answers.pairs).rows, daily = JSON.parse(answers.daily).rows;
  const sc = { property: "sc-domain:example.test", from: "2026-10-31", to: "2026-11-27", generatedAt: NOW, totals: { clicks: 900, impressions: 40000, ctr: 0.02, position: 12 },
    pages: pages.map((x) => ({ url: x.keys[0], ...rowOf(x) })), queries: queries.map((x) => ({ query: x.keys[0], ...rowOf(x) })), pairs: pairs.map((x) => ({ url: x.keys[0], query: x.keys[1], ...rowOf(x) })), complete: { pages: false, queries: false } };
  return { sc, daily: daily.map((x) => ({ date: x.keys[0], ...rowOf(x) })) };
};
// A full history: 13 weekly points and 120 days.
let history = null;
{ const { sc, daily } = snapshotFrom(); for (let w = 13; w >= 0; w--) history = mergeHistory(history, { snapshot: { ...sc, to: day(7 * w) }, daily: w === 0 ? Array.from({ length: 120 }, (_, i) => ({ date: day(i), clicks: 30, impressions: 900, position: 9 })) : daily, now: NOW }); }
const audit = { generatedAt: NOW, summary: { pagesCrawled: 40 }, issues: Array.from({ length: 200 }, (_, i) => ({ rule: ["title-long", "desc-short", "images-no-alt", "status-error", "orphan"][i % 5], severity: "medium", url: u(i % 40), ...(i % 5 === 3 ? { detail: "HTTP 404" } : {}) })),
  crawled: Array.from({ length: 100 }, (_, i) => u(i)), signals: { errors: [], noindex: [] }, previous: { generatedAt: day(1), issues: [] } };
const inspect = { generatedAt: NOW, property: "sc-domain:example.test", results: Object.fromEntries(Array.from({ length: INSPECT_KEEP }, (_, i) => [u(i), { checkedAt: NOW, verdict: i % 9 ? "PASS" : "NEUTRAL", coverage: i % 9 ? "Submitted and indexed" : "Crawled - currently not indexed", indexing: "INDEXING_ALLOWED", robots: "ALLOWED", fetch: "SUCCESSFUL", lastCrawl: NOW, ...(i % 9 ? {} : { prev: { coverage: "Submitted and indexed", verdict: "PASS", indexing: "INDEXING_ALLOWED", robots: "ALLOWED", checkedAt: day(7) }, changedAt: NOW }) }])) };
const speed = { generatedAt: NOW, pages: Array.from({ length: 4 }, (_, i) => ({ url: u(i), score: 40 + i * 10, lab: { lcpMs: 3000, cls: 0.1, tbtMs: 300 }, field: { lcpMs: 2600, inpMs: 180, cls: 0.05, category: "AVERAGE" } })), origin: { lcpMs: 2400 } };
const { sc } = snapshotFrom();
const priorities = prioritiesFrom({ siteUrl: SITE.url, searchConsole: sc, history, audit, inspect, speed, now: NOW });
const mem = (key, value) => ({ kind: "report", key, value, basis: "verified" });
const memory = [mem("audit", audit), mem("profile", { mode: "advise" }), mem("search_console", sc), mem("history", history), mem("inspect", inspect), mem("speed", speed), mem("priorities", priorities),
  { kind: "strategy", key: "initial", value: { status: "approved" }, basis: "verified" }];
const recallAnswer = JSON.stringify(memory);

const cpu = (fn) => { const t = process.cpuUsage(); fn(); const d = process.cpuUsage(t); return (d.user + d.system) / 1000; };
const measure = (fn) => { const first = cpu(fn); const warm = Array.from({ length: 20 }, () => cpu(fn)).sort((a, b) => a - b)[10]; return { firstMs: Math.round(first * 100) / 100, warmMs: Math.round(warm * 100) / 100 }; };
if (process.env.PART) { const parts = {
  parse: () => JSON.parse(recallAnswer), alerts: () => alertsFor(SITE, memory, [], NOW), reports: () => plannerReports(memory),
  inspect: () => { const m = JSON.parse(recallAnswer); const r = { ...m.find((x) => x.key === "inspect").value.results }; for (const a of answers.inspect) { const j = JSON.parse(a); r[u(Math.floor(Math.random() * 400))] = j.inspectionResult.indexStatusResult; } JSON.stringify(boundResults(r, new Set())); },
  prio: () => prioritiesFrom({ siteUrl: SITE.url, searchConsole: sc, history, audit, inspect, speed, now: NOW }),
  draft: () => { const m = JSON.parse(recallAnswer); const g = (k) => m.find((x) => x.key === k)?.value; strategyRedraftDue([{ kind: "strategy_proposal", status: "awaiting_approval" }], m); JSON.stringify(buildDossier({ site: SITE, discovered: {}, audit: g("audit"), reports: draftReports(m), now: NOW }).strategyDraft); },
  plan: () => planSite({ site: SITE, reports: plannerReports(memory), strategy: { status: "approved" }, alerts: [], now: NOW }) };
  console.log(process.env.PART, JSON.stringify(measure(parts[process.env.PART]))); process.exit(0); }
const out = {
  planningOneSite: measure(() => { const m = JSON.parse(recallAnswer); strategyRedraftDue([], m); const alerts = alertsFor(SITE, m, [], NOW); planSite({ site: SITE, reports: plannerReports(m), strategy: { status: "approved" }, alerts, now: NOW }); }),
  snapshotAfterGoogle: measure(() => { const { sc: s, daily } = snapshotFrom(); const m = JSON.parse(recallAnswer); const h = mergeHistory(m.find((x) => x.key === "history").value, { daily, snapshot: s, now: NOW }); JSON.stringify([s, h]); }),
  prioritiesJob: measure(() => { const m = JSON.parse(recallAnswer); const g = (k) => m.find((x) => x.key === k)?.value; JSON.stringify(prioritiesFrom({ siteUrl: SITE.url, searchConsole: g("search_console"), history: g("history"), audit: g("audit"), inspect: g("inspect"), speed: g("speed"), now: NOW })); }),
  inspectionBatch: measure(() => { const m = JSON.parse(recallAnswer); const r = { ...m.find((x) => x.key === "inspect").value.results }; for (const a of answers.inspect) { const j = JSON.parse(a); r[u(Math.floor(Math.random() * 400))] = j.inspectionResult.indexStatusResult; } JSON.stringify(boundResults(r, new Set())); }),
  alertsOnly: measure(() => detectAlerts({ siteUrl: SITE.url, history, inspect, audit, searchConsole: sc, now: NOW })),
  strategyDraft: measure(() => { const m = JSON.parse(recallAnswer); const g = (k) => m.find((x) => x.key === k)?.value; strategyRedraftDue([{ kind: "strategy_proposal", status: "awaiting_approval" }], m); JSON.stringify(buildDossier({ site: SITE, discovered: {}, audit: g("audit"), reports: draftReports(m), now: NOW }).strategyDraft); }),
  agentDataBlock: measure(() => agentInput({ kind: "agent:seo-strategist", title: "t", inputs: {} }, memory, SITE)),
};
const sizes = { recallAnswerKb: Math.round(recallAnswer.length / 1024), historyKb: Math.round(JSON.stringify(history).length / 1024), inspectKb: Math.round(JSON.stringify(inspect).length / 1024), prioritiesKb: Math.round(JSON.stringify(priorities).length / 1024), searchConsoleKb: Math.round(JSON.stringify(sc).length / 1024),
  agentDataKb: Math.round(agentInput({ kind: "agent:seo-strategist", title: "t", inputs: {} }, memory, SITE).length / 1024) };
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, note: "synthetic site at every size cap; CPU from process.cpuUsage (same V8 as Workers): an estimate", cpu: out, sizes }, null, 1));
