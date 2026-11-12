// Live activity on the SEO God page (D42) in real Chromium: scheduler heartbeat, what holds the team back, who is
// working now, the team on this site and every step, all from site_activity; hostile text stays text. No network.
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

const SITE = { id: "11111111-1111-4111-8111-111111111111", name: "Plumber", url: "https://plumber.test/", status: "live", mode: "url", last_snapshot_at: "2026-11-12T00:00:00Z" };
const NOW = "2026-11-12T15:00:00Z";
const ACTIVITY = {
  now: NOW, site: { status: "live" },
  scheduler: { paused: false, lastRunAt: "2026-11-12T14:55:00Z", runsLastHour: 4, runsWithErrorsOfLast4: 0, lastRunPaused: false },
  working: [{ job: "j3", kind: "agent:seo-snippet-optimizer", agent: "seo-snippet-optimizer", title: "Rewrite titles", status: "running", since: "2026-11-12T14:58:00Z", attempts: 1 }],
  workers: [
    { who: "scan", isAgent: false, lastAt: "2026-11-12T01:00:26Z", runs: 1, completed: 1, costUsd: 0, lastStatus: "completed", lastTitle: "Read the site" },
    { who: "seo-snippet-optimizer", isAgent: true, lastAt: "2026-11-12T14:58:00Z", runs: 2, completed: 1, costUsd: 0.12, lastStatus: "running", lastTitle: "Rewrite titles" },
  ],
  events: [
    { at: "2026-11-12T14:58:00Z", actorKind: "agent", actor: "cf-06f14358", from: "queued", to: "running", note: "claimed", job: "j3", kind: "agent:seo-snippet-optimizer", agent: "seo-snippet-optimizer", title: "Rewrite titles" },
    { at: "2026-11-12T01:00:27Z", actorKind: "agent", actor: "quality-gate@1", from: "awaiting_review", to: "awaiting_approval", note: "reviewed; waiting for the agency to adopt it", job: "j2", kind: "strategy_proposal", title: "Initial strategy" },
    { at: "2026-11-12T01:00:12Z", actorKind: "agent", actor: "seo-god", from: "proposed", to: "scoped", note: "<img src=x onerror=window.__pwned=1>", job: "j1", kind: "scan", title: "Read the site" },
    { at: "2026-11-12T00:59:00Z", actorKind: "user", actor: "alice@agency.test", from: null, to: "proposed", note: "created", job: "j0", kind: "scan", title: "Scan now" },
  ],
  gates: { strategyApproved: false, waitingForYou: 1, openQuestions: 8, needsAPerson: 0, githubConnected: false, agentRunsEver: 0, agentCostMonth: 0 },
};

test("SEO God page: live activity shows the heartbeat, blockers, who is working and every step", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const html = { body: "" }; let activityCalls = 0;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "jwt", refresh_token: "r", expires_in: 3600, user: { email: "a@x.test" } });
    const fn = u.pathname.split("/").pop();
    if (fn === "my_sites") return send(200, [{ site: SITE, data: {}, decisions: [] }]);
    if (fn === "my_org") return send(200, { id: "org-a", name: "Agency A", role: "owner" });
    if (fn === "god_console") return send(200, { strategy: null, questions: [], answers: [], waiting: [], escalated: [], active: [], recent: [], costs: { today: 0, month: 0 }, lessons: [], experiments: [] });
    if (fn === "site_integrations" || fn === "site_deployments") return send(200, []);
    if (fn === "site_activity") { activityCalls++; assert.equal(JSON.parse(body).p_site, SITE.id); return send(200, ACTIVITY); }
    send(404, { message: "not found" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-activity-"));
  build({ url: base, key: "sb_publishable_test", out }); html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); server.close(); });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => { window.__ACT_MS = 400; });
  await page.goto(`${base}/#/login`); await page.fill("input[name=email]", "a@x.test"); await page.fill("input[name=password]", "correct-horse-battery");
  await page.click("button[type=submit]"); await page.waitForSelector("#rail nav");
  await page.goto(`${base}/#/s/${SITE.id}/god`); await page.waitForSelector("h2:has-text('Live activity')");
  const card = await page.textContent("#activity");
  assert.match(card, /Scheduler running: last check 5 min ago, 4 in the last hour, no errors/);
  assert.match(card, /strategy is waiting for your approval/);
  assert.match(card, /Business brief: 8 things the site does not say are still blank \(optional\)/);
  assert.match(card, /AI specialists start after the strategy is approved/);
  assert.match(card, /Advice only: connect GitHub/);
  assert.match(card, /Working now[\s\S]*snippet optimizer[\s\S]*Rewrite titles · started working · since 2 min ago/);
  assert.match(card, /The team on this site[\s\S]*Site scan[\s\S]*1\/1 done[\s\S]*snippet optimizer AI[\s\S]*\$0\.12/);
  assert.match(card, /Quality reviewer · Strategy draft is waiting for your approval/);
  assert.match(card, /SEO God \(director\) · Site scan planned/);
  assert.match(card, /alice@agency\.test · Site scan created/);
  assert.match(card, /<img src=x onerror=window.__pwned=1>/, "hostile note shown as text");
  assert.equal(await page.evaluate(() => window.__pwned), undefined, "and never run");
  // Refresh replaces only the activity card: a half-typed answer elsewhere on the page survives.
  const calls = activityCalls;
  await page.evaluate(() => { const i = document.createElement("input"); i.id = "typed"; i.value = "half an answer"; document.querySelector("#page").appendChild(i); });
  for (let i = 0; i < 40 && activityCalls === calls; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(activityCalls > calls, "refreshed on its interval");
  assert.equal(await page.inputValue("#typed"), "half an answer");
  // Leaving the page stops the refresh.
  await page.goto(`${base}/#/s/${SITE.id}/team`); await page.waitForSelector("h2:has-text('Director')").catch(() => {});
  const after = activityCalls; await new Promise((r) => setTimeout(r, 1200));
  assert.equal(activityCalls, after, "no refresh off the SEO God page");
  assert.deepEqual(errors, []);
});
