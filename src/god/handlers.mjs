// Real job handlers for the worker (src/god/worker.mjs): the read-only scan and the strategy proposal. They call the
// product's existing modules and write the site's private memory through the store. Handlers never deploy anything;
// work that changes a website gets its own handler per authorized integration (R1-E1).
import { buildDossier, dossierMemory } from "./onboarding.mjs";

// The crawler loads only where it runs (Node, the Supabase scan function); the Cloudflare Worker passes a remote scan.
const scanSite = (...a) => import("../hosted/scan.mjs").then((m) => m.scanSite(...a));
const FRESH_MS = 36 * 3600e3;

/**
 * deps: { store (with writeMemory, readMemory), siteOf: async (siteId) => ({ id, name, url }), scan: scanSite override for tests, scanOptions }
 */
export function makeHandlers({ store, siteOf, scan = scanSite, scanOptions = {} }) {
  const last = new Map(); // siteId -> latest scan result in this worker process
  return {
    async scan(job) {
      const site = await siteOf(job.siteId);
      const r = await scan(site, scanOptions);
      last.set(job.siteId, r);
      const dossier = buildDossier({ site, discovered: r.discovered, profile: r.profile, audit: r.audit, answers: await answersOf(store, job.siteId) });
      await store.writeMemory(job.siteId, [...dossierMemory(dossier).filter((m) => m.kind !== "strategy" && m.kind !== "question"), ...reportMemory(r)]);
      return { evidence: [`${r.audit.summary.pagesCrawled} pages read from ${site.url}`, `${r.audit.issues.length} findings`, `${dossier.facts.length} facts with sources`], snapshot: r.snapshot };
    },
    async strategy_proposal(job) {
      const site = await siteOf(job.siteId);
      // Prefer this process's scan, then the compact scan kept in memory (a new Worker invocation has no process state),
      // and crawl again only when neither is fresh.
      const r = last.get(job.siteId) || (await scanFromMemory(store, job.siteId)) || (await scan(site, scanOptions));
      const dossier = buildDossier({ site, discovered: r.discovered, profile: r.profile, audit: r.audit, answers: await answersOf(store, job.siteId) });
      await store.writeMemory(job.siteId, dossierMemory(dossier).filter((m) => m.kind === "strategy" || m.kind === "question"));
      return {
        evidence: [`dossier: ${dossier.facts.length} facts, ${dossier.questions.length} open questions`, `first steps from ${r.audit.summary.pagesCrawled} audited pages`],
        claims: dossier.strategyDraft.firstSteps.map((s) => ({ text: s.title, source: "audit" })),
        proposal: dossier.strategyDraft, questions: dossier.questions,
      };
    },
  };
}

async function scanFromMemory(store, siteId) {
  const rows = (await store.readMemory?.(siteId, "report")) || [];
  const get = (k) => rows.find((m) => m.key === k)?.value;
  const audit = get("audit"), discovered = get("discovered");
  if (!audit || !discovered || Date.now() - Date.parse(audit.generatedAt || 0) > FRESH_MS) return null;
  return { audit: { ...audit, pages: [] }, discovered, profile: get("profile") || {} };
}

/** The compact reports the planner needs on its next tick (audit age and findings, site profile), kept in site memory. */
export function reportMemory(r) {
  const a = r.audit || {}, p = r.profile || {};
  const audit = { generatedAt: a.generatedAt || new Date().toISOString(), summary: a.summary || {}, issues: (a.issues || []).slice(0, 200).map((i) => ({ rule: i.rule, severity: i.severity, url: i.url })) };
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
