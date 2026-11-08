// Notifications and the monthly work report (D38) in real Chromium against a stand-in for Supabase: the unread count in
// the menu, the list with links to the right page, marking as seen; the work report on the report page for the agency
// and for a client account, month switching, printing; text from stored data is escaped. No network.
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

const SITE = { id: "11111111-1111-4111-8111-111111111111", name: "Plumber", url: "https://plumber.test/", status: "live", mode: "url", last_snapshot_at: "2026-11-08T00:00:00Z" };
const HOSTILE = '<img src=x onerror="window.__pwned=1">Fix titles';
const NOTES = { seenAt: null, unread: 2, items: [
  { kind: "approval", site: SITE.id, siteName: "Plumber", title: HOSTILE, at: "2026-11-08T09:00:00Z", page: "god", unread: true },
  { kind: "verified", site: SITE.id, siteName: "Plumber", title: "verified: 1 of 1 problems on https://plumber.test/ fixed (title-too-long)", at: "2026-11-08T08:00:00Z", page: "god", unread: true },
  { kind: "request", site: SITE.id, siteName: "Plumber", title: "Rank for boilers", at: "2026-11-07T08:00:00Z", page: "requests", unread: false }] };
const work = (month) => ({ site: { name: "Plumber", url: SITE.url }, brand: { name: "Agency A" }, month, strategy: { approved: true, objective: "More boiler enquiries" },
  advice: month === "2026-11" ? [{ title: HOSTILE, recommendations: [{ title: "Shorten the home page title", url: "https://plumber.test/" }] }] : [],
  changes: month === "2026-11" ? [{ title: "Implement: shorten title", status: "completed", page: "https://plumber.test/", verification: "verified: 1 of 1 problems fixed" }] : [],
  requests: [], audit: { bySeverity: { high: 1, medium: 2 } }, auditBefore: { bySeverity: { high: 3, medium: 4 } } });

function fake({ client = false } = {}) {
  const calls = [], html = { body: "" }, state = { unread: NOTES.unread };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "user-jwt", refresh_token: "r", expires_in: 3600, user: { email: "a@x.test" } });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop(), b = JSON.parse(body || "{}"); calls.push({ fn, b });
      if (fn === "my_sites") return send(200, client ? [] : [{ site: SITE, data: {}, decisions: [] }]);
      if (fn === "my_org") return send(200, client ? null : { id: "org-a", name: "Agency A", role: "owner" });
      if (fn === "client_sites") return send(200, client ? [{ site: SITE, data: {}, brand: { name: "Agency A", color: "#3355cc" } }] : []);
      if (fn === "my_notifications") return send(200, client ? { seenAt: null, unread: 1, items: [{ kind: "answer", site: SITE.id, siteName: "Plumber", title: "Rank for boilers · accepted", at: "2026-11-08T09:00:00Z", page: "requests", unread: state.unread > 0 }] } : { ...NOTES, unread: state.unread });
      if (fn === "mark_notifications_seen") { state.unread = 0; return send(200, "2026-11-08T10:00:00Z"); }
      if (fn === "site_work_report") return send(200, work(b.p_month ? String(b.p_month).slice(0, 7) : "2026-11"));
      if (fn === "site_growth") return send(200, []);
    }
    send(404, { message: "not found" });
  });
  return { server, calls, html, state };
}
async function open(t, opts) {
  const f = fake(opts);
  await new Promise((r) => f.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${f.server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-notes-"));
  build({ url: base, key: "sb_publishable_test", out }); f.html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); f.server.close(); });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.goto(`${base}/#/login`); await page.fill("input[name=email]", "a@x.test"); await page.fill("input[name=password]", "correct-horse-battery");
  await page.click("button[type=submit]"); await page.waitForSelector("#rail nav");
  return { page, base, f, errors };
}

test("agency: unread count, notifications with links, marked as seen; the work report with month switching and printing", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, base, f, errors } = await open(t);
  assert.equal((await page.textContent("#rail .count")).trim(), "2", "unread count in the menu");
  await page.goto(`${base}/#/notes`); await page.waitForSelector("h1:has-text('Notifications')");
  const text = await page.textContent("#page");
  for (const s of ["Waiting for your approval", "Change verified", "Client request", HOSTILE, "verified: 1 of 1 problems"]) assert.ok(text.includes(s), `shows: ${s}`);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.getAttribute("a.note >> nth=0", "href"), `#/s/${SITE.id}/god`);
  assert.equal(await page.getAttribute("a.note >> nth=2", "href"), `#/s/${SITE.id}/requests`);
  for (let i = 0; i < 100 && f.state.unread; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(f.state.unread, 0, "opening the list marks it as seen");
  await page.waitForFunction(() => !document.querySelector("#rail .count"));

  await page.goto(`${base}/#/s/${SITE.id}/report`); await page.waitForSelector("h2:has-text('Work in November 2026')");
  const r = await page.textContent("#page");
  for (const s of ["Advice accepted", "Changes made", "1 verified on the live site", "7 at the start of the month", "prepared by Agency A", "More boiler enquiries", "verified: 1 of 1 problems fixed"]) assert.ok(r.includes(s), `report shows: ${s}`);
  assert.equal(await page.locator("#page img").count(), 0, "stored text escaped");
  await page.click("#print-report");
  assert.equal(await page.evaluate(() => window.__printed), 1);
  await page.click('[data-wmonth="2026-10"]');
  await page.waitForSelector("h2:has-text('Work in October 2026')");
  assert.equal(f.calls.filter((c) => c.fn === "site_work_report").at(-1).b.p_month, "2026-10-01");
  assert.ok((await page.textContent("#page")).includes("Nothing was completed in this month yet."));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "fits a phone");
  assert.deepEqual(errors, []);
});

test("client account: its own notifications and the work report, no agency menu", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, base, errors } = await open(t, { client: true });
  await page.waitForSelector("#rail .count");
  assert.equal(await page.locator('#rail a:has-text("Operations")').count(), 0, "no agency pages");
  await page.goto(`${base}/#/notes`); await page.waitForSelector("text=Your agency answered");
  assert.equal(await page.getAttribute("a.note >> nth=0", "href"), `#/k/${SITE.id}/requests`);
  await page.goto(`${base}/#/k/${SITE.id}/report`); await page.waitForSelector("h2:has-text('Work in November 2026')");
  assert.ok((await page.textContent("#page")).includes("Changes made"));
  assert.deepEqual(errors, []);
});
