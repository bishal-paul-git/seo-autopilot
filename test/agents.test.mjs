// The agent files and playbooks are product content: keep them internally consistent.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { RULES } from "../src/audit/rules.mjs";

import { listAgents, DEPARTMENTS } from "../src/core/agents.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const departmentsDir = join(root, "departments"), knowledgeDir = join(root, "knowledge");
const agents = listAgents();
const agentFiles = agents.map((a) => `${a.name}.md`);
const pathOf = Object.fromEntries(agents.map((a) => [`${a.name}.md`, a.file]));

test("twenty-eight agents exist, with unique names across departments", () => {
  assert.equal(agentFiles.length, 28);
  assert.equal(new Set(agentFiles).size, agentFiles.length);
});

test("every department folder is a known department with a charter, and holds only agents", () => {
  const dirs = readdirSync(departmentsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.deepEqual([...dirs].sort(), [...DEPARTMENTS].sort());
  for (const d of DEPARTMENTS) {
    assert.ok(existsSync(join(departmentsDir, d, "README.md")), `${d} has no README.md`);
    for (const f of readdirSync(join(departmentsDir, d, "agents"))) assert.match(f, /^seo-[a-z-]+\.md$/, `${d}/agents/${f}`);
  }
});

test("the Claude Code plugin lists every agent (plugins only find agents/ by default, and ours live in departments/)", () => {
  const plugin = JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8"));
  assert.deepEqual(plugin.agents, agents.map((a) => "./" + a.file.slice(root.length).replace(/\\/g, "/").replace(/^\//, "")));
});

for (const f of agentFiles) {
  const text = readFileSync(pathOf[f], "utf8");
  test(`${f}: front matter, required sections, and real playbook references`, () => {
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, "front matter");
    assert.equal((fm[1].match(/^name:\s*(.+)$/m) || [])[1], f.replace(/\.md$/, ""));
    assert.ok(/^description:\s*\S/m.test(fm[1]) && /^tools:\s*\S/m.test(fm[1]));
    assert.equal((fm[1].match(/^department:\s*(.+)$/m) || [])[1], agents.find((a) => `${a.name}.md` === f).department, "department in front matter matches its folder");
    for (const h of ["## Mission", "## Read first", "## Method", "## Quality bar", "## Never", "## Output"]) assert.ok(text.includes(h), `missing ${h}`);
    for (const m of text.matchAll(/`([a-z0-9-]+\.md)`/g)) {
      const name = m[1];
      if (name === "README.md" || name.startsWith("seo-")) continue;
      assert.ok(existsSync(join(knowledgeDir, name)) || ["priorities.md", "audit.md", "geo.md", "speed.md", "experiments.md", "weekly-digest.md", "daily-summary.md", "news-digest.md", "agent-plan.md", "site-profile.md"].includes(name), `unknown file referenced: ${name}`);
    }
  });
}

test("every agent starts from the site profile, so none assumes one stack", () => {
  for (const f of agentFiles) assert.ok(readFileSync(pathOf[f], "utf8").includes("site-profile.json"), f);
});

test("every agent the router can recommend exists", async () => {
  const { routeAgents } = await import("../src/analysis/agent-router.mjs");
  const plan = routeAgents({ profile: { mode: "edit", rendering: "js-dependent", signals: { structuredData: ["LocalBusiness", "Product"], hreflang: true, noindexOnHome: true }, platform: { name: "Shopify" } }, audit: { issues: Object.keys(RULES).map((rule) => ({ rule, url: "https://a.test/" })) }, priorities: { items: [{ type: "structure", title: "x" }, { type: "snippet", title: "y" }, { type: "refresh", title: "z" }, { type: "content", id: "strike:q", title: "w" }, { type: "ai-search", title: "v" }, { type: "indexing", title: "i" }, { id: "speed:poor", type: "speed", title: "s" }] }, inspect: { "https://a.test/": { coverage: "Crawled - currently not indexed" } }, geo: { findings: [{ title: "g" }] }, pipeline: { queued: 1, upcoming: 0, schedule: [] }, site: { local: true } });
  for (const s of plan.steps) assert.ok(agentFiles.includes(s.agent + ".md"), "router names a missing agent: " + s.agent);
});

test("every report the router tells an agent to use is named in that agent's Inputs", async () => {
  const { routeAgents } = await import("../src/analysis/agent-router.mjs");
  const plan = routeAgents({
    profile: { mode: "edit", signals: { structuredData: [] } },
    audit: { issues: Object.keys(RULES).map((rule) => ({ rule, url: "https://a.test/" })) },
    priorities: { items: [{ type: "structure", title: "x" }, { type: "snippet", title: "y" }, { type: "refresh", title: "z" }, { type: "content", id: "strike:q", title: "w" }, { type: "ai-search", title: "v" }, { type: "indexing", title: "i" }] },
    consent: { findings: [{ id: "c", severity: "high", title: "c" }] },
    ymyl: { pages: [{ url: "https://a.test/m", status: "needs reviewer", topics: ["health"], missing: ["reviewer"] }] },
    pace: { overLimit: true, overDays: [], overWeeks: [], moves: [] },
    citations: { mostlyAbsent: true, appears: 0, asked: 5, absent: ["q"], topCited: [] },
    quality: { alignment: [{ url: "https://a.test/b", query: "q", weak: ["title"] }] },
    redirects: { check: { errors: ["loop"] } },
    facts: { unverified: [{ where: "a", claim: "47%" }] },
    links: { items: [{ from: "https://a.test/x", to: "https://a.test/y", reason: "mention" }] },
    render: { results: [{ url: "https://a.test/r", findings: [{ id: "prerender-text-not-on-page", severity: "high" }] }] },
  });
  const inputs = (name) => (readFileSync(pathOf[`${name}.md`], "utf8").match(/## Inputs\n([\s\S]*?)\n## /) || [])[1] || "";
  let checked = 0;
  for (const s of plan.steps) {
    for (const m of s.prompt.matchAll(/\b([a-z][a-z-]*\.json)\b/g)) {
      checked++;
      assert.ok(inputs(s.agent).includes(m[1]), `${s.agent} is sent ${m[1]} but its Inputs do not mention it`);
    }
  }
  assert.ok(checked >= 9, `only ${checked} report references checked`);
});

test("only the technical fixer may run arbitrary shell; the others are scoped", () => {
  for (const f of agentFiles) {
    const tools = (readFileSync(pathOf[f], "utf8").match(/^tools:\s*(.+)$/m) || [])[1];
    const bare = /(^|,\s*)Bash(\s*,|\s*$)/.test(tools);
    assert.equal(bare, f === "seo-technical-fixer.md", `${f} tools: ${tools}`);
  }
});

test("every playbook is listed in the knowledge index", () => {
  const index = readFileSync(join(knowledgeDir, "README.md"), "utf8");
  for (const f of readdirSync(knowledgeDir).filter((x) => x.endsWith(".md") && x !== "README.md")) assert.ok(index.includes(`(${f})`), `${f} not in index`);
});

test("every audit rule has a fix recipe", () => {
  const recipes = readFileSync(join(knowledgeDir, "audit-fix-recipes.md"), "utf8");
  for (const rule of Object.keys(RULES)) assert.ok(recipes.includes(`**${rule}`) || recipes.includes(`/ ${rule}`) || recipes.includes(`${rule}:`) || recipes.includes(`${rule} /`), `no recipe for ${rule}`);
});

test("every agent is listed in the org chart and in its department's charter", () => {
  const readme = readFileSync(join(departmentsDir, "README.md"), "utf8");
  for (const a of agents) {
    assert.ok(readme.includes(`(${a.department}/agents/${a.name}.md)`), `${a.name} not in departments/README.md`);
    assert.ok(readFileSync(join(departmentsDir, a.department, "README.md"), "utf8").includes(`(agents/${a.name}.md)`), `${a.name} not in ${a.department}/README.md`);
  }
});

test("upgrading agents keeps the user's own Project rules and refreshes the rest", async () => {
  const { keepProjectRules } = await import("../src/cli/init.mjs");
  const fresh = "# A\n\n## Method\nNEW METHOD\n\n## Project rules\n(placeholder)\n";
  const old = "# A\n\n## Method\nOLD METHOD\n\n## Project rules\nAlways use British spelling.\n";
  const merged = keepProjectRules(fresh, old);
  assert.ok(merged.includes("NEW METHOD") && !merged.includes("OLD METHOD"));
  assert.ok(merged.includes("Always use British spelling."));
  assert.equal(keepProjectRules(fresh, "# A\n\n## Method\nOLD\n\n## Project rules\n(placeholder)\n"), fresh);
});

test("the config schema accepts a config written by init", async () => {
  const schema = JSON.parse(readFileSync(join(root, "schema", "seo-autopilot.config.schema.json"), "utf8"));
  const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os");
  const { init } = await import("../src/cli/init.mjs");
  const dir = mkdtempSync(join(tmpdir(), "seo-schema-")); const cwd = process.cwd(), log = console.log; console.log = () => {}; process.chdir(dir);
  try { await init({ flags: { url: "https://s.test/", name: "S", "no-workflows": true } }); } finally { process.chdir(cwd); console.log = log; }
  const cfg = JSON.parse(readFileSync(join(dir, "seo-autopilot.config.json"), "utf8"));
  for (const k of schema.required) assert.ok(k in cfg);
  const site = cfg.sites[0], props = schema.properties.sites.items.properties;
  for (const k of schema.properties.sites.items.required) assert.ok(k in site, k);
  for (const k of Object.keys(site)) assert.ok(k in props, `schema does not know site.${k}`);
  assert.match(site.url, new RegExp(props.url.pattern));
});
