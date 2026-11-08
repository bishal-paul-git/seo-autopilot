// The SEO God console page (agency only) in real Chromium against a stand-in for Supabase: shows the strategy, work
// waiting for the agency with its stored proposal, questions, escalations and costs; sends approve / request changes /
// reject with a note, answers and retries; escapes model and site text; never appears for clients; fits a phone.
// Skipped when Playwright is not installed. No network.
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

const SITE = { id: "11111111-1111-4111-8111-111111111111", name: "Plumber", url: "https://plumber.test/", status: "connecting", mode: "url", last_snapshot_at: null };
const HOSTILE = '<img src=x onerror="window.__pwned=1">Fix titles';
const consoleData = () => ({
  strategy: { status: "proposed", approval: "agency", objective: null, firstSteps: [{ title: "Add missing titles", why: "1 page has none" }], kpis: ["Pages indexed"], risks: ["2 questions open"] },
  questions: [{ key: "goals", question: "What should search bring you?", why: "sets the objective" }],
  answers: [], facts: 8,
  waiting: [
    { id: "j-start", kind: "strategy_proposal", title: "Propose the initial SEO strategy", risk: "high", stage: "start", why: "no approved strategy", outputs: null, costUsd: 0 },
    { id: "j-advice", kind: "agent:seo-snippet-optimizer", title: "Rewrite weak titles", risk: "medium", stage: "result", why: "low CTR", review: { verdict: "pass" }, costUsd: 0.04,
      outputs: { proposal: { mode: "advise", summary: "Two titles are weak.", recommendations: [{ title: HOSTILE, url: "https://plumber.test/x", why: "no title", evidence: ["audit: title-missing"], effort: "small" }] } } },
  ],
  escalated: [{ id: "j-esc", kind: "agent:seo-reporter", title: "Weekly report", error: "provider timeout", attempts: 3 }],
  active: [{ id: "j-q", kind: "scan", title: "Read the site", status: "queued" }],
  recent: [{ id: "j-done", kind: "scan", title: "Read the site", status: "completed", outputs: null, costUsd: 0, updatedAt: "2026-11-08T01:00:00Z" }],
  costs: { today: 0.04, month: 1.2 }, lastPlanned: { at: "2026-11-08T01:15:00Z" },
  lessons: [{ key: "agent:seo-snippet-optimizer", text: "seo-snippet-optimizer: 2 of 3 checked recommendations were fixed by later scans.", confidence: 0.6 }],
  experiments: [{ agent: "seo-snippet-optimizer", status: "open", openedAt: "2026-11-01T00:00:00Z", items: [{ url: "plumber.test/<b>x</b>", status: "resolved" }, { url: "plumber.test/y", status: "not_rechecked" }] }],
});

function fake({ consoleFails = false } = {}) {
  const calls = [], html = { body: "" };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "user-jwt", refresh_token: "r", expires_in: 3600, user: { email: "alice@agency.test" } });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop(), b = JSON.parse(body || "{}");
      calls.push({ fn, b, auth: req.headers.authorization });
      if (fn === "shared_site") return send(200, b.p_token === "c123" ? { site: { name: SITE.name, url: SITE.url, status: "live", last_snapshot_at: "2026-11-08T00:00:00Z" }, growth: [], data: {} } : null);
      if (req.headers.authorization !== "Bearer user-jwt") return send(401, { message: "JWT required" });
      if (fn === "my_sites") return send(200, [{ site: SITE, data: null, decisions: [] }]);
      if (fn === "my_org") return send(200, { id: "org-a", name: "alice", role: "owner" });
      if (fn === "god_console") return consoleFails ? send(404, { message: "Could not find the function public.god_console" }) : send(200, consoleData());
      if (["approve_job", "answer_question", "retry_job"].includes(fn)) return send(200, { ok: true });
    }
    send(404, { message: "not found" });
  });
  return { server, calls, html };
}

async function open(t, opts) {
  const f = fake(opts);
  await new Promise((r) => f.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${f.server.address().port}`;
  const out = mkdtempSync(join(tmpdir(), "portal-god-"));
  build({ url: base, key: "sb_publishable_test", out });
  f.html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); f.server.close(); });
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/#/login`);
  await page.fill("input[name=email]", "alice@agency.test"); await page.fill("input[name=password]", "correct-horse");
  await page.click("button[type=submit]"); await page.waitForSelector("text=Plumber");
  return { page, base, calls: f.calls, errors };
}

test("SEO God console: decisions, questions, retries, escaping, agency only, phone layout", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, base, calls, errors } = await open(t);
  await page.goto(`${base}/#/s/${SITE.id}/god`);
  await page.waitForSelector("h1:has-text('SEO God')");
  const text = await page.textContent("#page");
  for (const s of ["Waiting for your approval", "Approve to start", "Approve this result", "Two titles are weak.", "Add missing titles", "What should search bring you?", "provider timeout", "$0.04 today", "Advice only", "What it has learned", "2 of 3 checked recommendations were fixed", "1 pieces of advice being checked"]) assert.ok(text.includes(s), `shows: ${s}`);
  // Model and site text is shown as text, never run as HTML.
  assert.ok(text.includes('<img src=x onerror="window.__pwned=1">Fix titles'), "hostile title shown literally");
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator("#page img").count(), 0);
  assert.equal(await page.locator("#page details b:has-text(\"x\")").count(), 0, "addresses from the site are escaped too");
  await page.click("summary:has-text(\"being checked\")");
  assert.ok((await page.textContent("#page")).includes("page not re-read yet"));
  // Approve the advice with a note.
  await page.fill("#note-j-advice", "Looks right, go ahead");
  await page.click('[data-jdec="approve"][data-job="j-advice"]');
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Approved"));
  const ap = calls.find((c) => c.fn === "approve_job");
  assert.deepEqual(ap.b, { p_job: "j-advice", p_decision: "approve", p_note: "Looks right, go ahead" });
  assert.equal(ap.auth, "Bearer user-jwt");
  await page.click('[data-jdec="request_changes"][data-job="j-start"]');
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Sent back"));
  assert.ok(calls.some((c) => c.fn === "approve_job" && c.b.p_decision === "request_changes" && c.b.p_note === null));
  await page.click('[data-jdec="reject"][data-job="j-start"]');
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Rejected"));
  // Answer a question; empty answers are not sent.
  const before = calls.length;
  await page.click('[data-qsave="goals"]');
  assert.equal(calls.filter((c, i) => i >= before && c.fn === "answer_question").length, 0, "empty answer not sent");
  await page.fill("#ans-goals", "More boiler repair enquiries");
  await page.click('[data-qsave="goals"]');
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Answer saved"));
  assert.deepEqual(calls.find((c) => c.fn === "answer_question").b, { p_site: SITE.id, p_key: "goals", p_value: "More boiler repair enquiries" });
  await page.click('[data-retry="j-esc"]');
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Queued again"));
  assert.ok(calls.some((c) => c.fn === "retry_job" && c.b.p_job === "j-esc"));
  // The portal shows the toast first and then reloads the console, so wait for that reload rather than racing it.
  for (let i = 0; i < 100 && calls.filter((c) => c.fn === "god_console").length < 6; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(calls.filter((c) => c.fn === "god_console").length >= 6, "reloaded after every action (first load + 5 actions)");
  // Phone: no sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#/s/${SITE.id}/god`); await page.waitForSelector("h1:has-text('SEO God')");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "fits a phone");
  // Clients never see it: not in the menu, and the address falls back to the overview.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/#/c/c123/god`); await page.waitForSelector("#rail nav");
  assert.equal(await page.locator('#rail a:has-text("SEO God")').count(), 0);
  assert.ok(!(await page.textContent("#page")).includes("Waiting for you"));
  assert.equal(calls.filter((c) => c.fn === "god_console" && c.auth !== "Bearer user-jwt").length, 0, "the console is never requested without an agency session");
  assert.deepEqual(errors, []);
});

test("SEO God console: a clear message before the database update is applied", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, base, errors } = await open(t, { consoleFails: true });
  await page.goto(`${base}/#/s/${SITE.id}/god`);
  await page.waitForSelector(".callout");
  assert.match(await page.textContent(".callout"), /not switched on for this workspace yet/);
  assert.deepEqual(errors, []);
});
