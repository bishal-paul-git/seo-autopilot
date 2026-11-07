// Real job handlers for the worker (src/god/worker.mjs): the read-only scan and the strategy proposal. They call the
// product's existing modules and write the site's private memory through the store. Handlers never deploy anything;
// work that changes a website gets its own handler per authorized integration (R1-E1).
import { scanSite } from "../hosted/scan.mjs";
import { buildDossier, dossierMemory } from "./onboarding.mjs";

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
      await store.writeMemory(job.siteId, dossierMemory(dossier).filter((m) => m.kind !== "strategy" && m.kind !== "question"));
      return { evidence: [`${r.audit.summary.pagesCrawled} pages read from ${site.url}`, `${r.audit.issues.length} findings`, `${dossier.facts.length} facts with sources`], snapshot: r.snapshot };
    },
    async strategy_proposal(job) {
      const site = await siteOf(job.siteId);
      const r = last.get(job.siteId) || (await scan(site, scanOptions));
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

async function answersOf(store, siteId) {
  const rows = (await store.readMemory?.(siteId, "answer")) || [];
  return Object.fromEntries(rows.map((m) => [m.key, m.value?.value]));
}
