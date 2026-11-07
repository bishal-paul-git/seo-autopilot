// The unified registry of jobs, agents, skills and MCP tools, derived from the code so it cannot drift:
// what each one is for, how it is triggered, what it needs (credentials, hosts), what it reads and writes, what it may
// change, and how it is verified. Writes docs/registry.json and docs/registry.md; test/registry.test.mjs fails when they
// are out of date. Run: node scripts/build-registry.mjs
// Facts that cannot be read from code (live evidence) come from EVIDENCE below and must cite where they were observed.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

// Live evidence, by job: where a real run was observed. Everything else is "unit/mock" or "untested" by what the tests cover.
export const EVIDENCE = {
  daily: "real: erudience-flow-engine seo-daily runs (e.g. 2026-11-04 run 41834364691, success)",
  rank: "real: same seo-daily runs", propose: "real: same seo-daily runs", news: "real: same seo-daily runs", mentions: "real: same seo-daily runs",
  audit: "real: same seo-daily runs; hosted scan of 3 live sites on 2026-11-07", analyze: "real: same seo-daily runs", priorities: "real: same seo-daily runs",
  linkgraph: "real: same seo-daily runs", indexnow: "real: same seo-daily runs", dashboard: "real: same seo-daily runs", portal: "real: snapshot built in seo-daily runs; push not configured (no SEO_PORTAL_TOKEN)",
  release: "real: erudience-flow-engine seo-release runs", schedule: "real: erudience-flow-engine seo-release runs",
  backlinks: "real: erudience-flow-engine seo-backlinks runs (dry by default)", monthly: "real: erudience-flow-engine seo-monthly 2026-11-01",
};

const ENV_RE = /(?:process\.env|env)\.([A-Z][A-Z0-9_]{3,})/g;
const NOT_CREDS = /^(SEO_AUTOPILOT|SEO_AUTOPILOT_CONFIG|SEO_AUTOPILOT_HOME|SEO_AUTOPILOT_SPEC|SEO_PYTHON|PYTHONPATH|GITHUB_OUTPUT|GITHUB_REF_NAME|GITHUB_REPOSITORY|SEO_MODEL|SEO_LLM_PROVIDER|SEO_CRAWL_BIN|SEO_CHROMIUM_PATH|GOOGLE_ADS_API_VERSION|GOOGLE_ADS_LANGUAGE|MERCHANT_API_VERSION|OPENAI_BASE_URL|SEO_AI_[A-Z_]+_MODEL|BACKLINK_LIVE|SEO_AUTOPILOT_PAUSED)$/;

/** A module plus the local modules it imports (transitively), so a job's needs include its helpers'. */
function closure(rel, seen = new Set()) {
  if (seen.has(rel) || !existsSync(join(root, rel))) return seen;
  seen.add(rel);
  for (const m of read(rel).matchAll(/^import\s[^;]*?from\s+"(\.[^"]+)"/gm)) closure(join(dirname(rel), m[1]).replace(/\\/g, "/"), seen);
  for (const m of read(rel).matchAll(/import\("(\.[^"]+)"\)/g)) closure(join(dirname(rel), m[1]).replace(/\\/g, "/"), seen);
  return seen;
}

/** For each `run <job>` in a workflow, the opt-in variables gating it (job-level and step-level `if: vars.X == 'true'`). */
function jobGates(y, known) {
  const out = {}; let jobGate = [], stepGate = [];
  for (const line of y.split("\n")) {
    const g = [...line.matchAll(/vars\.(SEO_[A-Z_]+)\s*==\s*'true'/g)].map((m) => m[1]);
    if (/^  [a-z][\w-]*:\s*$/.test(line)) { jobGate = []; stepGate = []; }
    else if (/^    if:/.test(line)) jobGate = g;
    else if (/^      - /.test(line)) stepGate = /^\s*- if:/.test(line) ? g : [];
    else if (/^\s{8}if:/.test(line)) stepGate = g;
    for (const m of line.matchAll(/run (?:"\$SEO" )?\b([a-z][a-z-]+)\b/g)) if (known.has(m[1])) out[m[1]] = [...new Set([...(out[m[1]] || []), ...jobGate, ...stepGate])];
  }
  return out;
}

function workflows(known = new Set()) {
  const dir = join(root, "templates/workflows");
  return readdirSync(dir).filter((f) => f.endsWith(".yml")).map((f) => {
    const y = readFileSync(join(dir, f), "utf8");
    const gates = jobGates(y, known);
    const on = (/^on:([\s\S]*?)^[a-z]/m.exec(y) || ["", ""])[1];
    const cron = [...on.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
    const events = ["schedule", "workflow_dispatch", "workflow_call", "workflow_run", "pull_request", "issues", "push"].filter((e) => new RegExp(`\\b${e}\\b`).test(on));
    const gate = [...y.matchAll(/vars\.(SEO_[A-Z_]+)\s*==\s*'true'/g)].map((m) => m[1]);
    const jobs = Object.keys(gates);
    const agents = [...new Set([...y.matchAll(/agents\/([a-z-]+)\.md|run agent ([a-z-]+)/g)].map((m) => m[1] || m[2]))];
    const wfGate = (/^jobs:[\s\S]*?^    if:.*$/m.exec(y) || [""])[0].match(/vars\.(SEO_[A-Z_]+)\s*==\s*'true'/g) || [];
    return { file: f, cron, events, gatedBy: [...new Set(gate)], jobGates: gates, agentGate: [...new Set(wfGate.map((x) => x.match(/SEO_[A-Z_]+/)[0]))], jobs, agents, continueOnError: (y.match(/continue-on-error:\s*true/g) || []).length };
  });
}

export async function buildRegistry() {
  const { JOBS } = await import("../src/jobs/index.mjs");
  const { listAgents, listSkills } = await import("../src/core/agents.mjs");
  const wfs = workflows(new Set(Object.keys(JOBS)));
  const tests = readdirSync(join(root, "test")).filter((f) => f.endsWith(".mjs")).map((f) => read(`test/${f}`)).join("\n");

  const jobs = [];
  for (const [name, load] of Object.entries(JOBS)) {
    const mod = await load();
    const file = /import\("\.\/([^"]+)"\)/.exec(String(load))?.[1];
    const rel = `src/jobs/${file}`;
    const files = [...closure(rel)];
    const src = files.map(read).join("\n");
    const creds = [...new Set([...src.matchAll(ENV_RE)].map((m) => m[1]).filter((v) => !NOT_CREDS.test(v)))].sort();
    const hosts = [...new Set([...src.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})\//g)].map((m) => m[1]).filter((h) => !/example|schema\.org|github\.com\/bishal|w3\.org/.test(h)))].sort();
    const writes = [...new Set([...read(rel).matchAll(/write(?:Json|Text)\(`\$\{[^}]+\}\/([^`]+)`/g)].map((m) => m[1]))];
    const gh = /openIssue|ensureLabel|createPull|gh\(\s*\[?["'](?:issue|pr|api)/.test(src);
    const submits = /BACKLINK_LIVE|indexnow|api\/indexnow|submit/i.test(read(rel)) && /backlinks|indexnow/.test(name);
    const llm = /llmAvailable|ANTHROPIC_API_KEY|OPENAI_API_KEY/.test(src);
    const risk = submits ? "external" : gh ? "github-write" : "read-only";
    const triggers = wfs.filter((w) => w.jobs.includes(name)).map((w) => ({ workflow: w.file, cron: w.cron, events: w.events, gatedBy: w.jobGates[name] || [] }));
    const tested = new RegExp(`["'\`]${name.replace(/-/g, "\\-")}["'\`]|jobs/${file.replace(".mjs", "")}`).test(tests);
    jobs.push({
      name, purpose: mod.description || "", source: rel, owner: "maintainers (product core)",
      mode: !triggers.length ? "manual (CLI, MCP or workflow_dispatch)" : triggers.some((t) => !t.gatedBy.length) ? "scheduled (on by default)" : "scheduled (off until an opt-in variable is set)",
      triggers, credentials: creds, hosts, writes, permissions: risk, usesLLM: llm,
      onError: triggers.length ? "the workflow step logs the error; most steps use continue-on-error so one failing job does not stop the run; no automatic retry" : "exits non-zero; no automatic retry",
      verification: EVIDENCE[name] || (tested ? "unit/fixture tests only (external calls mocked)" : "untested (no test names the job; its analysis module may be tested)"),
    });
  }

  const agents = listAgents().map((a) => {
    const text = readFileSync(a.file, "utf8");
    const fm = (/^---\n([\s\S]*?)\n---/.exec(text) || ["", ""])[1];
    const field = (k) => (new RegExp(`^${k}:\\s*(.*)$`, "m").exec(fm) || [])[1] || "";
    const tools = field("tools").split(/,\s*(?![^()]*\))/).map((t) => t.trim()).filter(Boolean);
    const edits = tools.some((t) => /^(Edit|Write|Bash)/.test(t));
    const reads = [...new Set([...text.matchAll(/knowledge\/([a-z0-9-]+\.md)|skills\/([a-z0-9-]+)/g)].map((m) => m[1] || m[2]))];
    const auto = wfs.filter((w) => w.agents.includes(a.name)).map((w) => ({ workflow: w.file, events: w.events, gatedBy: w.agentGate.length ? w.agentGate : w.gatedBy }));
    return {
      name: a.name, department: a.department, purpose: field("description").slice(0, 400), source: a.file.replace(root + "/", ""),
      tools, mayEdit: edits, mayRunShell: tools.some((t) => /^Bash$/.test(t)), reads,
      mode: auto.length ? `workflow (${auto.map((x) => x.workflow).join(", ")})` : "on request in Claude Code (plugin) or via the team/agent jobs",
      triggers: auto, risk: tools.some((t) => /^Bash$/.test(t)) ? "high (unrestricted shell, supervised only)" : edits ? "medium (edits files on a seo/* branch; a person or the autopilot policy merges)" : "low (reads and reports)",
      verification: "definition tests only (test/agents.test.mjs); output quality never graded on a real site",
    };
  });

  const skills = listSkills().map((s) => ({ name: s.name, usedBy: s.usedBy, source: s.file.replace(root + "/", "") }));
  const mcp = [...read("src/mcp/core.mjs").matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]);
  return { generatedFrom: "code (scripts/build-registry.mjs)", counts: { jobs: jobs.length, agents: agents.length, skills: skills.length, mcpTools: mcp.length, workflows: wfs.length }, jobs, agents, skills, mcpTools: mcp, workflows: wfs };
}

export function toMarkdown(r) {
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const trig = (t) => t.map((x) => `${x.workflow.replace(".yml", "")}${x.cron?.length ? ` (${x.cron.join("; ")})` : ""}${x.gatedBy?.length ? ` if ${x.gatedBy.join(", ")}=true` : ""}`).join("<br>") || "manual";
  return `# Registry of jobs, agents, skills and MCP tools

Generated from the code by \`node scripts/build-registry.mjs\`; do not edit by hand (\`test/registry.test.mjs\` fails when it is stale).
Machine-readable: [registry.json](registry.json). Counts: ${r.counts.jobs} jobs, ${r.counts.agents} agents, ${r.counts.skills} skills, ${r.counts.mcpTools} MCP tools, ${r.counts.workflows} workflow templates.

How to read it:
- **Permissions:** read-only (reads the site and APIs, writes reports in the state folder), github-write (opens issues, labels, pull requests), external (sends something to a third party).
- **Verification:** "real" cites an observed production run; "unit/fixture" means tests with mocked external calls, which is not proof the live integration works; "untested" means no test names the job.
- **Errors:** no job retries by itself; scheduled steps mostly use continue-on-error, so one failure does not stop the rest of the run.

## Jobs
| Job | Purpose | Mode and trigger | Credentials | Writes | Permissions | LLM | Verification |
|---|---|---|---|---|---|---|---|
${r.jobs.map((j) => `| \`${j.name}\` | ${esc(j.purpose)} | ${esc(j.mode)}<br>${esc(trig(j.triggers))} | ${j.credentials.map((c) => `\`${c}\``).join(" ") || "none"} | ${j.writes.map((w) => `\`${w}\``).join(" ") || "-"} | ${j.permissions} | ${j.usesLLM ? "optional" : "no"} | ${esc(j.verification)} |`).join("\n")}

## Agents
| Agent | Department | Mode | Risk | Tools | Purpose |
|---|---|---|---|---|---|
${r.agents.map((a) => `| \`${a.name}\` | ${a.department} | ${esc(a.mode)}${a.triggers.some((t) => t.gatedBy.length) ? ` (opt-in: ${[...new Set(a.triggers.flatMap((t) => t.gatedBy))].join(", ")})` : ""} | ${esc(a.risk)} | ${esc(a.tools.join(", "))} | ${esc(a.purpose.slice(0, 220))} |`).join("\n")}

Every agent: verification is definition tests only; no agent's output has been graded on a real site.

## Skills
| Skill | Used by |
|---|---|
${r.skills.map((s) => `| \`${s.name}\` | ${s.usedBy.join(", ")} |`).join("\n")}

## MCP tools (read-only)
${r.mcpTools.map((t) => `\`${t}\``).join(", ")}

## Workflow templates
| Workflow | Events | Schedule | Opt-in variable | Jobs | Agents | continue-on-error steps |
|---|---|---|---|---|---|---|
${r.workflows.map((w) => `| \`${w.file}\` | ${w.events.join(", ")} | ${w.cron.join("; ") || "-"} | ${w.gatedBy.join(", ") || "-"} | ${w.jobs.join(", ") || "-"} | ${w.agents.join(", ") || "-"} | ${w.continueOnError} |`).join("\n")}
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await buildRegistry();
  writeFileSync(join(root, "docs/registry.json"), JSON.stringify(r, null, 1) + "\n");
  writeFileSync(join(root, "docs/registry.md"), toMarkdown(r));
  console.log(`registry: ${r.counts.jobs} jobs, ${r.counts.agents} agents, ${r.counts.skills} skills, ${r.counts.mcpTools} MCP tools`);
}
