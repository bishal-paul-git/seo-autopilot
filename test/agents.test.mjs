// The agent files and playbooks are product content: keep them internally consistent.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { RULES } from "../src/audit/rules.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const agentsDir = join(root, "agents"), knowledgeDir = join(root, "knowledge");
const agentFiles = readdirSync(agentsDir).filter((f) => f.startsWith("seo-") && f.endsWith(".md"));

test("eighteen agents exist", () => assert.equal(agentFiles.length, 18));

for (const f of agentFiles) {
  const text = readFileSync(join(agentsDir, f), "utf8");
  test(`${f}: front matter, required sections, and real playbook references`, () => {
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, "front matter");
    assert.equal((fm[1].match(/^name:\s*(.+)$/m) || [])[1], f.replace(/\.md$/, ""));
    assert.ok(/^description:\s*\S/m.test(fm[1]) && /^tools:\s*\S/m.test(fm[1]));
    for (const h of ["## Mission", "## Read first", "## Method", "## Quality bar", "## Never", "## Output"]) assert.ok(text.includes(h), `missing ${h}`);
    for (const m of text.matchAll(/`([a-z0-9-]+\.md)`/g)) {
      const name = m[1];
      if (name === "README.md" || name.startsWith("seo-")) continue;
      assert.ok(existsSync(join(knowledgeDir, name)) || ["priorities.md", "audit.md", "geo.md", "speed.md", "experiments.md", "weekly-digest.md", "daily-summary.md", "news-digest.md"].includes(name), `unknown file referenced: ${name}`);
    }
  });
}

test("only the technical fixer may run arbitrary shell; the others are scoped", () => {
  for (const f of agentFiles) {
    const tools = (readFileSync(join(agentsDir, f), "utf8").match(/^tools:\s*(.+)$/m) || [])[1];
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

test("every agent is described in the agents README", () => {
  const readme = readFileSync(join(agentsDir, "README.md"), "utf8");
  for (const f of agentFiles) assert.ok(readme.includes(`(${f})`));
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
