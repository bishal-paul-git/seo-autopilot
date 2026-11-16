// What the planner and the agents read from a hosted site's memory (D57). The hosted engine keeps compact reports in
// site memory (audit, profile, search_console, speed, inspect, history); the router (src/analysis/agent-router.mjs) and
// the priority engine (src/analysis/priorities.mjs) were written for the CLI's report files. This module turns one into
// the other, reusing the CLI's own analysis: nothing here re-implements a rule.
import { buildCtrCurve, cannibalization, strikingDistance, ctrUnderperformers, decay } from "../analysis/search.mjs";
import { buildPriorities } from "../analysis/priorities.mjs";
import { rankFromHistory, earlierPages } from "../analysis/search-history.mjs";
import { RULES } from "../audit/rules.mjs";

export const PRIORITY_ITEMS = 25;
export const NOT_INDEXED = (v) => v?.coverage && v.coverage !== "Submitted and indexed" && !/redirect|alternate|duplicate/i.test(v.coverage);

/**
 * The hosted speed report (src/god/speed.mjs) in the CLI's speed.json results shape (lab.score, field.lcp/inp/cls), plus
 * the score and rating the router reads. Poor = a real-user or lab number in Google's "poor" band, or a score under 50.
 */
export function speedResults(s) {
  if (!s?.pages) return null;
  const results = s.pages.map((p) => {
    if (p.error) return { url: p.url, error: p.error };
    const field = { lcp: p.field?.lcpMs ?? null, inp: p.field?.inpMs ?? null, cls: p.field?.cls ?? null };
    const lab = { score: p.score ?? null, lcp: p.lab?.lcpMs ?? null, cls: p.lab?.cls ?? null, tbt: p.lab?.tbtMs ?? null };
    const poor = (field.lcp ?? 0) > 4000 || (field.inp ?? 0) > 500 || (field.cls ?? 0) > 0.25 || (lab.score != null && lab.score < 50);
    return { url: p.url, score: lab.score, rating: poor ? "poor" : "ok", lab, field };
  });
  return { generatedAt: s.generatedAt, strategy: s.strategy || "mobile", results };
}

/** Search Console page + query pairs as the analysis rows { query, page, clicks, impressions, position }. */
const pairRows = (sc) => (sc?.pairs || []).map((x) => ({ query: x.query, page: x.url, clicks: x.clicks || 0, impressions: x.impressions || 0, position: Number(x.position) || 0 }));
const pageRows = (pages) => pages.map(([page, [clicks, impressions, position]]) => ({ query: "", page, clicks, impressions, position }));
/**
 * The parts of the CLI's search analysis (src/analysis/search.mjs analyze) that the priority engine ranks, from the
 * hosted snapshot (null without page + query pairs). Topic clusters and content gaps are left out: they need page
 * titles, which the hosted scan does not keep, and they are the costliest part for a Worker's few milliseconds of CPU.
 * The strategy drafter (D60) reads the same lists, so its first steps agree with the priorities report.
 */
export function searchInsights(searchConsole, history = null) {
  if (!searchConsole?.pairs?.length) return null;
  const rows = pairRows(searchConsole), curve = buildCtrCurve(rows);
  const insights = { strikingDistance: strikingDistance(rows, curve).slice(0, 40), ctrUnderperformers: ctrUnderperformers(rows, curve).slice(0, 25), cannibalization: cannibalization(rows).slice(0, 25), contentGaps: [] };
  // Decay compares equal 28-day windows of page totals: today's snapshot against the weekly point about 28 days earlier.
  const before = earlierPages(history, searchConsole.to);
  insights.decay = before ? decay(pageRows((searchConsole.pages || []).map((p) => [p.url, [p.clicks, p.impressions, p.position]])), pageRows(Object.entries(before.pages || {}))).slice(0, 25) : [];
  return insights;
}

/**
 * One ranked to-do list for a hosted site, from the CLI's priority engine. Inputs are the memory reports.
 * Returns { generatedAt, basis, items } (items trimmed to PRIORITY_ITEMS), or null when there is nothing to rank.
 */
export function prioritiesFrom({ searchConsole = null, history = null, audit = null, inspect = null, speed = null, now = new Date().toISOString() } = {}) {
  if (!audit && !searchConsole) return null;
  const insights = searchInsights(searchConsole, history);
  const indexing = Object.entries(inspect?.results || {}).filter(([, v]) => NOT_INDEXED(v)).map(([u, v]) => `${u} (${v.coverage})`);
  const items = buildPriorities({ audit, insights, rules: RULES, indexing, speed: speedResults(speed) });
  const basis = [audit && `audit of ${String(audit.generatedAt || "").slice(0, 10)}`, searchConsole && `Search Console ${searchConsole.from} to ${searchConsole.to}`,
    inspect && `URL inspection of ${Object.keys(inspect.results || {}).length} pages`, speed && "phone speed check"].filter(Boolean);
  return { generatedAt: now, basis, items: items.slice(0, PRIORITY_ITEMS).map((i) => ({ ...i, evidence: (i.evidence || []).slice(0, 5) })) };
}

const report = (memory, key) => memory.find((m) => m.kind === "report" && m.key === key)?.value ?? null;

/** The newest of the reports the ranking reads (null without a Search Console snapshot: nothing new to rank then). */
export function priorityInputsAt(memory) {
  const at = (k) => report(memory, k)?.generatedAt || "";
  if (!at("search_console")) return null;
  return ["search_console", "inspect", "audit", "speed"].map(at).sort().at(-1);
}

/**
 * Due when the ranking is older than its inputs (a new snapshot, inspection, scan or speed check). Its own small job,
 * not part of the snapshot or the inspection: each Worker invocation gets only a few milliseconds of CPU.
 */
export function prioritiesDue(memory) {
  const inputsAt = priorityInputsAt(memory);
  return inputsAt && report(memory, "priorities")?.inputsAt !== inputsAt ? inputsAt : null;
}

/** Rebuild report "priorities" from what memory holds now. */
export async function refreshPriorities(store, siteId, { siteUrl = null, now = new Date().toISOString() } = {}) {
  const memory = (await store.readMemory(siteId, "report")) || [];
  const p = prioritiesFrom({ siteUrl, searchConsole: report(memory, "search_console"), history: report(memory, "history"), audit: report(memory, "audit"), inspect: report(memory, "inspect"), speed: report(memory, "speed"), now });
  if (p) await store.writeMemory(siteId, [{ kind: "report", key: "priorities", value: { ...p, inputsAt: priorityInputsAt(memory) }, basis: "inferred", confidence: null, source: "priority engine" }]);
  return p;
}

/** The "priorities" job (D57): free, no outside calls; re-ranks after new data. deps: { store, siteOf, now }. */
export function makePrioritiesHandler({ store, siteOf, now = () => new Date().toISOString() }) {
  return async (job) => {
    const site = await siteOf(job.siteId);
    const p = await refreshPriorities(store, job.siteId, { siteUrl: site?.url || null, now: now() });
    return { costUsd: 0, evidence: [p ? `${p.items.length} priorities ranked from ${p.basis.join(", ")}` : "nothing to rank yet"] };
  };
}

/** What an agent sees of the priorities: the top items with their evidence, and how to read the scores. */
export function prioritiesForAgents(p, n = 10) {
  if (!p?.items?.length) return null;
  return { generatedAt: p.generatedAt, basis: p.basis, items: p.items.slice(0, n).map((i) => ({ rank: i.rank, id: i.id, type: i.type, title: i.title, score: i.score, effort: i.effort, confidence: i.confidence, evidence: i.evidence })),
    note: "Ranked by impact x confidence / effort. 'est. clicks' are estimates from this site's own click-through data; 'points' are a rough severity scale. Not a ranking forecast." };
}

/**
 * The reports the planner hands to the router, from site memory: the compact reports as stored, with the inspection as
 * the url -> result map, the hosted speed check in the CLI's shape, and query movement from the history as `rank`.
 */
export function plannerReports(memory) {
  const r = {};
  for (const m of memory) if (m.kind === "report") r[m.key] = m.value;
  return { ...r, inspect: r.inspect?.results || {}, inspectReport: r.inspect || null, speedReport: r.speed || null, speed: speedResults(r.speed), rank: rankFromHistory(r.history) };
}
