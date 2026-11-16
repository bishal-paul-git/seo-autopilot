// Automatic Google linking in the portal (D61), in real Chromium against stand-ins for Supabase and the Worker: the
// Connections step shows "Linked automatically" with the property and a Change button, or "Add our email in Search
// Console" with the email, Copy and the steps, or "Pick a property" with the reason; the Portfolio shows each website's
// state and a banner while any live website has no Google data. Text from sites is escaped. Skipped without Playwright.
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

const EMAIL = "seo-reader@proj.iam.gserviceaccount.com", now = () => new Date().toISOString();
const SITES = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Plumber", url: "https://plumber.test/" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Bakery <i>", url: "https://bakery.test/" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Slate", url: "https://slate.test/" },
  { id: "44444444-4444-4444-8444-444444444444", name: "Old shop", url: "https://old.test/" },
];
const LINK = {
  [SITES[0].id]: { state: "linked", via: "auto", gscProperty: "sc-domain:plumber.test", ga4Property: "properties/2", ga4Name: "Plumber web", hasData: true },
  [SITES[1].id]: { state: "add_email", reason: "We cannot see bakery.test in Search Console yet: add our email as a user of the property.", hasData: false },
  [SITES[2].id]: { state: "pick", reason: "Several Search Console properties could belong to slate.test (https://slate.test/, https://slate.test/blog/): pick the right one.", hasData: false },
  [SITES[3].id]: { state: "add_email", reason: null, hasData: false },
};
const GOOGLE = (id) => {
  const L = LINK[id];
  return { role: "agency", canManage: true, gscProperty: L.gscProperty || null, ga4Property: L.ga4Property || null, ga4Name: L.ga4Name || null, status: L.gscProperty ? "connected" : "unconnected", link: L, suggested: null,
    choices: L.state === "pick" ? { sites: [{ url: "https://slate.test/", taken: false }, { url: "https://slate.test/blog/", taken: false }], ga4: [], checkedAt: now() } : L.state === "linked" ? { sites: [{ url: "sc-domain:plumber.test", taken: false }], ga4: [{ id: "properties/2", name: "Plumber web", taken: false }], checkedAt: now() } : { sites: [], ga4: [], checkedAt: null } };
};
const PIPE = (s) => ({ site: { id: s.id, name: s.name, url: s.url, status: "live", repo: null }, agency: true,
  schedule: { everyMinutes: 15, lastRun: now(), paused: false, lastPlanned: now(), nextPlan: now(), strategy: "approved", budgetUsd: 2, spentTodayUsd: 0 },
  connections: [{ key: "scan", name: "Website scan", state: "connected", detail: "Reads every page", at: now() }], counts: { active: 0, waiting: 0, stopped: 0, done30: 0, reviews30: 0, passed30: 0 }, agents: [], live: [], events: [] });
const ROW = (s, status = "live") => ({ site: s.id, name: s.name, url: s.url, agency: "Agency A", status, clicks28: null, clicksChange: null, notIndexed: null, inspected: 0, stale: [], alerts: 0, escalated: 0, waiting: 0, spend7Usd: 0, scorecard: {}, attention: 0, reasons: [] });

async function open(t) {
  const html = { body: "" }, calls = [];
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") return send(204, {});
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "jwt", refresh_token: "r", expires_in: 3600, user: { email: "a@x.test" } });
    if (u.pathname === "/google/account") return send(200, { ok: true, email: EMAIL });
    const fn = u.pathname.split("/").pop(), b = JSON.parse(body || "{}"); calls.push({ fn, b });
    if (fn === "my_sites") return send(200, SITES.map((s) => ({ site: { ...s, status: "live", mode: "url", repo: null, last_snapshot_at: now() }, data: null, decisions: [] })));
    if (fn === "my_org") return send(200, { id: "org-a", name: "Agency A", role: "owner" });
    if (fn === "client_sites") return send(200, []);
    if (fn === "my_notifications") return send(200, { items: [], unread: 0 });
    if (fn === "site_pipeline") return send(200, PIPE(SITES.find((s) => s.id === b.p_site)));
    if (fn === "site_google") return send(200, GOOGLE(b.p_site));
    if (fn === "portfolio") return send(200, { sites: SITES.map((s, i) => ROW(s, i === 3 ? "paused" : "live")) });
    if (fn === "portfolio_google") return send(200, SITES.map((s, i) => ({ site: s.id, name: s.name, url: s.url, status: i === 3 ? "paused" : "live", link: LINK[s.id] })));
    send(200, null);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-autolink-"));
  build({ url: base, key: "sb_publishable_test", workerUrl: base, out }); html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); server.close(); });
  const context = await browser.newContext(); await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/#/login`); await page.fill("input[name=email]", "a@x.test"); await page.fill("input[name=password]", "correct-horse-battery");
  await page.click("button[type=submit]"); await page.waitForSelector("#rail nav");
  return { page, calls, errors, base };
}

test("Connections: linked automatically, add our email, or pick a property with the reason", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, errors, base } = await open(t);
  await page.goto(`${base}/#/s/${SITES[0].id}/connections`); await page.waitForSelector("#setup .glink");
  const linked = await page.textContent("#setup");
  assert.match(linked, /Linked automatically\s*Search Console: plumber\.test \(whole domain\) · Analytics: Plumber web/);
  assert.equal(await page.locator("#g-email").count(), 0, "linked: no email or pickers until Change");
  await page.click('[data-gact="change"]'); await page.waitForSelector("#g-gsc");
  assert.ok(await page.locator('[data-gact="check"]').count() && await page.locator('[data-gact="save"]').count(), "Change opens Check access and the pickers");

  await page.goto(`${base}/#/s/${SITES[1].id}/connections`); await page.waitForSelector("#g-email");
  const add = await page.textContent("#setup");
  assert.match(add, /Add our email in Search Console\s*We cannot see bakery\.test in Search Console yet/);
  assert.match(add, /Users and permissions › Add user[\s\S]*Restricted/);
  assert.equal(await page.textContent("#g-email"), EMAIL);
  await page.click('#setup [data-gact="copy"]');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), EMAIL);

  await page.goto(`${base}/#/s/${SITES[2].id}/connections`); await page.waitForSelector("#g-gsc");
  assert.match(await page.textContent("#setup"), /Pick a property\s*Several Search Console properties could belong to slate\.test/);
  assert.deepEqual(errors, []);
});

test("Portfolio: each website's Google state, and a banner while a live website has no Google data", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, errors } = await open(t);
  await page.waitForSelector("#pf-google");
  const banner = await page.textContent("#pf-google");
  assert.match(banner, /2 live websites have no Google data yet/, "the paused one is not counted; the linked one has data");
  assert.match(banner, new RegExp(EMAIL.replace(/\./g, "\\.")));
  assert.match(banner, /Bakery <i>[\s\S]*add our email in Search Console[\s\S]*Slate[\s\S]*pick a property: Several Search Console properties/);
  assert.ok(!banner.includes("Old shop") && !banner.includes("Plumber"));
  await page.click('#pf-google [data-gact="copy"]');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), EMAIL);
  const table = await page.textContent(".pf-table");
  assert.match(table, /Plumber[\s\S]*Linked automatically[\s\S]*Bakery <i>[\s\S]*Add our email in Search Console[\s\S]*Slate[\s\S]*Pick a property/);
  assert.equal(await page.locator(`.pf-table a.pill[href="#/s/${SITES[2].id}/connections"]`).count(), 1, "the state links to Connections");
  assert.deepEqual(errors, []);
});
