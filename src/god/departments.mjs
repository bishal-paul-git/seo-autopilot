// The eight departments of the master spec (§2, Q05) mapped onto what exists today: agent definitions from
// departments/<dept>/agents and the engine jobs. A department here is a routing and accountability unit, not a running
// process: work runs only as jobs (src/god/worker.mjs). Pure data plus lookups.

export const DEPARTMENTS = [
  { id: "research", name: "Research & Intelligence", agentDirs: ["research"], jobs: ["keywords", "rank", "gap", "research", "news", "serp"] },
  { id: "technical", name: "Technical SEO", agentDirs: ["technical"], jobs: ["audit", "speed", "vitals", "schema", "redirects", "render", "linkgraph", "logs", "scan"] },
  { id: "content", name: "Content & On-Page SEO", agentDirs: ["content"], jobs: ["quality", "optimize", "refresh", "links", "facts"] },
  { id: "authority", name: "Authority & Off-Page SEO", agentDirs: ["authority"], jobs: ["authority", "inbound", "mentions", "backlinks-queue", "citations"] },
  { id: "analytics", name: "Analytics & Performance", agentDirs: [], agents: ["seo-reporter"], jobs: ["daily", "gsc", "conversions", "experiments", "forecast", "digest", "monthly", "watch"] },
  { id: "ai-search", name: "AI Search & Visibility", agentDirs: ["ai-search"], jobs: ["geo", "ai-visibility", "entity"] },
  { id: "automation", name: "Automation & Integrations", agentDirs: [], agents: ["seo-coordinator"], jobs: ["work", "autopilot", "release", "schedule", "indexnow", "portal", "profile"] },
  { id: "quality", name: "Quality, Risk & Governance", agentDirs: ["quality"], jobs: ["consent", "ymyl", "pace"] },
];
// Specialist packs (D21) stay under the department whose work they do.
const PACKS = { verticals: "research" };

/** Department id for an agent definition (its folder) or an engine job name. Unknown names go to Automation. */
export function departmentOf({ agent, agentDir, job } = {}) {
  if (agent) { const d = DEPARTMENTS.find((x) => (x.agents || []).includes(agent)); if (d) return d.id; }
  if (agentDir) { if (PACKS[agentDir]) return PACKS[agentDir]; const d = DEPARTMENTS.find((x) => x.agentDirs.includes(agentDir)); if (d) return d.id; }
  if (job) { const d = DEPARTMENTS.find((x) => x.jobs.includes(job)); if (d) return d.id; }
  return "automation";
}

// Risk of running an agent as a job (§5 risk policy): agents that only read and report are low; agents that edit files on
// a seo/* branch are medium; agents whose changes are site-wide or destructive by nature are high (always need approval).
const HIGH = new Set(["seo-technical-fixer", "seo-migration-planner", "seo-redirect-guardian", "seo-content-pruner", "seo-link-builder", "seo-international"]);
export function agentRisk(agent, { mayEdit = false } = {}) {
  if (HIGH.has(agent)) return "high";
  return mayEdit ? "medium" : "low";
}
