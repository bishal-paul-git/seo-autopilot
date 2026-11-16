// Builds the portal page: cloud/portal/app/index.html with the Supabase address, its publishable key and the agent
// roster filled in, written to cloud/portal/dist/ with robots.txt and sitemap.xml for the public landing page (D59).
// Both values are public (the publishable key only reaches what row level security allows). No dependencies.
//   PORTAL_SUPABASE_URL=https://<ref>.supabase.co PORTAL_SUPABASE_KEY=<publishable key> [PORTAL_WORKER_URL=https://seo-god.<sub>.workers.dev]
//   [PORTAL_PUBLIC_URL=https://seo.erudience.com] node cloud/portal/build.mjs [outDir]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEPARTMENTS } from "../../src/god/departments.mjs";
import { BRIEF } from "../../src/god/onboarding.mjs";
import { listAgents } from "../../src/core/agents.mjs";
import { readKnowledge } from "../../src/god/knowledge.mjs";
import { playbookMeta, reviewState } from "../../src/analysis/knowledge-meta.mjs";

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
  // D49: one parser for review date and sources (src/analysis/knowledge-meta.mjs); stale after 90 days.
  const meta = (text) => { const m = playbookMeta(text), r = reviewState(m); return { title: (String(text).match(/^# (.+)$/m) || [])[1] || null, words: String(text).split(/\s+/).filter(Boolean).length,
    sources: m.sources.length, reviewed: m.reviewed, version: m.version, state: r.state }; };
  for (const [f, t] of Object.entries(kb.playbooks)) files[`knowledge/${f}`] = meta(t);
  for (const [n, t] of Object.entries(kb.skills)) files[`skills/${n}`] = meta(t);
  const agents = {};
  for (const a of listAgents()) {
    const raw = readFileSync(a.file, "utf8").replace(/\r\n/g, "\n");
    agents[a.name] = { department: a.department, description: (raw.match(/^description:\s*(.+)$/m) || [])[1] || "",
      text: raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim(), playbooks: kb.refs[a.name].playbooks.map((p) => `knowledge/${p}`), skills: kb.refs[a.name].skills.map((x) => `skills/${x}`) };
  }
  // Latest exam scores (D48), when a run was published: { model, date, agents: { name: { cases, passed, rate } } }.
  const latest = join(root, "exams/latest.json");
  const exams = existsSync(latest) ? JSON.parse(readFileSync(latest, "utf8")) : null;
  return { agents, files, exams };
}

/** robots.txt and sitemap.xml for the one public URL (D59). The app's pages are hash routes of that URL, so there is
 * nothing else to list; old copies kept next to it on the host (previous-*.html) stay out of search. */
export function crawlFiles(publicUrl, day = new Date().toISOString().slice(0, 10)) {
  const base = publicUrl.replace(/\/$/, "");
  return {
    robots: `User-agent: *\nDisallow: /previous-\nSitemap: ${base}/sitemap.xml\n`,
    sitemap: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${base}/</loc><lastmod>${day}</lastmod></url>\n</urlset>\n`,
  };
}

export function build({ url = process.env.PORTAL_SUPABASE_URL || "", key = process.env.PORTAL_SUPABASE_KEY || "", workerUrl = process.env.PORTAL_WORKER_URL || "", publicUrl = process.env.PORTAL_PUBLIC_URL || "https://seo.erudience.com", out = join(here, "dist"), allowUnconfigured = process.env.PORTAL_ALLOW_UNCONFIGURED === "1" } = {}) {
  if (url && !/^(https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)\/?$/.test(url)) throw new Error("PORTAL_SUPABASE_URL must be https://<project>.supabase.co");
  if (/service_role|^sb_secret_/.test(key)) throw new Error("Use the publishable (anon) key, never the service role or a secret key.");
  // D56: the Worker that serves the service account email and Check access (/google/*); empty hides them.
  if (workerUrl && !/^(https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)\/?$/.test(workerUrl)) throw new Error("PORTAL_WORKER_URL must be https://<worker host>");
  // D59: the address search engines and shared links use (canonical, Open Graph, sitemap).
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/.test(publicUrl)) throw new Error("PORTAL_PUBLIC_URL must be https://<host> with no path");
  // D62: a build without the Supabase address or key is a portal nobody can sign in to (it was published once by
  // mistake). Refused unless explicitly allowed (tests and local previews: allowUnconfigured / PORTAL_ALLOW_UNCONFIGURED=1).
  if ((!url || !key) && !allowUnconfigured) throw new Error("PORTAL_SUPABASE_URL and PORTAL_SUPABASE_KEY are required (set PORTAL_ALLOW_UNCONFIGURED=1 only for a local test build)");
  const pub = publicUrl.replace(/\/$/, "");
  const cfg = JSON.stringify({ supabaseUrl: url.replace(/\/$/, ""), anonKey: key, workerUrl: workerUrl.replace(/\/$/, "") }).replace(/</g, "\\u003c");
  const html = readFileSync(join(here, "app/index.html"), "utf8").replaceAll("__PUBLIC_URL__", pub).replace("__CONFIG__", cfg).replace("__ORG__", JSON.stringify(organisation())).replace("__BRIEF__", JSON.stringify(BRIEF).replace(/</g, "\\u003c")).replace("__AGENTS__", () => JSON.stringify(agentCatalog()).replace(/</g, "\\u003c")); // a function: "$&" in agent text stays literal
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.html"), html);
  const crawl = crawlFiles(pub);
  writeFileSync(join(out, "robots.txt"), crawl.robots);
  writeFileSync(join(out, "sitemap.xml"), crawl.sitemap);
  return { out, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = build({ out: process.argv[2] ? resolve(process.argv[2]) : undefined });
  console.log(`portal: wrote ${r.out}/index.html (${Math.round(r.bytes / 1024)} KB)`);
}
