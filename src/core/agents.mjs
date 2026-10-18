// Where the agent definitions live. In the product they are grouped by department (departments/<dept>/agents/<name>.md);
// installed projects get them flat in <dataDir>/agents/, so workflows and the Python runtime find any agent by name alone.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEPARTMENTS_DIR = fileURLToPath(new URL("../../departments/", import.meta.url));

/** Departments in pipeline order: plan, find, fix, write, earn, answer engines, special sites, then the checks before approval. */
export const DEPARTMENTS = ["command", "research", "technical", "content", "authority", "ai-search", "verticals", "quality"];

/** { name: { department, edits } } for the work-order planner. An agent edits files if its tools allow Edit, Write or any shell. */
export function agentFacts(dir = DEPARTMENTS_DIR) {
  return Object.fromEntries(listAgents(dir).map(({ name, department, file }) => {
    const tools = (readFileSync(file, "utf8").replace(/\r\n/g, "\n").match(/^tools:\s*(.+)$/m) || [])[1] || "";
    return [name, { department, edits: /(^|,\s*)(Edit|Write|Bash)(\s*,|\s*$)/.test(tools) }];
  }));
}

/** Shared skills (departments/skills/<name>/SKILL.md): reusable procedures several agents follow. { name, file, usedBy }. */
export function listSkills(dir = DEPARTMENTS_DIR) {
  const d = join(dir, "skills");
  if (!existsSync(d)) return [];
  return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(d, e.name, "SKILL.md"))).map((e) => e.name).sort().map((name) => {
    const file = join(d, name, "SKILL.md");
    const used = (readFileSync(file, "utf8").replace(/\r\n/g, "\n").match(/^used-by:\s*(.+)$/m) || [])[1] || "";
    return { name, file, usedBy: used.split(",").map((x) => x.trim()).filter(Boolean) };
  });
}

/** Every agent as { name, department, file }, in department order then by name. Names are unique across departments. */
export function listAgents(dir = DEPARTMENTS_DIR) {
  const out = [];
  for (const department of DEPARTMENTS) {
    const d = join(dir, department, "agents");
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((x) => /^seo-.*\.md$/.test(x)).sort()) out.push({ name: f.slice(0, -3), department, file: join(d, f) });
  }
  return out;
}
