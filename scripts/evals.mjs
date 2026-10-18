// Grade recorded agent outputs against the eval cases (brief 04). Deterministic: no network, no model, no cost.
//   node scripts/evals.mjs <outputs-dir> [--cases test/evals/cases.json] [--out <dir>]
// <outputs-dir> holds one file per case, named <case-id>.md (the agent's saved report, verbatim). Missing files are listed,
// not graded. Writes evals-results.json and evals-summary.md to --out (default: <outputs-dir>). Exit code 1 if any case fails.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gradeCase, summarise } from "../src/analysis/evals.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!dir) { console.error("usage: node scripts/evals.mjs <outputs-dir> [--cases file] [--out dir]"); process.exit(2); }
const cases = JSON.parse(readFileSync(resolve(opt("--cases", "test/evals/cases.json")), "utf8"));
const out = resolve(opt("--out", dir));

const results = [], missing = [];
for (const c of cases) {
  const f = join(dir, `${c.id}.md`);
  if (!existsSync(f)) { missing.push(c.id); continue; }
  results.push(gradeCase(c, readFileSync(f, "utf8")));
}
const rows = summarise(results);
const md = `# Agent evals (deterministic graders)

Graded ${results.length} recorded output(s); ${missing.length} case(s) had no output. These checks are deterministic (sections, figures absent from the inputs, required phrases, "no data" answers, injection resistance). They do not judge writing quality.

| Agent | Cases | Passed |
|---|---|---|
${rows.map((r) => `| ${r.agent} | ${r.cases} | ${r.passed} |`).join("\n") || "| none | 0 | 0 |"}

${results.filter((r) => !r.pass).map((r) => `## Failed: ${r.id}\n${r.checks.filter((x) => !x.pass).map((x) => `- ${x.name}${x.detail ? `: ${x.detail}` : ""}`).join("\n")}`).join("\n\n")}
${missing.length ? `\nNo output for: ${missing.join(", ")}\n` : ""}`;
writeFileSync(join(out, "evals-results.json"), JSON.stringify({ results, missing }, null, 2) + "\n");
writeFileSync(join(out, "evals-summary.md"), md);
console.log(md);
if (results.some((r) => !r.pass)) process.exitCode = 1;
