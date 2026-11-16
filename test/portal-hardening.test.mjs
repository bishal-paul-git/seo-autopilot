// Portal pilot hardening (D62), in real Chromium against a stand-in for Supabase: a failed read is shown as an error,
// never as "nothing yet"; a client account never gets agency pages; a stale scan is not "Scanned daily"; and the texts
// that promised something the product does not do are corrected.
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
const skip = !playwright && "Playwright not installed";

const DAY = 864e5;
const SITE = { id: "11111111-1111-4111-8111-111111111111", name: "Plumber", url: "https://plumber.test/", status: "live", mode: "url", scan_state: "done", last_snapshot_at: new Date(Date.now() - 5 * DAY).toISOString() };
const BOOM = { message: "database is down" };

function fake({ who, fail = [] }) {
  const calls = [], html = { body: "" };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: `${who}-jwt`, refresh_token: "r", expires_in: 3600, user: { email: `${who}@x.test` } });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop();
      calls.push(fn);
      const agency = req.headers.authorization === "Bearer agency-jwt", client = req.headers.authorization === "Bearer client-jwt";
      if (!agency && !client) return send(401, { message: "JWT required" });
      if (fail.includes(fn)) return send(500, BOOM);
      if (fn === "my_sites") return send(200, agency ? [{ site: SITE, data: {}, decisions: [] }] : []);
      if (fn === "my_org") return send(200, agency ? { id: "org-a", name: "Agency A", role: "owner" } : null);
      if (fn === "client_sites") return send(200, client ? [{ site: SITE, data: {}, brand: { name: "Agency A", color: "#3355cc" } }] : []);
      if (fn === "my_notifications") return send(200, { unread: 0, items: [] });
      if (fn === "my_email_summary") return send(200, true);
      if (fn === "site_growth") return send(200, []);
      if (fn === "portfolio") return send(200, { generatedAt: new Date().toISOString(), sites: [] });
      if (fn === "portfolio_google") return send(200, []);
      if (agency && fn === "agency_overview") return send(200, []);
      if (agency && fn === "ops_alerts") return send(200, []);
      if (agency && fn === "site_workforce") return send(200, []);
      if (agency && fn === "site_agent_stats") return send(200, []);
      return send(403, { message: "not allowed" });
    }
    send(404, { message: "not found" });
  });
  return { server, calls, html };
}

async function open(t, who, opts = {}) {
  const f = fake({ who, ...opts });
  await new Promise((r) => f.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${f.server.address().port}`;
  const out = mkdtempSync(join(tmpdir(), "portal-hardening-"));
  build({ url: base, key: "sb_publishable_test", out });
  f.html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); f.server.close(); });
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/#/login`);
  await page.fill("input[name=email]", `${who}@x.test`); await page.fill("input[name=password]", "correct-horse-battery");
  await page.click("button[type=submit]");
  await page.waitForFunction(() => !["#/login", "#/signup"].includes(location.hash) && !document.querySelector("#login-form"));
  await page.waitForSelector("#page h1, #page .callout"); // the first page after sign-in has rendered, so it cannot overwrite the next one
  return { page, base, calls: f.calls, errors };
}
const callout = (page, text) => page.waitForFunction((t) => [...document.querySelectorAll("#page .callout")].some((c) => c.textContent.includes(t)), text);

test("failed reads are errors, not 'nothing yet': portfolio, notifications, team, growth trend, alerts", { skip }, async (t) => {
  const { page, base, errors } = await open(t, "agency", { fail: ["portfolio", "my_notifications", "site_workforce", "site_growth", "ops_alerts"] });
  await callout(page, "The portfolio could not be loaded: database is down");
  await page.goto(`${base}/#/notes`); await callout(page, "Notifications could not be loaded: database is down");
  assert.ok(!(await page.textContent("#page")).includes("Nothing yet"));
  await page.goto(`${base}/#/s/${SITE.id}/team`); await callout(page, "The team's work on this site could not be loaded");
  assert.ok(!(await page.textContent("#page")).includes("No specialist has run here"));
  await page.goto(`${base}/#/s/${SITE.id}/overview`); await callout(page, "The trend could not be loaded");
  assert.ok(!(await page.textContent("#page")).includes("The trend appears after"));
  await page.goto(`${base}/#/ops`); await callout(page, "Alerts could not be loaded");
  assert.deepEqual(errors, []);
});

test("a client account is sent away from the agency pages; the agency still gets them", { skip }, async (t) => {
  const { page, base, calls } = await open(t, "client");
  for (const h of ["#/ops", "#/team", "#/add"]) {
    await page.goto(`${base}/${h}`);
    await page.waitForFunction((x) => location.hash !== x, h);
    assert.match(await page.evaluate(() => location.hash), /^#\/k\//, `${h} redirects to the client's own site`);
  }
  assert.ok(!calls.includes("agency_overview"), "no agency function called");
  const a = await open(t, "agency");
  await a.page.goto(`${a.base}/#/ops`); await a.page.waitForSelector("h1:has-text('Operations')");
});

test("a scan older than 72 hours is not 'Scanned daily'", { skip }, async (t) => {
  const { page, base } = await open(t, "agency");
  await page.goto(`${base}/#/s/${SITE.id}/connect`);
  await page.waitForSelector("h1:has-text('Connection')");
  const text = await page.textContent("#page");
  assert.match(text, /No scan for 5 days/); assert.ok(!text.includes("Scanned daily"));
});

test("texts say what the product does (AI key, email sender, adding a website)", () => {
  const out = mkdtempSync(join(tmpdir(), "portal-hardening-text-"));
  build({ url: "https://abc.supabase.co", key: "sb_publishable_x", out });
  const html = readFileSync(join(out, "index.html"), "utf8");
  for (const s of ["the platform's AI key, metered per website", "Sent from the platform's email address", "Add a website by its address", "Ask for more detail"]) assert.ok(html.includes(s), `says: ${s}`);
  for (const s of ["from your own AI key", "From your own AI key", "agency's AI key", "Sent from your agency's address", "paste two values into its GitHub repository", ">Ask a question<"]) assert.ok(!html.includes(s), `no longer says: ${s}`);
});
