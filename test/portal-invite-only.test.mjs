// Invite-only sign-up (Q8) in real Chromium against a stand-in for Supabase Auth: the database refuses an email without
// a pending invite and Supabase reports a generic database error; the portal explains it plainly. An invited email
// signs up as before. Skipped when Playwright is not installed.
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

const INVITED = "invited@agency.test";
function fake() {
  const html = { body: "" };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/signup") {
      const b = JSON.parse(body || "{}");
      // What Supabase Auth returns when a database trigger refuses the new user.
      if (b.email !== INVITED) return send(500, { code: 500, error_code: "unexpected_failure", msg: "Database error saving new user" });
      return send(200, { access_token: "jwt", refresh_token: "r", expires_in: 3600, user: { email: INVITED } });
    }
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop();
      if (fn === "my_sites" || fn === "client_sites") return send(200, []);
      if (fn === "my_org") return send(200, { id: "org-a", name: "Agency A", role: "member" });
    }
    send(404, { message: "not found" });
  });
  return { server, html };
}

test("sign-up: an uninvited email gets a plain explanation; an invited one gets in", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const f = fake();
  await new Promise((r) => f.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${f.server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-invite-"));
  build({ url: base, key: "sb_publishable_test", out }); f.html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); f.server.close(); });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/#/signup`);
  assert.ok((await page.textContent("#page")).includes("Use the email address your invitation was sent to."));
  await page.fill("input[name=email]", "stranger@nowhere.test"); await page.fill("input[name=password]", "correct-horse-battery"); await page.click("button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#login-err")?.textContent.length > 0);
  const msg = await page.textContent("#login-err");
  assert.match(msg, /invitation only/); assert.ok(!/database error/i.test(msg), "no raw database error shown");
  await page.fill("input[name=email]", INVITED); await page.click("button[type=submit]");
  await page.waitForSelector("#rail nav");
  assert.deepEqual(errors, []);
});
