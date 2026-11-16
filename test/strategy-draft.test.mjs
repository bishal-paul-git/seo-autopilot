// D60: the demand-driven strategy draft and the one-time re-draft of unapproved drafts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftStrategy, DRAFT_VERSION, sensitiveTopics, brandTerms } from "../src/god/strategy.mjs";
import { buildDossier, withAnswers } from "../src/god/onboarding.mjs";
import { makeHandlers, strategyRedraftDue, redraftStrategy } from "../src/god/handlers.mjs";
import { MemoryStore } from "../src/god/stores.mjs";
import { tick } from "../src/god/tick.mjs";

const NOW = "2026-11-16T10:00:00Z";
const SITE = { id: "S", name: "Erudite Consulting", url: "https://www.erudite.test/" };
const U = (p) => `https://www.erudite.test${p}`;
// A consultancy: low-severity hygiene and one high finding, the shape of the real pilot's first audit.
const AUDIT = { generatedAt: "2026-11-16T08:00:00Z", summary: { pagesCrawled: 39 }, issues: [
  ...Array.from({ length: 7 }, (_, i) => ({ rule: "hard-to-read", severity: "low", url: U(`/blog/post-${i}`) })),
  ...Array.from({ length: 6 }, (_, i) => ({ rule: "thin-content", severity: "medium", url: U(`/tag/t${i}`) })),
  { rule: "host-variant-not-redirected", severity: "high", url: "https://erudite.test/" },
] };
const DISCOVERED = { name: { value: "Erudite Consulting", source: SITE.url }, businessTypes: ["Organization"], topics: [{ value: "AI consulting" }, { value: "Automation" }], description: { value: "AI consulting for small firms." } };
const row = (o) => ({ ctr: o.impressions ? o.clicks / o.impressions : 0, ...o });
// 28 days of Search Console: a striking-distance query, a page with poor click-through, a brand query, two pages splitting one query.
const PAIRS = [
  row({ url: U("/"), query: "erudite consulting", clicks: 90, impressions: 300, position: 1.1 }),
  row({ url: U("/services/ai-automation"), query: "ai automation consultant", clicks: 3, impressions: 900, position: 8.4 }),
  row({ url: U("/services/ai-automation"), query: "ai automation agency uk", clicks: 2, impressions: 400, position: 11.2 }),
  row({ url: U("/services/chatbots"), query: "chatbot for small business", clicks: 4, impressions: 1500, position: 3.2 }),
  row({ url: U("/blog/ai-guide"), query: "ai readiness checklist", clicks: 6, impressions: 200, position: 6.0 }),
  row({ url: U("/services/ai-audit"), query: "ai readiness checklist", clicks: 5, impressions: 180, position: 7.0 }),
  ...Array.from({ length: 12 }, (_, i) => row({ url: U(`/p${i}`), query: `topic ${i}`, clicks: [40, 20, 12, 8, 6, 5, 4, 3, 2, 2, 1, 1][i], impressions: 400, position: i + 1 })),
];
const pagesOf = (pairs) => { const m = new Map(); for (const p of pairs) { const a = m.get(p.url) || { url: p.url, clicks: 0, impressions: 0, position: p.position }; a.clicks += p.clicks; a.impressions += p.impressions; m.set(p.url, a); } return [...m.values()]; };
const SC = { property: "sc-domain:erudite.test", from: "2026-10-17", to: "2026-11-13", days: 28, generatedAt: "2026-11-15T06:00:00Z",
  totals: { clicks: 214, impressions: 8580, ctr: 0.025, position: 7.9 }, pages: pagesOf(PAIRS),
  queries: PAIRS.map((p) => ({ query: p.query, clicks: p.clicks, impressions: p.impressions, position: p.position })), pairs: PAIRS };
const INSPECT = { generatedAt: "2026-11-15T07:00:00Z", results: { [U("/services/chatbots")]: { coverage: "Crawled - currently not indexed" }, [U("/")]: { coverage: "Submitted and indexed" }, [U("/old")]: { coverage: "Page with redirect" } } };

test("with Search Console: objective, real baseline, demand-driven first steps; hygiene goes to later", () => {
  const d = draftStrategy({ site: SITE, discovered: DISCOVERED, audit: AUDIT, searchConsole: SC, inspect: INSPECT, now: NOW, openQuestions: [{ key: "goals", question: "Goal?" }] });
  assert.equal(d.draftVersion, DRAFT_VERSION);
  assert.equal(d.objectiveBasis, "inferred");
  assert.match(d.objective, /non-brand/i);
  const b = d.baseline.searchConsole;
  assert.deepEqual([b.clicks, b.impressions, b.from, b.to], [214, 8580, "2026-10-17", "2026-11-13"], "numbers are read, not made up");
  assert.equal(b.topPages.length, 5);
  assert.equal(b.brandClicksInTopQueries, 90, "the brand query is told apart");
  assert.ok(d.firstSteps.length >= 3 && d.firstSteps.length <= 6);
  const cats = d.firstSteps.map((s) => s.category);
  assert.equal(cats[0], "index", "index problems on important pages come first");
  assert.match(d.firstSteps[0].title, /\/services\/chatbots/, "the not-indexed page with impressions is named");
  assert.ok(!d.firstSteps[0].evidence.some((e) => e.includes("/old")), "a redirect is not an index problem");
  const strike = d.firstSteps.find((s) => s.category === "striking");
  assert.equal(strike.query, "ai automation consultant"); assert.match(strike.title, /\/services\/ai-automation/);
  assert.ok(strike.evidence.some((e) => /900 impressions/.test(e)), "evidence names the numbers");
  assert.ok(cats.indexOf("striking") < cats.indexOf("technical"), "demand before technical");
  for (const s of d.firstSteps) { assert.ok(s.agent?.startsWith("seo-")); assert.ok(["low", "medium", "high"].includes(s.risk)); assert.ok(s.evidence.length > 0); }
  assert.ok(!d.firstSteps.some((s) => /Long sentences/.test(s.title)), "low-severity hygiene is not a first step");
  assert.ok(d.later.some((l) => /Long sentences \(7 pages\)/.test(l.title)));
  assert.ok(d.later.some((l) => /Very little visible text \(6 pages\)/.test(l.title)), "the pilot's other hygiene item waits too");
  assert.ok(!d.firstSteps.some((s) => /brand|erudite consulting/i.test(s.query || "")), "no striking step for a brand query");
  const k = d.kpis.map((x) => x.text).join("\n");
  assert.match(k, /Clicks to \/services\/(chatbots|ai-automation): from \d+/);
  assert.ok(d.kpis.every((x) => x.reviewOn === "2026-12-14" && ["grow", "reduce", "hold"].includes(x.target)));
  assert.ok(d.notWithoutYou.some((x) => /Site-wide/.test(x)));
  assert.equal(d.openQuestions.count, 1);
});

test("a fresh priorities report is read instead of re-running the search analysis; same first steps", async () => {
  const { prioritiesFrom } = await import("../src/god/insights.mjs");
  const priorities = prioritiesFrom({ searchConsole: SC, audit: AUDIT, inspect: INSPECT, now: "2026-11-15T06:30:00Z" });
  const a = draftStrategy({ site: SITE, discovered: DISCOVERED, audit: AUDIT, searchConsole: SC, inspect: INSPECT, now: NOW });
  const b = draftStrategy({ site: SITE, discovered: DISCOVERED, audit: AUDIT, searchConsole: SC, inspect: INSPECT, priorities, now: NOW });
  assert.equal(b.basedOn.priorities, true); assert.equal(a.basedOn.priorities, false);
  assert.deepEqual(b.firstSteps.map((s) => s.title), a.firstSteps.map((s) => s.title));
  const stale = draftStrategy({ site: SITE, discovered: DISCOVERED, audit: AUDIT, searchConsole: SC, priorities: { ...priorities, generatedAt: "2026-11-01T00:00:00Z" }, now: NOW });
  assert.equal(stale.basedOn.priorities, false, "a ranking older than the snapshot is not used");
});

test("without Search Console: says so, step 1 is giving access, no invented numbers", () => {
  const d = draftStrategy({ site: SITE, discovered: DISCOVERED, audit: AUDIT, now: NOW });
  assert.equal(d.baseline.searchConsole, null);
  assert.match(d.baseline.note, /No Search Console data yet/);
  assert.equal(d.firstSteps[0].title, "Give Search Console access");
  assert.ok(d.firstSteps.length >= 3);
  assert.ok(!d.firstSteps.some((s) => /Long sentences/.test(s.title)));
  const clicks = d.kpis.find((k) => k.metric === "Search clicks (whole site)");
  assert.equal(clicks.baseline, null); assert.match(clicks.text, /baseline once Search Console access is given/);
  assert.ok(d.risks.some((r) => /no search data yet/.test(r)));
});

test("local business and the brief: objective from the brief, local items, restrictions", () => {
  const disc = { name: { value: "Leeds Plumbing Co" }, businessTypes: ["Plumber"], topics: [{ value: "Boiler repair" }, { value: "Emergency plumber" }] };
  const inferred = draftStrategy({ site: { url: "https://plumber.test/", name: "Plumber" }, discovered: disc, audit: AUDIT, answers: { target_locations: "Leeds" }, now: NOW });
  assert.match(inferred.objective, /local.*Leeds/); assert.equal(inferred.objectiveBasis, "inferred");
  assert.ok(inferred.later.some((l) => l.agent === "seo-local-gbp-optimizer"));
  assert.ok(inferred.notWithoutYou.some((x) => /Business Profile/.test(x)));
  assert.deepEqual(inferred.profile.sensitive, [], "“emergency” does not make a plumber a sensitive-topic site");
  const brief = draftStrategy({ site: { url: "https://plumber.test/" }, discovered: disc, audit: AUDIT, answers: { goals: "More boiler repair enquiries", restrictions: "Never change prices" }, now: NOW });
  assert.equal(brief.objective, "More boiler repair enquiries"); assert.equal(brief.objectiveBasis, "brief");
  assert.ok(brief.notWithoutYou.some((x) => /Never change prices/.test(x)));
});

test("sensitive (YMYL) site: named in what waits for a person", () => {
  const disc = { name: { value: "Smith Tax Advice" }, businessTypes: ["AccountingService"], description: { value: "Tax returns and pension advice for families." }, topics: [] };
  assert.deepEqual([...new Set(sensitiveTopics(disc).map((s) => s.topic))].sort(), ["finance", "tax"]);
  const d = draftStrategy({ site: { url: "https://smithtax.test/" }, discovered: disc, audit: AUDIT, now: NOW });
  assert.ok(d.profile.sensitive.includes("tax") && d.profile.sensitive.includes("finance"));
  assert.ok(d.notWithoutYou.some((x) => /sensitive topics \(.*tax/.test(x) && /qualified reviewer/.test(x)));
  assert.deepEqual(brandTerms({ url: "https://www.smithtax.test/" }, "Smith Tax Advice"), ["smith", "advice", "smithtax"]);
});

test("withAnswers keeps a v2 draft's shape: brief goal replaces the inferred objective, conversion KPI as an object", () => {
  const d = draftStrategy({ site: SITE, discovered: DISCOVERED, audit: AUDIT, now: NOW, openQuestions: [{ key: "goals", question: "g" }, { key: "conversions", question: "c" }] });
  const s = withAnswers(d, { goals: "More consulting leads", conversions: "contact form" }, 0);
  assert.equal(s.objective, "More consulting leads"); assert.equal(s.objectiveBasis, "brief");
  assert.equal(s.kpis[0].metric, "Conversions"); assert.equal(s.kpis[0].reviewOn, "2026-12-14");
  assert.ok(!s.risks.some((r) => /inferred/.test(r)));
  assert.deepEqual(s.openQuestions, { count: 0, top: [] });
});

// ---- Re-drafting (production: unapproved old-format drafts must be replaced once; approved ones never).
const memRow = (kind, key, value) => ({ kind, key, value, basis: "verified", confidence: null, source: "test" });
function seeded({ strategy, withSc = false, jobStatus = "awaiting_approval" } = {}) {
  const store = new MemoryStore(); store.clock = () => NOW; store.sites = [SITE];
  store.writeMemory("S", [memRow("report", "audit", AUDIT), memRow("report", "discovered", DISCOVERED), memRow("report", "profile", { mode: "advise" }), memRow("strategy", "initial", strategy),
    ...(withSc ? [memRow("report", "search_console", SC)] : [])]);
  const job = store.createJob({ siteId: "S", kind: "strategy_proposal", title: "Draft", risk: "medium", inputs: {}, idempotencyKey: "strategy_proposal:2026-W45" });
  job.status = jobStatus; job.outputs = { proposal: strategy, claims: [], questions: [], evidence: ["old"] };
  return { store, job };
}
const OLD = { status: "proposed", approval: "agency", objective: null, firstSteps: [{ title: "Long sentences (7 pages)" }], kpis: ["Search Console clicks and impressions (needs Search Console access)"], risks: ["8 questions open: the strategy is provisional until they are answered"] };

test("re-draft: an old-format proposed draft is replaced once, keeps waiting, never approved", async () => {
  const { store, job } = seeded({ strategy: OLD, withSc: true });
  const due = strategyRedraftDue(store.listJobs("S"), store.readMemory("S"));
  assert.equal(due.job.id, job.id); assert.match(due.reason, /v1/);
  const r = await redraftStrategy(store, SITE, due.job, store.readMemory("S"), NOW);
  assert.equal(r.redrafted, true);
  const now = store.readMemory("S", "strategy")[0].value;
  assert.equal(now.draftVersion, DRAFT_VERSION); assert.equal(now.status, "proposed");
  assert.equal(store.get(job.id).status, "awaiting_approval", "still waiting for the agency");
  assert.equal(store.get(job.id).outputs.proposal.draftVersion, DRAFT_VERSION, "the job the agency approves carries the new draft");
  assert.equal(strategyRedraftDue(store.listJobs("S"), store.readMemory("S")), null, "only once");
  assert.equal(store.approvals?.length || 0, 0);
});

test("re-draft: never an approved strategy", () => {
  const { store } = seeded({ strategy: { ...OLD, status: "approved" }, withSc: true, jobStatus: "completed" });
  assert.equal(strategyRedraftDue(store.listJobs("S"), store.readMemory("S")), null);
  const { store: s2 } = seeded({ strategy: { ...OLD, status: "approved" }, withSc: true });
  assert.equal(strategyRedraftDue(s2.listJobs("S"), s2.readMemory("S")), null, "approved in memory wins even if a job still waits");
});

test("re-draft: a v2 draft made without Search Console is re-drafted when the first snapshot arrives, then not again", async () => {
  const v2 = draftStrategy({ site: SITE, discovered: DISCOVERED, audit: AUDIT, now: NOW });
  const { store } = seeded({ strategy: v2 });
  assert.equal(strategyRedraftDue(store.listJobs("S"), store.readMemory("S")), null, "no new data: nothing to do");
  store.writeMemory("S", [memRow("report", "search_console", SC)]);
  const due = strategyRedraftDue(store.listJobs("S"), store.readMemory("S"));
  assert.match(due.reason, /Search Console data arrived/);
  await redraftStrategy(store, SITE, due.job, store.readMemory("S"), NOW);
  const after = store.readMemory("S", "strategy")[0].value;
  assert.deepEqual(after.basedOn.searchConsole, { from: "2026-10-17", to: "2026-11-13" });
  assert.equal(after.firstSteps[0].category, "striking", "no index data here: search demand leads");
  assert.equal(strategyRedraftDue(store.listJobs("S"), store.readMemory("S")), null);
});

test("tick queues one re-draft job for the waiting old draft; it runs free, the draft keeps waiting, then nothing more", async () => {
  const { store, job } = seeded({ strategy: OLD, withSc: true });
  const handlers = makeHandlers({ store, siteOf: async () => SITE, scan: async () => { throw new Error("no crawl expected"); } });
  const r0 = await tick({ store, handlers, now: NOW, maxJobs: 5 });
  assert.ok(r0.sites[0].queued.some((q) => q.kind === "priorities") && !r0.sites[0].queued.some((q) => q.kind === "strategy_redraft"), "new search data: rank first, so the drafter can read the ranking");
  const r = await tick({ store, handlers, now: NOW, maxJobs: 5 });
  assert.ok(r.sites[0].queued.some((q) => q.kind === "strategy_redraft"), JSON.stringify(r.sites[0]));
  assert.ok(r.runs.some((x) => x.outcome === "completed"), JSON.stringify(r.runs));
  assert.equal(store.readMemory("S", "strategy")[0].value.basedOn.priorities, true, "read the fresh ranking");
  assert.equal(store.readMemory("S", "strategy")[0].value.draftVersion, DRAFT_VERSION);
  assert.equal(store.get(job.id).status, "awaiting_approval", "never approved automatically");
  assert.equal(r.sites[0].strategy, "proposed");
  const r2 = await tick({ store, handlers, now: NOW, maxJobs: 5 });
  assert.ok(!r2.sites[0].queued.some((q) => q.kind === "strategy_redraft"), "once");
  // Approved since the job was queued: the handler leaves it alone.
  const { store: s3 } = seeded({ strategy: { ...OLD, status: "approved" }, withSc: true });
  const out = await makeHandlers({ store: s3, siteOf: async () => SITE }).strategy_redraft({ siteId: "S" });
  assert.match(out.evidence[0], /nothing to re-draft/);
  assert.equal(s3.readMemory("S", "strategy")[0].value.status, "approved");
});

test("dossier passes memory reports to the drafter", () => {
  const d = buildDossier({ site: SITE, discovered: DISCOVERED, audit: AUDIT, reports: { searchConsole: SC }, now: NOW });
  assert.equal(d.strategyDraft.baseline.searchConsole.clicks, 214);
  assert.equal(d.strategyDraft.openQuestions.count, d.questions.length);
});
