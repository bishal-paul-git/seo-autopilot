// Portfolio and results of changes (D58) in real Chromium against a stand-in for Supabase: the agency lands on every
// website in one table, "needs attention" first, with clicks and their change, pages not indexed, alerts and stale data,
// approvals waiting, 7-day AI spend, win/loss counts and live/paused; the per-site scorecard explains each verdict.
// Text from sites is escaped; fits a phone. Before the migration the old site cards still show. Skipped without Playwright.
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

const ROWS = [
  { site: "s1", name: "Plumber <b>Co</b>", url: "https://plumber.test/", agency: "Agency A", status: "live", clicks28: 280, clicksChange: -0.5, notIndexed: 2, inspected: 4, inspectBlocked: false, stale: ["scan"], alerts: 1, escalated: 1, planError: null,
    waiting: 3, spend7Usd: 1.25, scorecard: { win: 1, loss: 2, flat: 0, tooEarly: 1, notEnoughData: 0 }, attention: 120, reasons: ["1 stopped and needs a person", "clicks down 50%", "2 changes lost traffic"] },
  { site: "s2", name: "Bakery", url: "https://bakery.test/", agency: "Agency A", status: "live", clicks28: 90, clicksChange: null, notIndexed: null, inspected: 0, inspectBlocked: true, stale: [], alerts: 0, escalated: 0,
    waiting: 0, spend7Usd: 0, scorecard: { win: 0, loss: 0, flat: 0, tooEarly: 0, notEnoughData: 0 }, attention: 0, reasons: [] },
  { site: "s3", name: "Old shop", url: "https://old.test/", agency: "Agency A", status: "paused", clicks28: null, clicksChange: null, notIndexed: null, inspected: 0, stale: [], alerts: 0, escalated: 0, waiting: 0, spend7Usd: 0, scorecard: {}, attention: 0, reasons: [] },
];
const CARD = [
  { key: "job:l", job: "l", title: "Shorter <i>title</i> on boilers", basis: "change merged", changedAt: "2026-10-05", agent: "seo-snippet-optimizer", pr: "https://github.com/a/b/pull/7", pages: ["https://plumber.test/boilers"], label: "loss",
    windows: { 14: { label: "loss", final: true, reason: "Clicks 40 → 25 (−38%); rest of the site +2% over the same days.", before: { clicks: 40, impressions: 1000 }, after: { clicks: 25, impressions: 900 } }, 28: { label: "too_early", readyOn: "2026-11-08", before: { clicks: 80, impressions: 2000 } } } },
  { key: "job:s", job: "s", title: "Advice: rewrite the boilers title", basis: "advice accepted", changedAt: "2026-09-20", pages: ["https://plumber.test/boilers"], supersededBy: "l", windows: {} },
];
function fake(withPortfolio) {
  const calls = [], html = { body: "" };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "jwt", refresh_token: "r", expires_in: 3600, user: { email: "a@x.test" } });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop(), b = JSON.parse(body || "{}"); calls.push({ fn, b });
      if (fn === "my_sites") return send(200, ROWS.map((r) => ({ site: { id: r.site, name: r.name, url: r.url, status: "live", mode: "url", last_snapshot_at: "2026-11-14T00:00:00Z" }, data: null })));
      if (fn === "my_org") return send(200, { id: "org-a", name: "Agency A", role: "owner" });
      if (fn === "client_sites") return send(200, []);
      if (fn === "my_notifications") return send(200, { items: [], unread: 0 });
      if (fn === "portfolio") {
        if (!withPortfolio) return send(404, { message: "Could not find the function public.portfolio" });
        return b.p_site ? send(200, { sites: ROWS.filter((r) => r.site === b.p_site), scorecard: CARD }) : send(200, { sites: ROWS });
      }
      return send(200, null);
    }
    send(404, { message: "not found" });
  });
  return { server, calls, html };
}
async function open(t, withPortfolio = true) {
  const f = fake(withPortfolio);
  await new Promise((r) => f.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${f.server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-pf-"));
  build({ url: base, key: "sb_publishable_test", out }); f.html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); f.server.close(); });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/#/login`); await page.fill("input[name=email]", "a@x.test"); await page.fill("input[name=password]", "correct-horse-battery"); await page.click("button[type=submit]");
  await page.waitForSelector("#rail nav");
  return { page, calls: f.calls, errors, base };
}

test("the agency lands on the portfolio: every website, needs attention first, the numbers that matter", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, errors } = await open(t);
  await page.waitForSelector("h1:has-text('Portfolio')");
  const table = await page.textContent(".pf-table");
  assert.match(table, /Plumber <b>Co<\/b>[\s\S]*Bakery[\s\S]*Old shop/, "in the order given: needs attention first, paused last");
  for (const s of ["1 stopped and needs a person · clicks down 50% · 2 changes lost traffic", "280", "−50%", "scan stale", "1 alert", "$1.25", "1 won", "2 lost", "1 too early", "refused", "Nothing needs you.", "Paused", "none yet"]) assert.ok(table.includes(s), `shows: ${s}`);
  assert.equal(await page.locator("#page b", { hasText: /^Co$/ }).count(), 0, "names stay text");
  assert.equal(await page.getAttribute(".pf-table a[href$='/approvals']", "href"), "#/s/s1/approvals", "waiting approvals link to the approvals page");
  const kpis = await page.textContent(".grid.g4");
  assert.match(kpis, /Need attention\s*1/); assert.match(kpis, /370/); assert.match(kpis, /\$1\.25/);
  assert.ok((await page.textContent("#rail")).includes("Portfolio"));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.isVisible(".pf-cards") && !(await page.isVisible(".pf-table")), "cards on a phone");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "fits a phone");
  assert.deepEqual(errors, []);
});

test("results of changes: each change with its 14- and 28-day verdict, the reason, and advice that was implemented counted once", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, calls, errors } = await open(t);
  await page.waitForSelector("h1:has-text('Portfolio')");
  await page.click(".pf-table a[href='#/s/s1/scorecard']");
  await page.waitForSelector("h1:has-text('Results of changes')");
  assert.deepEqual(calls.filter((c) => c.fn === "portfolio").at(-1).b, { p_site: "s1" });
  const text = await page.textContent("#page");
  for (const s of ["Shorter <i>title</i> on boilers", "change merged 2026-10-05", "snippet optimizer", "14 days: Loss", "Clicks 40 → 25 (−38%)", "28 days: Too early", "Ready about 2026-11-08", "Before: 80 clicks", "Implemented later: counted once", "Replaced", "Directional, not a controlled test"]) assert.ok(text.includes(s), `shows: ${s}`);
  assert.equal(await page.locator("#page i", { hasText: /^title$/ }).count(), 0, "titles stay text");
  assert.match(await page.textContent(".grid.g4"), /Wins\s*1[\s\S]*Losses\s*2/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "fits a phone");
  assert.deepEqual(errors, []);
});

test("before the migration: the old website cards, no error", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, errors } = await open(t, false);
  await page.waitForSelector("h1:has-text('Websites')");
  assert.ok(await page.isVisible(".sites"));
  assert.deepEqual(errors, []);
});
