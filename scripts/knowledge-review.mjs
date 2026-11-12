// Which playbooks and skills need a review (D49): no date, no sources, or last reviewed more than 90 days ago.
// Pure read of the repository; run monthly (or any time).   node scripts/knowledge-review.mjs [--json]
import { readKnowledge } from "../src/god/knowledge.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { playbookMeta, reviewState, metaProblems } from "../src/analysis/knowledge-meta.mjs";

const dir = fileURLToPath(new URL("../knowledge/", import.meta.url));
const kb = readKnowledge();
const users = {}; for (const [a, r] of Object.entries(kb.refs)) for (const p of r.playbooks) (users[p] ||= []).push(a);
const rows = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort().map((f) => {
  const text = readFileSync(dir + f, "utf8"), m = playbookMeta(text), r = reviewState(m);
  return { file: `knowledge/${f}`, ...r, reviewed: m.reviewed, sources: m.sources.length, problems: metaProblems(text), agents: (users[f] || []).length };
});
if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else {
  const count = (s) => rows.filter((r) => r.state === s).length;
  console.log(`Playbooks: ${rows.length} · current ${count("current")} · stale ${count("stale")} · unsourced ${count("unsourced")} · undated ${count("undated")}\n`);
  for (const r of [...rows].sort((a, b) => (a.state === "current") - (b.state === "current") || b.agents - a.agents))
    console.log(`${r.state.padEnd(9)} ${String(r.agents).padStart(2)} agents  ${r.reviewed || "----------"}  ${String(r.sources).padStart(2)} sources  ${r.file}${r.problems.length ? `  PROBLEMS: ${r.problems.join("; ")}` : ""}`);
}
