// Operations page in real Chromium against a stand-in for Supabase: an agency member sees their own websites at a
// glance (and never the platform scheduler); a platform admin also sees scheduler health and can pause it with a
// reason. Text from sites and errors is escaped; fits a phone. Skipped when Playwright is not installed.
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

const OVERVIEW = [
  { id: "s1", name: "Plumber <b>Co</b>", url: "https://plumber.test/", status: "live", strategy: "approved", waiting: 2, escalated: 1, active: 1, requests: 3, spendToday: 0.1, spendMonth: 2.5, lastPlanned: new Date(Date.now() - 30 * 60000).toISOString(), lastError: null },
  { id: "s2", name: "Bakery", url: "https://bakery.test/", status: "paused", strategy: null, waiting: 0, escalated: 0, active: 0, requests: 0, spendToday: 0, spendMonth: 0, lastPlanned: null, lastError: '<img src=x onerror="window.__pwned=1">scan failed' },
];
const HEALTH = { control: { paused: false, reason: null }, usage: { runs: 96, invocations: 340, subrequests: 1800, jobsRun: 40, jobsRecovered: 1, runsWithErrors: 2 }, runs: [{ id: 1, runner: "cloudflare-cron", started_at: "2026-11-08T01:00:00Z", sites_planned: 5, jobs_run: 3, invocations: 9, subrequests: 60, errors: ["plan: timeout"], paused: false }], lastRunAt: new Date().toISOString(), sites: 2, pausedSites: 1 };

const GSC = [
  { id: "s1", name: "Plumber", url: "https://plumber.test/", status: "live", allowed: false, conflict: false, agency: "Agency A" },
  { id: "s2", name: "Bakery", url: "https://bakery.test/", status: "paused", allowed: true, allowedAt: "2026-11-10T09:00:00Z", conflict: false, agency: "Agency A" },
  { id: "s3", name: "Copycat", url: "https://plumber.test/", status: "live", allowed: false, conflict: true, agency: "Agency B" },
];
function fake(admin) {
  const calls = [], html = { body: "" };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "jwt", refresh_token: "r", expires_in: 3600, user: { email: "a@x.test" } });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop(), b = JSON.parse(body || "{}"); calls.push({ fn, b });
      if (fn === "my_sites") return send(200, []);
      if (fn === "my_org") return send(200, { id: "org-a", name: "Agency A", role: "owner" });
      if (fn === "client_sites") return send(200, []);
      if (fn === "agency_overview") return send(200, OVERVIEW);
      if (fn === "platform_health") return admin ? send(200, HEALTH) : send(400, { message: "not allowed" });
      if (fn === "set_platform_paused") return admin ? send(200, { paused: b.p_paused }) : send(400, { message: "not allowed" });
      if (fn === "gsc_sites") return admin ? send(200, GSC) : send(400, { message: "not allowed" });
      if (fn === "set_gsc_allowed") return admin ? send(200, { site: b.p_site, allowed: b.p_allowed }) : send(400, { message: "not allowed" });
    }
    send(404, { message: "not found" });
  });
  return { server, calls, html };
}
async function open(t, admin) {
  const f = fake(admin);
  await new Promise((r) => f.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${f.server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-ops-"));
  build({ url: base, key: "sb_publishable_test", out }); f.html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); f.server.close(); });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept("planned maintenance"));
  await page.goto(`${base}/#/login`); await page.fill("input[name=email]", "a@x.test"); await page.fill("input[name=password]", "correct-horse-battery"); await page.click("button[type=submit]");
  await page.waitForSelector("#rail nav"); await page.goto(`${base}/#/ops`); await page.waitForSelector("h1:has-text('Operations')");
  return { page, calls: f.calls, errors };
}

test("agency member: own websites at a glance, never the platform scheduler", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, errors } = await open(t, false);
  const text = await page.textContent("#page");
  for (const s of ["2 waiting", "3 requests", "1 stuck", "Strategy approved", "No strategy yet", "paused", "$2.50", "planned 30 min ago", "planned never"]) assert.ok(text.includes(s), `shows: ${s}`);
  assert.ok(text.includes("Plumber <b>Co</b>") && text.includes('<img src=x onerror="window.__pwned=1">scan failed'), "names and errors shown as text");
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator("#page img, #page b:has-text('Co')").count(), 0);
  assert.ok(!text.includes("Scheduler (platform)"), "no platform card for agency members");
  assert.ok(!text.includes("Search Console access"), "no Search Console confirmation for agency members");
  assert.ok((await page.textContent("#rail")).includes("Operations"));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "fits a phone");
  assert.deepEqual(errors, []);
});

test("platform admin: scheduler health, usage against the free tier, pause with a reason", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, calls, errors } = await open(t, true);
  const text = await page.textContent("#page");
  for (const s of ["Scheduler (platform)", "Running", "0.34% of the 100,000 a day", "2 with errors"]) assert.ok(text.includes(s), `shows: ${s}`);
  await page.click("summary:has-text('Recent runs')");
  assert.ok((await page.textContent("#page")).includes("plan: timeout"));
  await page.click("#ops-pause");
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Paused"));
  assert.deepEqual(calls.find((c) => c.fn === "set_platform_paused").b, { p_paused: true, p_reason: "planned maintenance" });
  assert.deepEqual(errors, []);
});

test("platform admin: confirms or revokes Search Console per website; a domain in two agencies cannot be confirmed", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, calls, errors } = await open(t, true);
  const card = await page.textContent('.card:has(h2:has-text("Search Console access"))');
  assert.match(card, /Plumber[\s\S]*Not confirmed[\s\S]*Bakery[\s\S]*Confirmed 2026-11-10[\s\S]*Copycat[\s\S]*Also registered in another agency/);
  assert.equal(await page.locator('[data-gsc="s3"]').count(), 0, "no button for a domain registered in another agency");
  await page.click('[data-gsc="s1"]');
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Confirmed"));
  assert.deepEqual(calls.find((c) => c.fn === "set_gsc_allowed").b, { p_site: "s1", p_allowed: true });
  await page.click('[data-gsc="s2"]');
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Revoked"));
  assert.deepEqual(calls.filter((c) => c.fn === "set_gsc_allowed").at(-1).b, { p_site: "s2", p_allowed: false });
  assert.deepEqual(errors, []);
});
