// Business brief (D44) in real Chromium: adding a website goes straight to one optional form with every onboarding
// question; saving sends all fields at once through save_brief; "Skip for now" works; the brief is editable later from
// the SEO God page, prefilled, with the fields the site does not answer marked. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../cloud/portal/build.mjs";
import { BRIEF } from "../src/god/onboarding.mjs";

let playwright = null;
for (const from of [import.meta.url, join(process.cwd(), "package.json")]) { try { playwright = createRequire(from)("playwright"); break; } catch { /* not installed */ } }

const NEW = { id: "22222222-2222-4222-8222-222222222222", name: "Bakery", url: "https://bakery.test/", status: "connecting", mode: "url" };

test("the brief covers every question the dossier can ask", async () => {
  const { buildDossier } = await import("../src/god/onboarding.mjs");
  const d = buildDossier({ site: { url: "https://x.test/" }, discovered: { topics: ["a", "b"] } });
  const keys = new Set(BRIEF.map((b) => b.key));
  for (const q of d.questions) assert.ok(keys.has(q.key), `brief has ${q.key}`);
  assert.equal(keys.size, BRIEF.length, "unique keys");
});

test("adding a website opens the business brief; save sends every field once; later edits are prefilled", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const html = { body: "" }, calls = []; let sites = [];
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "jwt", refresh_token: "r", expires_in: 3600, user: { email: "a@x.test" } });
    const fn = u.pathname.split("/").pop(), b = JSON.parse(body || "{}"); calls.push({ fn, b });
    if (fn === "my_sites") return send(200, sites.map((s) => ({ site: s, data: null, decisions: [] })));
    if (fn === "my_org") return send(200, { id: "org-a", name: "Agency A", role: "owner" });
    if (fn === "add_site_by_url") { sites = [NEW]; return send(200, { id: NEW.id }); }
    if (fn === "site_brief") return send(200, { answers: calls.some((c) => c.fn === "save_brief") ? { goals: "More wholesale orders" } : {}, asked: ["goals", "competitors"], scanned: false });
    if (fn === "save_brief") return send(200, { saved: 2, cleared: 0 });
    if (fn === "god_console") return send(200, { strategy: null, questions: [{ key: "competitors", question: "q", why: "w" }], answers: [{ key: "goals", value: "More wholesale orders" }], waiting: [], escalated: [], active: [], recent: [], costs: { today: 0, month: 0 }, lessons: [], experiments: [] });
    if (["site_integrations", "site_deployments", "site_activity"].includes(fn)) return send(200, fn === "site_activity" ? null : []);
    send(200, []);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-brief-"));
  build({ url: base, key: "sb_publishable_test", out }); html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); server.close(); });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/#/login`); await page.fill("input[name=email]", "a@x.test"); await page.fill("input[name=password]", "correct-horse-battery");
  await page.click("button[type=submit]"); await page.waitForSelector("#rail nav");
  // Add a website: the next page is the brief, not the dashboard.
  await page.goto(`${base}/#/add`); await page.fill("#url-form input[name=url]", "bakery.test"); await page.click("#url-form button");
  await page.waitForSelector("h1:has-text('Tell us about the business')");
  assert.match(page.url(), /\/brief$/);
  assert.equal(await page.locator("#brief-form textarea").count(), BRIEF.length, "every question on one form");
  assert.equal(await page.locator("#brief-form .pill:has-text('the site does not say')").count(), 2, "fields the scan could not answer are marked");
  assert.match(await page.textContent("#page"), /Everything here is optional/);
  await page.fill('textarea[name="goals"]', "  More wholesale orders ");
  await page.fill('textarea[name="competitors"]', "rival-bakery.test");
  await page.click("#brief-form button[type=submit]");
  await page.waitForFunction(() => location.hash.endsWith("/overview"));
  const save = calls.find((c) => c.fn === "save_brief");
  assert.equal(save.b.p_site, NEW.id);
  assert.deepEqual(Object.keys(save.b.p_answers).sort(), BRIEF.map((x) => x.key).sort(), "all fields sent in one call");
  assert.equal(save.b.p_answers.goals, "More wholesale orders", "trimmed");
  assert.equal(save.b.p_answers.contact_phone, "", "blank stays blank");
  // Later: from the SEO God page to the brief, prefilled, back to SEO God after saving.
  await page.goto(`${base}/#/s/${NEW.id}/god`); await page.waitForSelector('.card:has(h2:has-text("Business brief"))');
  assert.match(await page.textContent('.card:has(h2:has-text("Business brief"))'), /1 of 10 answered · 1 the site itself does not answer/);
  await page.click('.card:has(h2:has-text("Business brief")) a');
  await page.waitForSelector("h1:has-text('Business brief')");
  assert.equal(await page.inputValue('textarea[name="goals"]'), "More wholesale orders");
  assert.equal(await page.locator("text=Skip for now").count(), 0, "skip only while onboarding");
  await page.click("#brief-form button[type=submit]");
  await page.waitForFunction(() => location.hash.endsWith("/god"));
  assert.deepEqual(errors, []);
});
