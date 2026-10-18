// Where the agent definitions live. In the product they are grouped by department (departments/<dept>/agents/<name>.md);
// installed projects get them flat in <dataDir>/agents/, so workflows and the Python runtime find any agent by name alone.
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEPARTMENTS_DIR = fileURLToPath(new URL("../../departments/", import.meta.url));

/** Departments in pipeline order: plan, find, fix, write, earn, answer engines, special sites, then the checks before approval. */
export const DEPARTMENTS = ["command", "research", "technical", "content", "authority", "ai-search", "verticals", "quality"];

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
