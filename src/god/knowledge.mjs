// The playbooks and skills each agent reads (Phase 1 of docs/product/SYSTEM-READINESS-PLAN.md). Every agent's
// "Read first" section names its playbooks (knowledge/*.md); its skills are named anywhere in the file as
// seo-autopilot/skills/<name>/SKILL.md. The hosted runner sends exactly those files with the agent's instructions, so
// the agent follows the methods we wrote instead of its general knowledge. Our own files: trusted reference material,
// unlike site data. Pure functions plus one reader; the Worker bundles the result (cloud/worker/build.mjs).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listAgents, listSkills, DEPARTMENTS_DIR } from "../core/agents.mjs";

export const KNOWLEDGE_DIR = (() => { try { return fileURLToPath(new URL("../../knowledge/", import.meta.url)); } catch { return null; } })();

/** Characters of reference material one run may carry (about 12,000 tokens). Larger sets are cut, and the cut is reported. */
export const MAX_KNOWLEDGE_CHARS = 48_000;

/** The playbooks and skills one agent names. text: the agent's markdown; known: { playbooks: Set, skills: Set }. */
export function referencesOf(text, known) {
  const t = String(text).replace(/\r\n/g, "\n");
  const read = (t.match(/## Read first\n([\s\S]*?)(\n## |$)/) || [])[1] || "";
  const playbooks = [], skills = [];
  for (const m of read.matchAll(/`(?:seo-autopilot\/knowledge\/)?([a-z0-9-]+\.md)`/g)) if (known.playbooks.has(m[1]) && !playbooks.includes(m[1])) playbooks.push(m[1]);
  for (const m of t.matchAll(/seo-autopilot\/skills\/([a-z0-9-]+)\/SKILL\.md/g)) if (known.skills.has(m[1]) && !skills.includes(m[1])) skills.push(m[1]);
  return { playbooks, skills };
}

const stripFront = (s) => String(s).replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "").trim();

/** Everything the runner needs, read from the repository: { playbooks: {file: text}, skills: {name: text}, refs: {agent: {playbooks, skills}} }. */
export function readKnowledge(kdir = KNOWLEDGE_DIR, ddir = DEPARTMENTS_DIR) {
  const playbooks = Object.fromEntries(readdirSync(kdir).filter((f) => f.endsWith(".md") && f !== "README.md").sort().map((f) => [f, stripFront(readFileSync(join(kdir, f), "utf8"))]));
  const skills = Object.fromEntries(listSkills(ddir).map((s) => [s.name, stripFront(readFileSync(s.file, "utf8"))]));
  const known = { playbooks: new Set(Object.keys(playbooks)), skills: new Set(Object.keys(skills)) };
  const refs = Object.fromEntries(listAgents(ddir).map((a) => [a.name, referencesOf(readFileSync(a.file, "utf8"), known)]));
  return { playbooks, skills, refs };
}

/**
 * The reference block for one agent, and what it contains. Files are added in the order the agent names them (its
 * first-named playbook matters most); one that would pass the limit is left out and listed in `skipped`.
 */
export function knowledgeBlock(agent, kb, max = MAX_KNOWLEDGE_CHARS) {
  const ref = kb?.refs?.[agent];
  if (!ref) return { text: "", used: [], skipped: [] };
  const parts = [], used = [], skipped = []; let size = 0;
  const add = (label, body) => {
    if (!body) return;
    const piece = `<reference name="${label}">\n${body}\n</reference>`;
    if (size + piece.length > max) { skipped.push(label); return; }
    parts.push(piece); used.push(label); size += piece.length;
  };
  for (const p of ref.playbooks) add(`knowledge/${p}`, kb.playbooks[p]);
  for (const s of ref.skills) add(`skills/${s}`, kb.skills[s]);
  if (!parts.length) return { text: "", used, skipped };
  const text = `\n# Your playbooks and skills\nThese are this product's own reviewed methods. Follow them; where the site data and a playbook disagree, say so. Paths inside them refer to a repository you cannot read here: use the site data instead.\n${parts.join("\n")}\n`;
  return { text, used, skipped };
}

/** For tests and the build: whether the repository's knowledge folder is present (absent inside the Worker bundle). */
export const haveKnowledge = () => Boolean(KNOWLEDGE_DIR && existsSync(KNOWLEDGE_DIR));
