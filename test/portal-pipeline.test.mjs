// Live pipeline and connections pages (D54) in real Chromium: stations with their state, the specialists and the live
// feed from site_pipeline, a station's details on click, the connections with setup hints for the agency, refresh by
// itself, and the client view (no money, no repository, no setup hints). Never on anonymous share links. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../cloud/portal/build.mjs";

let playwright = null;
for (const from of [import.meta.url, join(process.cwd(), "package.json")]) { try { playwright = createRequire(from)("playwright"); break; } catch { /* not installed */ } }

const SITE = { id: "11111111-1111-4111-8111-111111111111", name: "Plumber", url: "https://plumber.test/", status: "live", mode: "github", repo: "acme/plumber", last_snapshot_at: "2026-11-12T00:00:00Z" };
const now = () => new Date().toISOString();
const PIPE = (agency, extra = {}) => ({
  site: { id: SITE.id, name: "Plumber", url: SITE.url, status: "live", repo: agency ? "acme/plumber" : null }, agency,
  schedule: { everyMinutes: 15, lastRun: now(), paused: false, lastPlanned: now(), nextPlan: new Date(Date.now() + 3 * 3600e3).toISOString(), strategy: "approved", budgetUsd: agency ? 2 : null, spentTodayUsd: agency ? 0.4 : null },
  connections: [
    { key: "scan", name: "Website scan", state: "connected", detail: "Reads every page", at: now() },
    { key: "github", name: "Daily SEO run (GitHub)", state: "missing", detail: agency ? "Add SEO_PORTAL_URL and SEO_PORTAL_TOKEN to acme/plumber (Connection page)" : "Your SEO team is connecting it", at: null },
    { key: "search_console", name: "Google Search Console", state: "error", detail: agency ? "No access to plumber.test" : "Waiting for access", at: null },
    { key: "agents", name: "AI specialists", state: "connected", detail: "The SEO director plans every few hours", at: now() },
  ],
  counts: { active: 1, waiting: 2, stopped: 1, done30: 7, reviews30: 6, passed30: 5 },
  agents: [{ agent: "seo-snippet-optimizer", status: "running", title: "Rewrite <b>titles</b>", at: now(), runs30: 3 }, { agent: "seo-reporter", status: "completed", title: "Monthly report", at: now(), runs30: 1 }],
  live: [{ agent: "seo-snippet-optimizer", kind: "agent:seo-snippet-optimizer", title: "Rewrite titles", status: "running", at: now() }, { agent: "seo-content-pruner", kind: "agent:seo-content-pruner", title: "Prune pages", status: "awaiting_approval", at: now() }],
  events: [{ at: now(), agent: "seo-snippet-optimizer", kind: "agent:seo-snippet-optimizer", title: "Rewrite titles", to: "running", note: agency ? "claimed" : null }],
  ...extra,
});

async function harness(t, { client = false } = {}) {
  const html = { body: "" }, calls = [];
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "jwt", refresh_token: "r", expires_in: 3600, user: { email: "a@x.test" } });
    const fn = u.pathname.split("/").pop(); calls.push({ fn, b: JSON.parse(body || "{}") });
    if (fn === "my_sites") return send(200, client ? [] : [{ site: SITE, data: {}, decisions: [] }]);
    if (fn === "client_sites") return send(200, client ? [{ site: SITE, data: {}, brand: { name: "Agency A" } }] : []);
    if (fn === "my_org") return send(200, client ? null : { id: "org-a", name: "Agency A", role: "owner" });
    if (fn === "site_pipeline") return send(200, PIPE(!client, calls.filter((c) => c.fn === "site_pipeline").length > 1 ? { counts: { active: 0, waiting: 0, stopped: 0, done30: 8, reviews30: 6, passed30: 6 } } : {}));
    if (fn === "shared_site") return send(200, { site: SITE, data: { history: [{ day: "2026-11-01" }] }, growth: [], brand: null });
    send(200, []);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-pipe-"));
  build({ url: base, key: "sb_publishable_test", out }); html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); server.close(); });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => { window.__PIPE_MS = 300; });
  await page.goto(`${base}/#/login`); await page.fill("input[name=email]", "a@x.test"); await page.fill("input[name=password]", "correct-horse-battery");
  await page.click("button[type=submit]"); await page.waitForSelector("#rail nav");
  return { page, calls, errors, base };
}

test("agency: live pipeline stations, specialists and feed; details on click; refreshes by itself; connections with setup hints", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, calls, errors, base } = await harness(t);
  await page.goto(`${base}/#/s/${SITE.id}/pipeline`); await page.waitForSelector("h1:has-text('Live pipeline')");
  assert.equal(calls.find((c) => c.fn === "site_pipeline").b.p_site, SITE.id);
  const text = await page.textContent("#page");
  assert.match(text, /Running every 15 min/); assert.match(text, /\$0\.40 of \$2\.00 today/); assert.match(text, /Next plan in 3 h/);
  assert.equal(await page.locator(".pnode").count(), 6);
  assert.match(await page.textContent('[data-node="sources"]'), /2\/4/);
  assert.ok(await page.locator('[data-node="agents"].busy').count(), "specialists busy while one runs");
  assert.ok(await page.locator('[data-node="decisions"].bad').count(), "a stopped job shows red");
  assert.equal(await page.locator(".pflow.on").count(), 5, "work flows between the stations");
  assert.equal(await page.locator("#page b:has-text('titles')").count(), 0, "agent text stays text");
  assert.ok(await page.locator('a.agent-card[href$="/agent/seo-snippet-optimizer"]').count(), "agency opens the agent page");
  await page.click('[data-node="decisions"]'); await page.waitForSelector("#sheet");
  assert.match(await page.textContent("#sheet"), /content pruner[\s\S]*Waiting for a decision/);
  assert.ok(await page.locator('#sheet a[href$="/god"]').count(), "agency decides on the SEO God page");
  await page.click("#sheet-close");
  await page.waitForFunction(() => /0\s*working now/.test(document.querySelector('[data-node="agents"]')?.textContent || ""), null, { timeout: 5000 });
  await page.goto(`${base}/#/s/${SITE.id}/connections`); await page.waitForSelector("h1:has-text('Connections')");
  const conn = await page.textContent("#page");
  assert.match(conn, /2 of 4 connected/); assert.match(conn, /SEO_PORTAL_URL[\s\S]*Connection page/); assert.match(conn, /No access to plumber\.test/);
  assert.ok(await page.locator(".conn.error").count() && await page.locator(".conn.missing").count());
  assert.deepEqual(errors, []);
});

test("client: the same pipeline without money, repository or setup hints; share links never show it", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, errors, base } = await harness(t, { client: true });
  await page.goto(`${base}/#/k/${SITE.id}/pipeline`); await page.waitForSelector("h1:has-text('Live pipeline')");
  const text = await page.textContent("#page");
  assert.doesNotMatch(text, /\$/); assert.match(text, /your SEO team decides/);
  assert.equal(await page.locator("a.agent-card").count(), 0, "no agent pages for clients");
  await page.click('[data-node="decisions"]'); await page.waitForSelector("#sheet");
  assert.equal(await page.locator('#sheet a[href$="/god"]').count(), 0, "no SEO God link for clients");
  await page.click("#sheet-close");
  await page.goto(`${base}/#/k/${SITE.id}/connections`); await page.waitForSelector("h1:has-text('Connections')");
  const conn = await page.textContent("#page");
  assert.match(conn, /Your SEO team manages these/); assert.doesNotMatch(conn, /SEO_PORTAL|acme\/plumber|No access/);
  assert.ok(await page.locator('#rail a[href$="/pipeline"]').count(), "in the client's menu");
  await page.goto(`${base}/#/c/share-token/pipeline`); await page.waitForSelector('#rail a[href^="#/c/share-token/"]');
  assert.doesNotMatch(await page.textContent("#page"), /Live pipeline/, "a share link opens the overview instead");
  assert.equal(await page.locator('#rail a[href$="/pipeline"]').count(), 0, "not on share links");
  assert.deepEqual(errors, []);
});
