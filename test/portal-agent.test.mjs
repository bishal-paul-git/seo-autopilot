// Agent pages (D46) in real Chromium: the SEO team page links every specialist; its page shows its instructions, the
// playbooks and skills it reads (with sources and review date), and its record on this site from agent_runs, with
// every review verdict and the agency's decision. Agent output is shown as text only. Agency only. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, agentCatalog } from "../cloud/portal/build.mjs";

let playwright = null;
for (const from of [import.meta.url, join(process.cwd(), "package.json")]) { try { playwright = createRequire(from)("playwright"); break; } catch { /* not installed */ } }

const SITE = { id: "11111111-1111-4111-8111-111111111111", name: "Plumber", url: "https://plumber.test/", status: "live", mode: "url", last_snapshot_at: "2026-11-12T00:00:00Z" };
const STATS = [{ agent: "seo-content-pruner", runs: 2, completed: 1, waiting: 1, active: 0, stopped: 0, lastAt: new Date().toISOString(), costMonth: 0.31, reviews: 3, reviewsPassed: 2 }];
const RUNS = [
  { job: "j2", title: "Prune thin pages", status: "awaiting_approval", risk: "high", createdAt: "2026-11-13T02:00:00Z", costUsd: 0.21, summary: "Keep 30 pages; refresh 4.", titles: ["Refresh /old-post", "<img src=x onerror=window.__pwned=1>"],
    knowledge: ["knowledge/refreshing-and-pruning-content.md", "knowledge/cannibalization-and-consolidation.md"], evidence: ["read: knowledge/refreshing-and-pruning-content.md", "model claude-opus-5-5, $0.1500"],
    reviews: [{ reviewer: "quality-gate@1", verdict: "pass" }, { reviewer: "seo-fact-checker", verdict: "needs_changes", rationale: "Traffic grew 340%: not in the site data" }], decision: null, lastNote: "reviewed; waiting for the agency" },
  { job: "j1", title: "First look", status: "completed", risk: "low", createdAt: "2026-11-12T19:45:00Z", costUsd: 0.1, summary: "", titles: [], knowledge: [], evidence: [], reviews: [], decision: { decision: "approve", note: "go" } },
];

test("catalog: every agent with its instructions and the files it reads, each file with its metadata", () => {
  const c = agentCatalog();
  assert.equal(Object.keys(c.agents).length, 38);
  const p = c.agents["seo-content-pruner"];
  assert.equal(p.department, "content"); assert.match(p.text, /## Mission/); assert.ok(!p.text.startsWith("---"));
  assert.equal(p.playbooks[0], "knowledge/refreshing-and-pruning-content.md");
  for (const a of Object.values(c.agents)) for (const f of [...a.playbooks, ...a.skills]) assert.ok(c.files[f]?.words > 0, `${f} has metadata`);
  assert.equal(c.files["knowledge/keyword-research-and-clustering.md"].sources, true, "a playbook with a Sources section is marked");
});

test("SEO team → agent page: instructions, playbooks, record on this site, verdicts; output stays text", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const html = { body: "" }, calls = [];
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "jwt", refresh_token: "r", expires_in: 3600, user: { email: "a@x.test" } });
    const fn = u.pathname.split("/").pop(); calls.push({ fn, b: JSON.parse(body || "{}") });
    if (fn === "my_sites") return send(200, [{ site: SITE, data: {}, decisions: [] }]);
    if (fn === "my_org") return send(200, { id: "org-a", name: "Agency A", role: "owner" });
    if (fn === "site_workforce") return send(200, [{ kind: "agent:seo-content-pruner", total: 2, completed: 1, waiting: 1, active: 0, stopped: 0 }]);
    if (fn === "site_agent_stats") return send(200, STATS);
    if (fn === "agent_runs") return send(200, RUNS);
    send(200, []);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-agent-"));
  build({ url: base, key: "sb_publishable_test", out }); html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); server.close(); });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/#/login`); await page.fill("input[name=email]", "a@x.test"); await page.fill("input[name=password]", "correct-horse-battery");
  await page.click("button[type=submit]"); await page.waitForSelector("#rail nav");
  await page.goto(`${base}/#/s/${SITE.id}/team`); await page.waitForSelector("h2:has-text('Specialists on this site')");
  assert.match(await page.textContent("#page"), /content pruner[\s\S]*2 runs · 1 done · 1 waiting for you[\s\S]*\$0\.31 this month[\s\S]*2\/3 reviews passed/);
  assert.ok(await page.locator(`a.chip[href$="/agent/seo-link-builder"]`).count() >= 1, "every specialist links to its page");
  await page.click('a.row[href$="/agent/seo-content-pruner"]');
  await page.waitForSelector("h1:has-text('content pruner')");
  assert.match(page.url(), /\/agent\/seo-content-pruner$/);
  const call = calls.find((c) => c.fn === "agent_runs");
  assert.equal(call.b.p_site, SITE.id); assert.equal(call.b.p_agent, "seo-content-pruner");
  const text = await page.textContent("#page");
  assert.match(text, /What it reads before every run[\s\S]*knowledge\/refreshing-and-pruning-content\.md[\s\S]*words/);
  assert.match(text, /No sources yet/); assert.match(text, /Review date not set/);
  assert.match(text, /Exam score[\s\S]*Not examined yet/);
  assert.match(text, /Its instructions[\s\S]*Mission/);
  assert.match(text, /Spent on these runs\$0\.31/); assert.match(text, /Reviews passed1\/2/);
  await page.click("summary:has-text('Prune thin pages')");
  const run = await page.textContent("details:has-text('Prune thin pages')");
  assert.match(run, /passed Quality gate \(automatic checks\)/);
  assert.match(run, /sent back Fact-checker \(second opinion\): Traffic grew 340%: not in the site data/);
  assert.match(run, /Read: knowledge\/refreshing-and-pruning-content\.md, knowledge\/cannibalization-and-consolidation\.md/);
  assert.match(run, /<img src=x onerror=window.__pwned=1>/, "agent output shown as text");
  assert.equal(await page.evaluate(() => window.__pwned), undefined, "and never run");
  await page.click("summary:has-text('First look')");
  assert.match(await page.textContent("details:has-text('First look')"), /Your decision: approve \(go\)[\s\S]*runs before 12 Nov 2026 did not get them/);
  // An unknown agent name: a plain message, no call.
  const before = calls.filter((c) => c.fn === "agent_runs").length;
  await page.goto(`${base}/#/s/${SITE.id}/agent/seo-nobody`); await page.waitForSelector("text=There is no agent called seo-nobody");
  assert.equal(calls.filter((c) => c.fn === "agent_runs").length, before);
  assert.deepEqual(errors, []);
});
