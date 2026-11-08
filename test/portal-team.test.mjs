// The SEO team page (agency only) in real Chromium: the director and the master spec's eight departments with their
// specialists, what each did on this site in the last 30 days (from site_workforce), highlighted specialists. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, organisation } from "../cloud/portal/build.mjs";

let playwright = null;
for (const from of [import.meta.url, join(process.cwd(), "package.json")]) { try { playwright = createRequire(from)("playwright"); break; } catch { /* not installed */ } }

const SITE = { id: "11111111-1111-4111-8111-111111111111", name: "Plumber", url: "https://plumber.test/", status: "live", mode: "url", last_snapshot_at: "2026-11-08T00:00:00Z" };
const WORKFORCE = [
  { kind: "scan", total: 5, completed: 5, waiting: 0, active: 0, stopped: 0, lastAt: "2026-11-08T09:00:00Z" },
  { kind: "strategy_proposal", total: 1, completed: 1, waiting: 0, active: 0, stopped: 0, lastAt: "2026-11-07T09:00:00Z" },
  { kind: "agent:seo-snippet-optimizer", total: 3, completed: 2, waiting: 1, active: 0, stopped: 0, lastAt: "2026-11-08T08:00:00Z" },
  { kind: "implement", total: 2, completed: 1, waiting: 0, active: 1, stopped: 0, lastAt: "2026-11-08T07:00:00Z" },
];

test("organisation: a director and the eight departments of the master spec cover every agent once", () => {
  const o = organisation();
  const all = [...o.director, ...o.departments.flatMap((d) => d.agents)];
  assert.equal(o.departments.length, 8);
  assert.equal(new Set(all).size, all.length, "no agent in two places");
  assert.ok(all.length >= 38, `${all.length} agents`);
  assert.ok(o.departments.find((d) => d.id === "analytics").agents.includes("seo-reporter"));
});

test("team page: director and departments with 30-day work, specialists that ran highlighted", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const html = { body: "" };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "jwt", refresh_token: "r", expires_in: 3600, user: { email: "a@x.test" } });
    const fn = u.pathname.split("/").pop();
    if (fn === "my_sites") return send(200, [{ site: SITE, data: {}, decisions: [] }]);
    if (fn === "my_org") return send(200, { id: "org-a", name: "Agency A", role: "owner" });
    if (fn === "site_workforce") return send(200, WORKFORCE);
    send(404, { message: "not found" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-team-"));
  build({ url: base, key: "sb_publishable_test", out }); html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); server.close(); });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/#/login`); await page.fill("input[name=email]", "a@x.test"); await page.fill("input[name=password]", "correct-horse-battery");
  await page.click("button[type=submit]"); await page.waitForSelector("#rail nav");
  await page.goto(`${base}/#/s/${SITE.id}/team`); await page.waitForSelector("h2:has-text('Director: the SEO God')");
  const text = await page.textContent("#page");
  for (const d of ["Research & Intelligence", "Technical SEO", "Content & On-Page SEO", "Authority & Off-Page SEO", "Analytics & Performance", "AI Search & Visibility", "Automation & Integrations", "Quality, Risk & Governance"]) assert.ok(text.includes(d), d);
  const card = async (h) => page.textContent(`.card:has(h2:has-text("${h}"))`);
  assert.match(await card("Director: the SEO God"), /1 done/, "strategy drafts are the director's work");
  assert.match(await card("Technical SEO"), /5 done/, "scans are technical work");
  assert.match(await card("Automation & Integrations"), /1 done · 1 in progress/, "implementation is automation's work");
  assert.match(await card("Content & On-Page SEO"), /2 done · 0 in progress · 1 waiting for you/);
  assert.equal(await page.locator('.chip.ok:has-text("snippet optimizer · 3")').count(), 1, "specialist that ran is highlighted with its runs");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "fits a phone");
  assert.deepEqual(errors, []);
});
