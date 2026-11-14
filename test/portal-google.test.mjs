// Give us read access in the portal (D56), in real Chromium: the three set-up steps on Connections, the service account's
// address with Copy, Check access through the Worker (signed-in user's token), the pickers with properties used by
// another website disabled, save and remove through bind_google, a refused binding shown plainly, picks kept across the
// automatic refresh, the developer guide under Advanced, and clients. The test server stands in for Supabase and the Worker.
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

const SITE = { id: "11111111-1111-4111-8111-111111111111", name: "Plumber", url: "https://plumber.test/", status: "live", mode: "url", repo: null, last_snapshot_at: "2026-11-12T00:00:00Z" };
const EMAIL = "seo-reader@proj.iam.gserviceaccount.com", now = () => new Date().toISOString();
const PIPE = (agency) => ({ site: { id: SITE.id, name: "Plumber", url: SITE.url, status: "live", repo: null }, agency,
  schedule: { everyMinutes: 15, lastRun: now(), paused: false, lastPlanned: now(), nextPlan: now(), strategy: "approved", budgetUsd: agency ? 2 : null, spentTodayUsd: agency ? 0 : null },
  connections: [{ key: "scan", name: "Website scan", state: "connected", detail: "Reads every page", at: now() }, { key: "github", name: "Daily SEO run (GitHub)", state: "off", detail: "Not used for this website", at: null },
    { key: "search_console", name: "Google Search Console", state: "missing", detail: "Not connected yet", at: null }],
  counts: { active: 0, waiting: 0, stopped: 0, done30: 0, reviews30: 0, passed30: 0 }, agents: [], live: [], events: [] });
const CHOICES = { sites: [{ url: "https://plumber.test/", level: "siteRestrictedUser", taken: false }, { url: "sc-domain:plumber.test", level: "siteOwner", taken: false }],
  ga4: [{ id: "properties/1", name: "Old plumber", account: "Plumber Ltd", taken: true }, { id: "properties/2", name: "Plumber website", account: "Plumber Ltd", taken: false }], checkedAt: null };
const EMPTY = (role) => ({ role, canManage: true, gscProperty: null, ga4Property: null, choices: { sites: [], ga4: [], checkedAt: null }, suggested: null, status: "unconnected" });

async function harness(t, { client = false, worker = true, google = null } = {}) {
  const html = { body: "" }, calls = [], G = { v: google || EMPTY(client ? "client" : "agency") };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") return send(204, {});
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "jwt", refresh_token: "r", expires_in: 3600, user: { email: "a@x.test" } });
    // The Worker's routes.
    if (u.pathname === "/google/account") { calls.push({ fn: "worker:account" }); return send(200, { ok: true, email: EMAIL }); }
    if (u.pathname === "/google/check") { calls.push({ fn: "worker:check", b: JSON.parse(body || "{}"), auth: req.headers.authorization }); G.v = { ...G.v, choices: { ...CHOICES, checkedAt: now() }, suggested: "sc-domain:plumber.test" }; return send(200, { ok: true, email: EMAIL, sites: CHOICES.sites, ga4: CHOICES.ga4, errors: [] }); }
    const fn = u.pathname.split("/").pop(); calls.push({ fn, b: JSON.parse(body || "{}") });
    if (fn === "my_sites") return send(200, client ? [] : [{ site: SITE, data: {}, decisions: [] }]);
    if (fn === "client_sites") return send(200, client ? [{ site: SITE, data: {}, brand: null }] : []);
    if (fn === "my_org") return send(200, client ? null : { id: "org-a", name: "Agency A", role: "owner" });
    if (fn === "site_pipeline") return send(200, PIPE(!client));
    if (fn === "site_google") return send(200, G.v);
    if (fn === "bind_google") {
      const b = JSON.parse(body);
      if (b.p_gsc === "https://plumber.test/") return send(200, { ok: false, error: "That property is already connected to another website. The platform admin has been told." });
      G.v = { ...G.v, gscProperty: b.p_gsc, ga4Property: b.p_ga4, ga4Name: b.p_ga4 ? "Plumber website" : null, status: b.p_gsc || b.p_ga4 ? "connected" : "unconnected" }; return send(200, { ok: true, ...G.v });
    }
    send(200, []);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-google-"));
  build({ url: base, key: "sb_publishable_test", workerUrl: worker ? base : "", out }); html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); server.close(); });
  const context = await browser.newContext(); await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => { window.__PIPE_MS = 400; });
  await page.goto(`${base}/#/login`); await page.fill("input[name=email]", "a@x.test"); await page.fill("input[name=password]", "correct-horse-battery");
  await page.click("button[type=submit]"); await page.waitForSelector("#rail nav");
  return { page, calls, errors, base, G };
}

test("agency: the address to add with Copy, Check access, pickers (used ones disabled), a refusal, save, remove", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, calls, errors, base } = await harness(t);
  await page.goto(`${base}/#/s/${SITE.id}/connections`); await page.waitForSelector("#g-email");
  const setup = await page.textContent("#setup");
  assert.match(setup, /Set up\s*1 of 3/); assert.match(setup, /Give us read access/); assert.match(setup, /no key or file is needed/);
  assert.match(setup, /Users and permissions › Add user[\s\S]*Restricted[\s\S]*Property access management[\s\S]*Viewer/);
  assert.equal(await page.textContent("#g-email"), EMAIL);
  assert.ok(await page.locator('a[href="https://search.google.com/search-console"]').count() && await page.locator('a[href="https://analytics.google.com/"]').count());
  assert.equal(await page.locator("#g-gsc").count(), 0, "no pickers before a check");
  assert.match(await page.textContent("details#adv"), /Advanced: connect a GitHub run[\s\S]*GOOGLE_KEY_JSON/);
  assert.equal(await page.locator("details#adv[open]").count(), 0);
  await page.click('[data-gact="copy"]');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), EMAIL);
  await page.click('[data-gact="check"]'); await page.waitForSelector("#g-gsc");
  const check = calls.find((c) => c.fn === "worker:check");
  assert.deepEqual(check.b, { site: SITE.id }); assert.equal(check.auth, "Bearer jwt", "the Worker gets the signed-in user's token");
  assert.equal(await page.inputValue("#g-gsc"), "sc-domain:plumber.test", "the domain property is suggested");
  assert.equal(await page.inputValue("#g-ga4"), "properties/2", "the free GA4 property named like the site");
  assert.ok(await page.locator('#g-ga4 option[value="properties/1"][disabled]').count(), "a property used by another website cannot be picked");
  await page.selectOption("#g-gsc", "https://plumber.test/");
  await page.waitForFunction(() => (window.__r = (window.__r || 0) + 1) > 4, null, { polling: 300 });
  assert.equal(await page.inputValue("#g-gsc"), "https://plumber.test/", "a pick survives the automatic refresh");
  await page.click('[data-gact="save"]');
  await page.waitForFunction(() => /already connected to another website/.test(document.querySelector(".toast")?.textContent || ""));
  await page.selectOption("#g-gsc", "sc-domain:plumber.test");
  await page.click('[data-gact="save"]');
  await page.waitForFunction(() => /Set up\s*2 of 3/.test(document.querySelector("#setup")?.textContent || ""));
  assert.match(await page.textContent("#setup"), /Connected Search Console: plumber\.test \(whole domain\) · Analytics: Plumber website/);
  assert.deepEqual(calls.filter((c) => c.fn === "bind_google").at(-1).b, { p_site: SITE.id, p_gsc: "sc-domain:plumber.test", p_ga4: "properties/2" });
  await page.click('[data-gact="remove"]');
  await page.waitForFunction(() => /Set up\s*1 of 3/.test(document.querySelector("#setup")?.textContent || ""));
  assert.deepEqual(calls.filter((c) => c.fn === "bind_google").at(-1).b, { p_site: SITE.id, p_gsc: null, p_ga4: null });
  assert.deepEqual(errors, []);
});

test("without a Worker the step says it is not set up; no Google calls", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, calls, base } = await harness(t, { worker: false });
  await page.goto(`${base}/#/s/${SITE.id}/connections`); await page.waitForSelector("#setup");
  assert.match(await page.textContent("#setup"), /Read access is not set up on this portal yet/);
  assert.equal(await page.locator('[data-gact="check"]').count(), 0);
  assert.ok(!calls.some((c) => c.fn.startsWith("worker:")));
});

test("client: sees the connected properties and can check and pick for their own site; no developer guide", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const done = { ...EMPTY("client"), gscProperty: "sc-domain:plumber.test", ga4Property: "properties/2", ga4Name: "Plumber website", status: "connected" };
  const one = await harness(t, { client: true, google: done });
  await one.page.goto(`${one.base}/#/k/${SITE.id}/connections`); await one.page.waitForSelector("#setup");
  assert.match(await one.page.textContent("#setup"), /Set up\s*2 of 3[\s\S]*plumber\.test \(whole domain\)[\s\S]*Plumber website/);
  assert.equal(await one.page.locator("details#adv").count(), 0, "no developer guide for clients");
  await one.page.click('[data-gact="check"]'); await one.page.waitForSelector("#g-gsc");
  assert.ok(one.calls.some((c) => c.fn === "worker:check"));
  assert.deepEqual(one.errors, []);
});
