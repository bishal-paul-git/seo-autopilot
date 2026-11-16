// D63: the agency closes stopped work from the SEO God page ("Needs a person" › Dismiss). Real Chromium against a
// stand-in for Supabase: the button asks first, sends nothing when the agency says no, and calls dismiss_job (migration
// 20261124000000) with the job id when it says yes, then reloads the console. Skipped when Playwright is not installed.
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

const SITE = { id: "11111111-1111-4111-8111-111111111111", name: "Plumber", url: "https://plumber.test/", status: "live", mode: "url", last_snapshot_at: null };

function fake() {
  const calls = [], html = { body: "" }, state = { dismissed: false };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "user-jwt", refresh_token: "r", expires_in: 3600, user: { email: "alice@agency.test" } });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop(), b = JSON.parse(body || "{}");
      calls.push({ fn, b, auth: req.headers.authorization });
      if (req.headers.authorization !== "Bearer user-jwt") return send(401, { message: "JWT required" });
      if (fn === "my_sites") return send(200, [{ site: SITE, data: null, decisions: [] }]);
      if (fn === "my_org") return send(200, { id: "org-a", name: "alice", role: "owner" });
      if (fn === "god_console") return send(200, { strategy: null, questions: [], answers: [], waiting: [], active: [], recent: [], costs: { today: 0, month: 0 }, lessons: [], experiments: [],
        escalated: state.dismissed ? [] : [{ id: "j-esc", kind: "agent:seo-reporter", title: "Weekly report", error: "the fact-checker failed it", attempts: 1 }] });
      if (fn === "dismiss_job") { state.dismissed = true; return send(200, { id: b.p_job, status: "cancelled" }); }
    }
    send(404, { message: "not found" });
  });
  return { server, calls, html };
}

test("SEO God: Dismiss closes stopped work after a confirmation, through dismiss_job", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const f = fake();
  await new Promise((r) => f.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${f.server.address().port}`;
  const out = mkdtempSync(join(tmpdir(), "portal-dismiss-"));
  build({ url: base, key: "sb_publishable_test", out });
  f.html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); f.server.close(); });
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/#/login`);
  await page.fill("input[name=email]", "alice@agency.test"); await page.fill("input[name=password]", "correct-horse");
  await page.click("button[type=submit]"); await page.waitForSelector("text=Plumber");
  await page.goto(`${base}/#/s/${SITE.id}/god`);
  await page.waitForSelector('[data-dismiss="j-esc"]');
  assert.ok((await page.textContent('.card:has(h2:has-text("Needs a person"))')).includes("the fact-checker failed it"));

  // The agency says no: nothing is sent.
  const asked = [];
  page.once("dialog", (d) => { asked.push(d.message()); d.dismiss(); });
  await page.click('[data-dismiss="j-esc"]');
  await page.waitForTimeout(200);
  assert.match(asked[0] || "", /Dismiss this work\? .*cancelled/);
  assert.equal(f.calls.filter((c) => c.fn === "dismiss_job").length, 0, "no call without confirmation");

  // The agency says yes: dismiss_job with the job id, signed in, then the console reloads without the job.
  page.once("dialog", (d) => d.accept());
  await page.click('[data-dismiss="j-esc"]');
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Dismissed"));
  const call = f.calls.find((c) => c.fn === "dismiss_job");
  assert.deepEqual(call.b, { p_job: "j-esc", p_note: null });
  assert.equal(call.auth, "Bearer user-jwt");
  await page.waitForSelector('.card:has(h2:has-text("Needs a person")) .empty');
  assert.equal(await page.locator("[data-dismiss]").count(), 0);
  assert.deepEqual(errors, []);
});
