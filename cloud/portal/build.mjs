// Builds the portal page: cloud/portal/app/index.html with the Supabase address, its publishable key and the agent
// roster filled in, written to cloud/portal/dist/ with a robots.txt that keeps it out of search. Both values are public
// (the publishable key only reaches what row level security allows). No dependencies.
//   PORTAL_SUPABASE_URL=https://<ref>.supabase.co PORTAL_SUPABASE_KEY=<publishable key> node cloud/portal/build.mjs [outDir]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEPARTMENTS } from "../../src/god/departments.mjs";
import { BRIEF } from "../../src/god/onboarding.mjs";
import { listAgents } from "../../src/core/agents.mjs";
import { readKnowledge } from "../../src/god/knowledge.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const ORDER = ["command", "research", "content", "quality", "technical", "authority", "ai-search", "verticals"];
const NAMES = { "ai-search": "AI search" };

export function departments(dir = join(root, "departments")) {
  const out = {};
  for (const d of ORDER) {
    const p = join(dir, d, "agents");
    if (existsSync(p)) out[NAMES[d] || d[0].toUpperCase() + d.slice(1)] = readdirSync(p).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
  }
  return out;
}

/** The master spec's eight departments with their agents (from departments/<dir>/agents) and engine jobs (src/god/departments.mjs). */
export function organisation(dir = join(root, "departments")) {
  const agentsIn = (d) => { const p = join(dir, d, "agents"); return existsSync(p) ? readdirSync(p).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort() : []; };
  const packs = { research: agentsIn("verticals") };
  return { director: agentsIn("command").filter((a) => !DEPARTMENTS.some((d) => (d.agents || []).includes(a))),
    departments: DEPARTMENTS.map((d) => ({ id: d.id, name: d.name, agents: [...d.agentDirs.flatMap(agentsIn), ...(d.agents || []), ...(packs[d.id] || [])], jobs: d.jobs })) };
}

/**
 * Every agent's own instructions and the playbooks and skills it reads (D45), for the read-only agent pages (D46):
 * { agents: { name: { department, description, text, playbooks, skills } }, files: { "knowledge/x.md": { title, words, sources, reviewed } } }.
 * Changes to an agent happen in the repository (reviewed, versioned, tested), never in the portal.
 */
export function agentCatalog() {
  const kb = readKnowledge(), files = {};
  const meta = (text) => ({ title: (String(text).match(/^# (.+)$/m) || [])[1] || null, words: String(text).split(/\s+/).filter(Boolean).length,
    sources: /^##+ (Sources|References)\b/im.test(text), reviewed: (String(text).match(/^(?:Last reviewed|Reviewed):\s*(\d{4}-\d{2}-\d{2})/im) || [])[1] || null });
  for (const [f, t] of Object.entries(kb.playbooks)) files[`knowledge/${f}`] = meta(t);
  for (const [n, t] of Object.entries(kb.skills)) files[`skills/${n}`] = meta(t);
  const agents = {};
  for (const a of listAgents()) {
    const raw = readFileSync(a.file, "utf8").replace(/\r\n/g, "\n");
    agents[a.name] = { department: a.department, description: (raw.match(/^description:\s*(.+)$/m) || [])[1] || "",
      text: raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim(), playbooks: kb.refs[a.name].playbooks.map((p) => `knowledge/${p}`), skills: kb.refs[a.name].skills.map((x) => `skills/${x}`) };
  }
  return { agents, files };
}

export function build({ url = process.env.PORTAL_SUPABASE_URL || "", key = process.env.PORTAL_SUPABASE_KEY || "", out = join(here, "dist") } = {}) {
  if (url && !/^(https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)\/?$/.test(url)) throw new Error("PORTAL_SUPABASE_URL must be https://<project>.supabase.co");
  if (/service_role|^sb_secret_/.test(key)) throw new Error("Use the publishable (anon) key, never the service role or a secret key.");
  const cfg = JSON.stringify({ supabaseUrl: url.replace(/\/$/, ""), anonKey: key }).replace(/</g, "\\u003c");
  const html = readFileSync(join(here, "app/index.html"), "utf8").replace("__CONFIG__", cfg).replace("__ORG__", JSON.stringify(organisation())).replace("__BRIEF__", JSON.stringify(BRIEF).replace(/</g, "\\u003c")).replace("__AGENTS__", () => JSON.stringify(agentCatalog()).replace(/</g, "\\u003c")); // a function: "$&" in agent text stays literal
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.html"), html);
  writeFileSync(join(out, "robots.txt"), "User-agent: *\nDisallow: /\n");
  return { out, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = build({ out: process.argv[2] ? resolve(process.argv[2]) : undefined });
  console.log(`portal: wrote ${r.out}/index.html (${Math.round(r.bytes / 1024)} KB)`);
}
