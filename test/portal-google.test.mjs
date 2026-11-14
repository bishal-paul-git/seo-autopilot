// Connect with Google in the portal (D56), in real Chromium: the three set-up steps on Connections, the round trip through
// the Worker's /oauth/google/start and back with ?google_state= (confirmed as the signed-in person), the two pickers with
// the site's own property pre-selected, refresh lists and disconnect through the Worker, picks kept across the automatic
// refresh, the developer guide under Advanced, and what clients see. The test server stands in for Supabase and the Worker.
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
const STATE = "d".repeat(64), now = () => new Date().toISOString();
const PIPE = (agency) => ({ site: { id: SITE.id, name: "Plumber", url: SITE.url, status: "live", repo: null }, agency,
  schedule: { everyMinutes: 15, lastRun: now(), paused: false, lastPlanned: now(), nextPlan: now(), strategy: "approved", budgetUsd: agency ? 2 : null, spentTodayUsd: agency ? 0 : null },
  connections: [{ key: "scan", name: "Website scan", state: "connected", detail: "Reads every page", at: now() }, { key: "github", name: "Daily SEO run (GitHub)", state: "off", detail: "Not used for this website", at: null },
    { key: "search_console", name: "Google Search Console", state: "missing", detail: "Not connected yet", at: null }],
  counts: { active: 0, waiting: 0, stopped: 0, done30: 0, reviews30: 0, passed30: 0 }, agents: [], live: [], events: [] });
const CHOICES = { sites: [{ url: "https://bakery.test/", level: "siteOwner" }, { url: "https://plumber.test/", level: "siteFullUser" }, { url: "sc-domain:plumber.test", level: "siteOwner" }],
  ga4: [{ id: "properties/1", name: "Bakery web", account: "Bakery" }, { id: "properties/2", name: "Plumber website", account: "Plumber Ltd" }], errors: [] };
const CONNECTED = { connected: true, status: "connected", email: "owner@plumber.test", mine: true, searchConsole: true, analytics: true, gscProperty: null, ga4Property: null, choices: CHOICES,
  suggested: "sc-domain:plumber.test", canConnect: true, canManage: true, role: "agency" };

async function harness(t, { client = false, worker = true, google = { connected: false, status: "unconnected", canConnect: true, canManage: false, role: client ? "client" : "agency" } } = {}) {
  const html = { body: "" }, calls = [], G = { v: google };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "jwt", refresh_token: "r", expires_in: 3600, user: { email: "a@x.test" } });
    // The Worker's routes (Google itself is not involved: start sends the browser straight back as the callback would).
    if (u.pathname === "/oauth/google/start") { calls.push({ fn: "worker:start", b: { state: u.searchParams.get("state") } }); res.writeHead(302, { Location: `/?google_state=${STATE}` }); return res.end(); }
    if (u.pathname.startsWith("/oauth/google/")) { calls.push({ fn: `worker:${u.pathname.split("/").pop()}`, b: JSON.parse(body || "{}") }); if (u.pathname.endsWith("disconnect")) G.v = { connected: false, status: "revoked", canConnect: true, canManage: false, role: "agency" }; return send(200, u.pathname.endsWith("properties") ? { ok: true, sites: 2, ga4: 2, errors: [] } : { ok: true, revokedAtGoogle: true }); }
    const fn = u.pathname.split("/").pop(); calls.push({ fn, b: JSON.parse(body || "{}") });
    if (fn === "my_sites") return send(200, client ? [] : [{ site: SITE, data: {}, decisions: [] }]);
    if (fn === "client_sites") return send(200, client ? [{ site: SITE, data: {}, brand: null }] : []);
    if (fn === "my_org") return send(200, client ? null : { id: "org-a", name: "Agency A", role: "owner" });
    if (fn === "site_pipeline") return send(200, PIPE(!client));
    if (fn === "site_google") return send(200, G.v);
    if (fn === "google_begin") return send(200, { state: STATE, expiresAt: now() });
    if (fn === "google_confirm") { G.v = { ...CONNECTED, role: client ? "client" : "agency" }; return send(200, { ...G.v, site: SITE.id }); }
    if (fn === "set_google_properties") { const b = JSON.parse(body); G.v = { ...G.v, gscProperty: b.p_gsc, ga4Property: b.p_ga4 }; return send(200, G.v); }
    send(200, []);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-google-"));
  build({ url: base, key: "sb_publishable_test", workerUrl: worker ? base : "", out }); html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); server.close(); });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => { window.__PIPE_MS = 400; });
  await page.goto(`${base}/#/login`); await page.fill("input[name=email]", "a@x.test"); await page.fill("input[name=password]", "correct-horse-battery");
  await page.click("button[type=submit]"); await page.waitForSelector("#rail nav");
  return { page, calls, errors, base, G };
}

test("agency: Connect with Google, back with the state, confirmed, property pickers, save, refresh lists, disconnect", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, calls, errors, base } = await harness(t);
  await page.goto(`${base}/#/s/${SITE.id}/connections`); await page.waitForSelector("#setup");
  const setup = await page.textContent("#setup");
  assert.match(setup, /Set up\s*1 of 3/); assert.match(setup, /Website\s*plumber\.test · scanned/); assert.match(setup, /no key or file is needed/);
  assert.equal(await page.locator("details#adv[open]").count(), 0, "the 7-step developer guide waits under Advanced");
  assert.match(await page.textContent("details#adv"), /Advanced: connect a GitHub run[\s\S]*GOOGLE_KEY_JSON/);
  await page.click('[data-gact="connect"]');
  await page.waitForSelector("#g-gsc");
  assert.equal(calls.find((c) => c.fn === "google_begin").b.p_purpose, "connect");
  assert.equal(calls.find((c) => c.fn === "worker:start").b.state, STATE, "the browser went to the Worker with the state");
  assert.equal(calls.find((c) => c.fn === "google_confirm").b.p_state, STATE, "confirmed as the signed-in person");
  assert.equal(new URL(page.url()).search, "", "the state is removed from the address bar");
  assert.equal(new URL(page.url()).hash, `#/s/${SITE.id}/connections`);
  assert.match(await page.textContent("#setup"), /Connected as owner@plumber\.test/);
  // Only this site's properties are offered; its domain property and the GA4 property named like the site are picked.
  assert.deepEqual(await page.$$eval("#g-gsc option", (o) => o.map((x) => x.value)), ["", "https://plumber.test/", "sc-domain:plumber.test"]);
  assert.equal(await page.inputValue("#g-gsc"), "sc-domain:plumber.test");
  assert.equal(await page.inputValue("#g-ga4"), "properties/2");
  await page.selectOption("#g-gsc", "https://plumber.test/");
  await page.waitForFunction(() => (window.__r = (window.__r || 0) + 1) > 4, null, { polling: 300 }); // a few automatic refreshes
  assert.equal(await page.inputValue("#g-gsc"), "https://plumber.test/", "a pick survives the automatic refresh");
  await page.click('[data-gact="save"]');
  await page.waitForFunction(() => /Set up\s*2 of 3/.test(document.querySelector("#setup")?.textContent || ""));
  assert.deepEqual(calls.find((c) => c.fn === "set_google_properties").b, { p_site: SITE.id, p_gsc: "https://plumber.test/", p_ga4: "properties/2" });
  await page.click('[data-gact="list"]');
  await page.waitForFunction(() => /Lists refreshed: 2 Search Console and 2 Analytics/.test(document.querySelector(".toast")?.textContent || ""));
  assert.equal(calls.find((c) => c.fn === "worker:properties").b.state, STATE);
  await page.click('[data-gact="disconnect"]');
  await page.waitForSelector('[data-gact="connect"]');
  assert.equal(calls.find((c) => c.fn === "worker:disconnect").b.state, STATE);
  assert.ok(!calls.some((c) => c.fn === "disconnect_google"), "revoked through the Worker, no fallback needed");
  assert.deepEqual(errors, []);
});

test("back from Google with a problem: a plain message, nothing connected; without a Worker the button is not offered", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, calls, base } = await harness(t, { worker: false });
  await page.goto(`${base}/?google=denied#/s/${SITE.id}/connections`);
  await page.waitForFunction(() => /sign-in was cancelled/.test(document.querySelector(".toast")?.textContent || ""));
  assert.ok(!calls.some((c) => c.fn === "google_confirm"));
  await page.waitForSelector("#setup");
  assert.match(await page.textContent("#setup"), /not set up on this portal yet/);
  assert.equal(await page.locator('[data-gact="connect"]').count(), 0);
});

test("client: sees the agency's connection without its email or buttons; may connect their own when nothing is connected", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const agencyMade = { connected: true, status: "connected", email: null, mine: false, searchConsole: true, analytics: true, gscProperty: "sc-domain:plumber.test", ga4Property: "properties/2", ga4Name: "Plumber website", choices: null, canConnect: false, canManage: false, role: "client" };
  const one = await harness(t, { client: true, google: agencyMade });
  await one.page.goto(`${one.base}/#/k/${SITE.id}/connections`); await one.page.waitForSelector("#setup");
  const text = await one.page.textContent("#setup");
  assert.match(text, /Connected by your SEO team/); assert.match(text, /plumber\.test \(whole domain\)[\s\S]*Plumber website/);
  assert.equal(await one.page.locator("[data-gact]").count(), 0, "no buttons on the agency's connection");
  assert.equal(await one.page.locator("details#adv").count(), 0, "no developer guide for clients");
  const two = await harness(t, { client: true });
  await two.page.goto(`${two.base}/#/k/${SITE.id}/connections`); await two.page.waitForSelector('[data-gact="connect"]');
  await two.page.click('[data-gact="connect"]');
  await two.page.waitForFunction(() => /Connected as owner@plumber\.test/.test(document.querySelector("#setup")?.textContent || ""));
  assert.ok(two.calls.some((c) => c.fn === "google_confirm"));
  assert.deepEqual([...one.errors, ...two.errors], []);
});
