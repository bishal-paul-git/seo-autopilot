// Real job handlers for the worker (src/god/worker.mjs): the read-only scan and the strategy proposal. They call the
// product's existing modules and write the site's private memory through the store. Handlers never deploy anything;
// work that changes a website gets its own handler per authorized integration (R1-E1).
import { buildDossier, dossierMemory } from "./onboarding.mjs";
import { workOrder } from "./github.mjs";
import { makePrioritiesHandler } from "./insights.mjs";
import { DRAFT_VERSION } from "./strategy.mjs";
import { reviewOutput } from "./review.mjs";

// The crawler loads only where it runs (Node, the Supabase scan function); the Cloudflare Worker passes a remote scan.
const scanSite = (...a) => import("../hosted/scan.mjs").then((m) => m.scanSite(...a));
const FRESH_MS = 36 * 3600e3;

/**
 * deps: { store (with writeMemory, readMemory), siteOf: async (siteId) => ({ id, name, url }), scan: scanSite override for tests, scanOptions }
 */
export function makeHandlers({ store, siteOf, scan = scanSite, scanOptions = {} }) {
  const last = new Map(); // siteId -> latest scan result in this worker process
  return {
    // D57: the CLI's priority engine on the hosted reports, after each new snapshot, inspection, scan or speed check.
    priorities: makePrioritiesHandler({ store, siteOf }),
    async scan(job) {
      const site = await siteOf(job.siteId);
      const r = await scan(site, scanOptions);
      last.set(job.siteId, r);
      const dossier = buildDossier({ site, discovered: r.discovered, profile: r.profile, audit: r.audit, answers: await answersOf(store, job.siteId) });
      // D57: the previous scan's errors and blocks travel with the new audit, so a new problem can be told from an old one.
      const before = ((await store.readMemory?.(job.siteId, "report")) || []).find((m) => m.key === "audit")?.value || null;
      await store.writeMemory(job.siteId, [...dossierMemory(dossier).filter((m) => m.kind !== "strategy" && m.kind !== "question"), ...reportMemory(r, before)]);
      return { evidence: [`${r.audit.summary.pagesCrawled} pages read from ${site.url}`, `${r.audit.issues.length} findings`, `${dossier.facts.length} facts with sources`], snapshot: r.snapshot };
    },
    async strategy_proposal(job) {
      const site = await siteOf(job.siteId);
      // Prefer this process's scan, then the compact scan kept in memory (a new Worker invocation has no process state),
      // and crawl again only when neither is fresh. D60: the other reports in memory (Search Console, history, index
      // status, speed, priorities) drive the draft.
      const rows = (await store.readMemory?.(job.siteId, "report")) || [];
      const r = last.get(job.siteId) || scanFromRows(rows) || (await scan(site, scanOptions));
      const dossier = buildDossier({ site, discovered: r.discovered, profile: r.profile, audit: r.audit, answers: await answersOf(store, job.siteId), reports: draftReports(rows) });
      await store.writeMemory(job.siteId, dossierMemory(dossier).filter((m) => m.kind === "strategy" || m.kind === "question"));
      return strategyOutput(dossier);
    },
    // D60: re-draft the strategy waiting for approval (queued by the tick when strategyRedraftDue says so). Checked again
    // here: the agency may have approved or rejected it since. Free, no crawl, low risk; the draft keeps waiting.
    async strategy_redraft(job) {
      const site = await siteOf(job.siteId);
      const [jobs, memory] = [await store.listJobs(job.siteId), (await store.readMemory(job.siteId)) || []];
      const due = strategyRedraftDue(jobs, memory);
      if (!due) return { costUsd: 0, evidence: ["nothing to re-draft: the strategy was approved, rejected or already current"] };
      const r = await redraftStrategy(store, site, due.job, memory);
      return { costUsd: 0, evidence: [r.redrafted ? `re-drafted the waiting strategy (v${r.draftVersion}${r.searchConsole ? ", with Search Console data" : ""}): ${due.reason}` : `left unchanged: ${r.reasons.join("; ")}`] };
    },
    // D37: draft the exact GitHub work order for one accepted recommendation. No side effects: nothing reaches GitHub
    // until the agency approves this result; the scheduler then opens the issue and starts the site's own workflow.
    async implement(job) {
      const site = await siteOf(job.siteId);
      const rec = job.inputs?.recommendation;
      if (!rec || typeof rec !== "object" || !rec.title) return { evidence: [], escalate: "the recommendation to implement is missing" };
      const order = workOrder(job, site || {});
      const evidence = [`work order for ${order.url || "the site"} (${order.kind})`, ...(Array.isArray(rec.evidence) ? rec.evidence.slice(0, 5).map((e) => `recommendation evidence: ${String(e).slice(0, 200)}`) : [])];
      return { evidence, proposal: { workOrder: order, recommendation: rec, sourceJob: job.inputs?.sourceJob || null }, adopt: true };
    },
  };
}

function scanFromRows(rows) {
  const get = (k) => rows.find((m) => (m.kind ?? "report") === "report" && m.key === k)?.value;
  const audit = get("audit"), discovered = get("discovered");
  if (!audit || !discovered || Date.now() - Date.parse(audit.generatedAt || 0) > FRESH_MS) return null;
  return { audit: { ...audit, pages: [] }, discovered, profile: get("profile") || {} };
}

/** The reports in site memory that the strategy drafter reads besides the scan (D60). */
export function draftReports(rows = []) {
  const get = (k) => rows.find((m) => (m.kind ?? "report") === "report" && m.key === k)?.value ?? null;
  return { searchConsole: get("search_console"), history: get("history"), inspect: get("inspect"), speed: get("speed"), priorities: get("priorities") };
}

/** The strategy job's result: the draft, with every first step and KPI as a claim with its source (the review gate checks them). */
export function strategyOutput(dossier) {
  const d = dossier.strategyDraft, b = d.basedOn || {};
  const basis = [`${b.auditPages ?? 0} audited pages`, b.searchConsole ? `Search Console ${b.searchConsole.from} to ${b.searchConsole.to}` : "no Search Console data", b.inspected ? `index status of ${b.inspected} pages` : null, b.speed ? "phone speed check" : null].filter(Boolean);
  return {
    evidence: [`dossier: ${dossier.facts.length} facts, ${dossier.questions.length} open questions`, `draft v${d.draftVersion || 1} from ${basis.join(", ")}`],
    claims: [...(d.firstSteps || []).map((s) => ({ text: s.title, source: s.source || "audit" })), ...(d.kpis || []).map((k) => ({ text: typeof k === "string" ? k : k.text, source: "site reports" }))],
    proposal: d, questions: dossier.questions,
    adopt: true, // the agency must approve this result before it becomes the site's strategy
  };
}

/**
 * D60: whether the site's unapproved draft should be re-drafted now: once when it was made by an older drafter, and once
 * when Search Console data arrives after a draft made without it. Never for an approved strategy; only the draft that
 * waits for the agency (status awaiting_approval) is touched, and it keeps waiting. Returns { job, reason } or null.
 */
export function strategyRedraftDue(jobs = [], memory = []) {
  const s = memory.find((m) => m.kind === "strategy" && m.key === "initial")?.value;
  if (!s || s.status === "approved") return null;
  const job = jobs.filter((j) => j.kind === "strategy_proposal" && j.status === "awaiting_approval").sort((a, b) => String(a.updatedAt || "").localeCompare(String(b.updatedAt || ""))).at(-1);
  const has = (k) => memory.some((m) => m.kind === "report" && m.key === k);
  if (!job || !has("audit")) return null;
  // key: one re-draft per drafter version, and one per first Search Console snapshot (the job's idempotency key).
  if ((s.draftVersion || 1) < DRAFT_VERSION) return { job, key: `v${DRAFT_VERSION}`, reason: `the draft was made by drafter v${s.draftVersion || 1}; v${DRAFT_VERSION} is driven by search demand` };
  if (has("search_console") && !s.basedOn?.searchConsole) return { job, key: `v${DRAFT_VERSION}:search-console`, reason: "Search Console data arrived after the draft was made" };
  return null;
}

/**
 * Re-draft in place from what memory holds (no crawl): the new draft goes to memory and onto the waiting job, which stays
 * in awaiting_approval for the agency. The deterministic review gate checks it first; a failing draft is left unchanged.
 */
export async function redraftStrategy(store, site, job, memory, now = new Date().toISOString()) {
  const rows = memory.filter((m) => m.kind === "report");
  const get = (k) => rows.find((m) => m.key === k)?.value ?? null;
  const answers = Object.fromEntries(memory.filter((m) => m.kind === "answer").map((m) => [m.key, m.value?.value]));
  const dossier = buildDossier({ site, discovered: get("discovered") || {}, profile: get("profile"), audit: get("audit"), answers, reports: draftReports(rows), now });
  const out = strategyOutput(dossier);
  const review = reviewOutput({ ...job, budgetUsd: 0 }, { ...out, costUsd: 0 });
  if (review.verdict !== "pass") return { redrafted: false, reasons: review.reasons };
  await store.writeMemory(site.id, dossierMemory(dossier).filter((m) => m.kind === "strategy" || m.kind === "question"));
  await store.recordOutput(job.id, { outputs: { ...(job.outputs || {}), proposal: out.proposal, claims: out.claims, questions: out.questions, evidence: [...out.evidence, "re-drafted while waiting for approval"] }, costUsd: 0 });
  return { redrafted: true, draftVersion: out.proposal.draftVersion, searchConsole: !!out.proposal.basedOn?.searchConsole };
}

// Findings the alert detector compares between two scans (D57): errors and blocks.
const WATCHED = new Set(["status-error", "noindex-in-sitemap", "robots-blocked", "robots-blocks-all"]);
const compactIssue = (i) => ({ rule: i.rule, severity: i.severity, url: i.url, ...(i.rule === "status-error" && i.detail ? { detail: String(i.detail).slice(0, 40) } : {}) });
/** Error statuses and noindex pages from the crawl (the scan function sends them as `signals`; a local scan has pages). */
function signalsOf(a) {
  if (a.signals) return { errors: (a.signals.errors || []).slice(0, 100), noindex: (a.signals.noindex || []).slice(0, 100) };
  const pages = a.pages || [];
  if (!pages.length) return null;
  return { errors: pages.filter((p) => p.status >= 400 || p.status === 0).slice(0, 100).map((p) => ({ url: p.url, status: p.status })), noindex: pages.filter((p) => p.noindex).slice(0, 100).map((p) => p.url) };
}

/**
 * The compact reports the planner needs on its next tick (audit age and findings, site profile), kept in site memory.
 * before: the audit report kept from the previous scan, if any; its errors and blocks are kept as `previous` (one level).
 */
export function reportMemory(r, before = null) {
  const a = r.audit || {}, p = r.profile || {};
  const audit = { generatedAt: a.generatedAt || new Date().toISOString(), summary: a.summary || {}, issues: (a.issues || []).slice(0, 200).map(compactIssue),
    crawled: (a.crawled || (a.pages || []).map((p) => p.url)).filter(Boolean).slice(0, 100) };
  const signals = signalsOf(a);
  if (signals) audit.signals = signals;
  if (before?.generatedAt && before.generatedAt !== audit.generatedAt) audit.previous = { generatedAt: before.generatedAt, issues: (before.issues || []).filter((i) => WATCHED.has(i.rule)).slice(0, 100), ...(before.signals ? { signals: before.signals } : {}) };
  const profile = { mode: p.mode || null, platform: p.platform?.name ? { name: p.platform.name } : null, rendering: p.rendering || null, inRepository: !!p.inRepository };
  return [
    { kind: "report", key: "audit", value: audit, basis: "verified", confidence: null, source: "scan" },
    { kind: "report", key: "profile", value: profile, basis: "inferred", confidence: null, source: "scan" },
    // What the site states about itself, as found (still data, never instructions); lets the strategy step skip a re-crawl.
    { kind: "report", key: "discovered", value: r.discovered || {}, basis: "stated", confidence: null, source: "scan" },
  ];
}

async function answersOf(store, siteId) {
  const rows = (await store.readMemory?.(siteId, "answer")) || [];
  return Object.fromEntries(rows.map((m) => [m.key, m.value?.value]));
}
