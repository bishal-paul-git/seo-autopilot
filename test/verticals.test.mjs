// Vertical packs: detection from the site profile, the `verticals` override, routing to every pack agent, and installing
// only the packs a project uses. The pack list, the config check and the schema must agree.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectVerticals, PACKS, packAgents, packsToInstall, ALL_PACK_AGENTS } from "../src/analysis/verticals.mjs";
import { routeAgents } from "../src/analysis/agent-router.mjs";
import { listAgents } from "../src/core/agents.mjs";
import { exportKnowledge } from "../src/cli/init.mjs";
import { loadConfig } from "../src/core/config.mjs";

const dentist = { mode: "edit", platform: { name: "WordPress" }, signals: { structuredData: ["Dentist", "WebSite"] } };
const shop = { mode: "advise", platform: { name: "Shopify" }, signals: { structuredData: ["Product"] } };
const blog = { mode: "edit", platform: { name: "Hugo" }, signals: { structuredData: ["Article", "Organization"] } };

test("pack agents exist in departments/verticals, and every vertical agent belongs to a pack", () => {
  const verticals = listAgents().filter((a) => a.department === "verticals").map((a) => a.name).sort();
  assert.deepEqual([...ALL_PACK_AGENTS].sort(), verticals);
  for (const p of Object.values(PACKS)) for (const ask of Object.values(p.agents)) assert.match(ask, /^Use the seo-/);
});

test("detection: local from business markup or config, e-commerce from platform or product markup, nothing for a blog", () => {
  assert.deepEqual(detectVerticals({ profile: dentist }).map((p) => p.pack), ["local"]);
  assert.deepEqual(detectVerticals({ profile: shop }).map((p) => p.pack), ["ecommerce"]);
  assert.match(detectVerticals({ profile: shop })[0].why.join(), /Shopify/);
  assert.deepEqual(detectVerticals({ profile: blog }), []);
  assert.deepEqual(detectVerticals({ profile: blog, site: { local: true } }).map((p) => p.pack), ["local"]);
  assert.deepEqual(detectVerticals({ profile: null }), [], "no profile yet, nothing assumed");
});

test("the config setting wins: a list forces packs on, [] turns them off, unknown names are ignored", () => {
  assert.deepEqual(detectVerticals({ profile: blog, site: { verticals: ["ecommerce"] } }).map((p) => p.pack), ["ecommerce"]);
  assert.deepEqual(detectVerticals({ profile: dentist, site: { verticals: [] } }), []);
  assert.deepEqual(detectVerticals({ site: { verticals: ["local", "nope"] } }).map((p) => p.pack), ["local"]);
});

test("routing: every agent of a detected pack gets a step with the evidence; other packs' agents get none", () => {
  const local = routeAgents({ profile: dentist }).steps.map((s) => s.agent);
  for (const a of packAgents(["local"])) assert.ok(local.includes(a), a);
  assert.ok(!local.includes("seo-ecommerce"));
  const store = routeAgents({ profile: shop });
  const step = store.steps.find((s) => s.agent === "seo-ecommerce");
  assert.match(step.why, /Online shop pack: runs on Shopify/);
  assert.match(step.prompt, /advise mode/, "advise-mode sites get recommendations, not edits");
  assert.ok(!store.steps.some((s) => ALL_PACK_AGENTS.has(s.agent) && s.agent !== "seo-ecommerce"));
  assert.ok(!routeAgents({ profile: blog }).steps.some((s) => ALL_PACK_AGENTS.has(s.agent)));
});

test("install: only the packs a project uses once every site sets verticals; all of them until then", () => {
  assert.deepEqual(packsToInstall([{ id: "a" }]).sort(), Object.keys(PACKS).sort());
  assert.deepEqual(packsToInstall([{ verticals: ["local"] }, { verticals: [] }]), ["local"]);
  assert.deepEqual(packsToInstall([{ verticals: ["local"] }, { id: "b" }]).sort(), Object.keys(PACKS).sort());
  const dir = mkdtempSync(join(tmpdir(), "seo-packs-"));
  const report = exportKnowledge({ cwd: dir, dataDir: "d", sites: [{ verticals: ["ecommerce"] }] });
  const installed = readdirSync(join(dir, "d", "agents")).map((f) => f.slice(0, -3));
  assert.ok(installed.includes("seo-ecommerce") && installed.includes("seo-strategist"));
  assert.ok(!installed.some((a) => a.startsWith("seo-local-")), "no local agents for a shop");
  assert.ok(report.some((l) => /skipped  seo-local-agent/.test(l)));
});

test("config: verticals is validated, and the schema lists exactly the packs", () => {
  const schema = JSON.parse(readFileSync(new URL("../schema/seo-autopilot.config.schema.json", import.meta.url), "utf8"));
  const find = (o) => (o && typeof o === "object" ? (o.verticals || Object.values(o).map(find).find(Boolean)) : null);
  assert.deepEqual(find(schema).items.enum.sort(), Object.keys(PACKS).sort());
  const src = readFileSync(new URL("../src/core/config.mjs", import.meta.url), "utf8");
  assert.match(src, new RegExp(`\\[${Object.keys(PACKS).map((p) => `"${p}"`).join(", ")}\\]\\.includes\\(v\\)`), "config.mjs checks the same pack names");
  assert.equal(typeof loadConfig, "function");
});
