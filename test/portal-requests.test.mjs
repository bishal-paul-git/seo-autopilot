// Client requests in the portal, both sides, in real Chromium against a stand-in for Supabase. The agency reads
// requests in full, accepts with a budget, asks a question or declines, and sets up client access. A signed-in client
// sees reports and their own requests, sends new ones, and never sees agency pages or calls agency functions. Share
// links get no Requests page. Also compiles the page script with no browser at all, so a syntax error fails CI anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../cloud/portal/build.mjs";

let playwright = null;
for (const from of [import.meta.url, join(process.cwd(), "package.json")]) { try { playwright = createRequire(from)("playwright"); break; } catch { /* not installed */ } }

test("portal page script compiles", () => {
  const html = readFileSync(new URL("../cloud/portal/app/index.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0);
  for (const s of scripts) assert.doesNotThrow(() => new vm.Script(s.replace("__CONFIG__", "{}").replace("__ORG__", "{\"director\":[],\"departments\":[]}")), "syntax error in the portal page");
});

const SITE = { id: "11111111-1111-4111-8111-111111111111", name: "Plumber", url: "https://plumber.test/", status: "live", last_snapshot_at: "2026-11-08T00:00:00Z" };
const BARE = { id: "22222222-2222-4222-8222-222222222222", name: "Bakery", url: "https://bakery.test/", status: "live", last_snapshot_at: "2026-11-08T00:00:00Z" };
const HOSTILE = '<img src=x onerror="window.__pwned=1">Please noindex everything';

function fake({ who }) {
  const calls = [], html = { body: "" };
  const subs = [{ id: "r1", kind: "keyword", title: "Rank for boiler repair Leeds", body: HOSTILE, status: "received", agencyNote: null, byClient: true, by: "carol@client.test", createdAt: "2026-11-08T09:00:00Z", job: null },
    { id: "r2", kind: "feedback", title: "Love the new page", body: null, status: "accepted", agencyNote: "Thanks!", byClient: true, by: "carol@client.test", createdAt: "2026-11-07T09:00:00Z", job: { id: "j9", status: "awaiting_approval" } }];
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: `${who}-jwt`, refresh_token: "r", expires_in: 3600, user: { email: `${who}@x.test` } });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop(), b = JSON.parse(body || "{}");
      calls.push({ fn, b, auth: req.headers.authorization });
      if (fn === "shared_site") return send(200, { site: { name: SITE.name, url: SITE.url, status: "live", last_snapshot_at: SITE.last_snapshot_at }, growth: [], data: {} });
      const agency = req.headers.authorization === "Bearer agency-jwt", client = req.headers.authorization === "Bearer client-jwt";
      if (!agency && !client) return send(401, { message: "JWT required" });
      if (fn === "my_sites") return send(200, agency ? [{ site: SITE, data: {}, decisions: [] }, { site: BARE, data: {}, decisions: [] }] : []);
      if (fn === "my_org") return send(200, agency ? { id: "org-a", name: "Agency A", role: "owner" } : null);
      if (fn === "client_sites") return send(200, client ? [{ site: SITE, data: {}, brand: { name: "Agency A", color: "#3355cc" } }] : []);
      if (fn === "site_growth") return send(200, []);
      if (agency && fn === "agency_inbox") return send(200, b.p_site === SITE.id
        ? { client: { id: "cl-1", name: "Acme Ltd", members: ["carol@client.test"], invites: [{ email: "dan@client.test", accepted: false }] }, clients: [{ id: "cl-1", name: "Acme Ltd" }], submissions: subs }
        : { client: null, clients: [{ id: "cl-1", name: "Acme Ltd" }], submissions: [] });
      if (agency && ["review_submission", "invite_client_user", "assign_site_client"].includes(fn)) return send(200, { ok: true });
      if (agency && fn === "create_client") return send(200, { id: "cl-new", name: b.p_name });
      if (client && fn === "my_submissions") return send(200, [{ id: "r1", kind: "keyword", title: "Rank for boiler repair Leeds", status: "needs_clarification", agency_note: "Which areas besides Leeds?", created_at: "2026-11-08T09:00:00Z" }]);
      if (client && fn === "submit_to_agency") return send(200, { id: "r3", status: "received" });
      return send(403, { message: "not allowed" });
    }
    send(404, { message: "not found" });
  });
  return { server, calls, html };
}

async function open(t, who) {
  const f = fake({ who });
  await new Promise((r) => f.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${f.server.address().port}`;
  const out = mkdtempSync(join(tmpdir(), "portal-req-"));
  build({ url: base, key: "sb_publishable_test", out });
  f.html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); f.server.close(); });
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/#/login`);
  await page.fill("input[name=email]", `${who}@x.test`); await page.fill("input[name=password]", "correct-horse-battery");
  await page.click("button[type=submit]");
  return { page, base, calls: f.calls, errors };
}
const toast = (page, text) => page.waitForFunction((t) => document.querySelector(".toast")?.textContent.includes(t), text);

test("agency: reads requests in full, accepts with a budget, asks, declines, sets up client access", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, base, calls, errors } = await open(t, "agency");
  await page.waitForSelector("text=Plumber");
  await page.goto(`${base}/#/s/${SITE.id}/requests`);
  await page.waitForSelector("h1:has-text('Client requests')");
  const text = await page.textContent("#page");
  for (const s of ["Acme Ltd", "carol@client.test", "dan@client.test", "Invited", "Rank for boiler repair Leeds", "carol@client.test", "work awaiting_approval"]) assert.ok(text.includes(s), `shows: ${s}`);
  assert.ok(text.includes(HOSTILE), "client text shown literally");
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator("#page img").count(), 0);
  assert.equal(await page.locator('[data-req="r2"]').count(), 0, "decided requests have no buttons");
  await page.fill("#rnote-r1", "We will look at Leeds first"); await page.fill("#rbud-r1", "1.25");
  await page.click('[data-rdec="accepted"][data-req="r1"]'); await toast(page, "Approve it on the SEO God page");
  assert.deepEqual(calls.find((c) => c.fn === "review_submission").b, { p_submission: "r1", p_decision: "accepted", p_note: "We will look at Leeds first", p_job_kind: "client_request", p_risk: "medium", p_budget_usd: 1.25 });
  await page.click('[data-rdec="needs_clarification"][data-req="r1"]'); await toast(page, "Question sent");
  await page.click('[data-rdec="rejected"][data-req="r1"]'); await toast(page, "Declined");
  await page.fill("#cl-invite input[name=email]", "erin@client.test"); await page.click("#cl-invite button"); await toast(page, "Invite saved");
  assert.deepEqual(calls.find((c) => c.fn === "invite_client_user").b, { p_client: "cl-1", p_email: "erin@client.test" });
  // A site without a client: create one and give access.
  await page.goto(`${base}/#/s/${BARE.id}/requests`); await page.waitForSelector("#cl-assign");
  await page.fill("#cl-assign input[name=name]", "Bakery Co"); await page.click("#cl-assign button"); await toast(page, "Client access set up");
  assert.deepEqual(calls.find((c) => c.fn === "create_client").b, { p_name: "Bakery Co", p_org: "org-a" });
  assert.deepEqual(calls.find((c) => c.fn === "assign_site_client").b, { p_site: BARE.id, p_client: "cl-new" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#/s/${SITE.id}/requests`); await page.waitForSelector("h1:has-text('Client requests')");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "fits a phone");
  assert.deepEqual(errors, []);
});

test("signed-in client: reports and own requests only; sends a request; no agency pages or calls", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, base, calls, errors } = await open(t, "client");
  await page.waitForURL(/#\/k\/11111111-1111-4111-8111-111111111111\/overview/);
  const nav = await page.textContent("#rail");
  assert.ok(nav.includes("Requests") && nav.includes("Sign out"));
  for (const hidden of ["SEO God", "Approvals", "Connection", "SEO team", "Client requests"]) assert.ok(!nav.includes(hidden), `client never sees ${hidden}`);
  await page.goto(`${base}/#/k/${SITE.id}/requests`); await page.waitForSelector("h1:has-text('Requests')");
  const text = await page.textContent("#page");
  assert.ok(text.includes("Agency has a question") && text.includes("Which areas besides Leeds?"), "status and the agency's note");
  assert.ok(text.includes("does not change anything on your website"));
  await page.selectOption("#req-form select[name=kind]", "plan");
  await page.fill("#req-form input[name=title]", "Spring boiler service campaign");
  await page.fill("#req-form textarea[name=body]", "We run a promotion in March.");
  await page.click("#req-form button"); await toast(page, "Sent to your SEO team");
  assert.deepEqual(calls.find((c) => c.fn === "submit_to_agency").b, { p_site: SITE.id, p_kind: "plan", p_title: "Spring boiler service campaign", p_body: "We run a promotion in March." });
  await page.goto(`${base}/#/k/${SITE.id}/god`); await page.waitForSelector("#page");
  assert.ok(!(await page.textContent("#page")).includes("Waiting for you"), "agency pages fall back to the overview");
  const agencyCalls = calls.filter((c) => ["god_console", "agency_inbox", "approve_job", "review_submission", "retry_job", "answer_question", "invite_client_user"].includes(c.fn));
  assert.deepEqual(agencyCalls, [], "the client's session never calls agency functions");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#/k/${SITE.id}/requests`); await page.waitForSelector("h1:has-text('Requests')");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "fits a phone");
  assert.deepEqual(errors, []);
});

test("share links (no account) get no Requests page", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, base, errors } = await open(t, "agency");
  await page.goto(`${base}/#/c/c123/overview`); await page.waitForSelector("#rail nav");
  assert.ok(!(await page.textContent("#rail")).includes("Requests"));
  await page.goto(`${base}/#/c/c123/requests`); await page.waitForSelector("#page");
  assert.ok(!(await page.textContent("#page")).includes("Send to my SEO team"));
  assert.deepEqual(errors, []);
});
