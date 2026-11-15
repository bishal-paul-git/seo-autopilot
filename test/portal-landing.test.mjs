// Landing page and invite requests (D59) in real Chromium against a stand-in for Supabase: a logged-out visitor on #/
// sees the landing page (already in the HTML, with title, description, canonical and Open Graph tags), signs in from
// it, and requests an invite through the anon-callable request_invite; bad input is caught before any request and the
// server's message is shown; a signed-in agency still lands on its portfolio; a platform admin sees the requests on
// Operations and invites one. Fits a phone. The build writes robots.txt and sitemap.xml. Skipped without Playwright.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, crawlFiles } from "../cloud/portal/build.mjs";

let playwright = null;
for (const from of [import.meta.url, join(process.cwd(), "package.json")]) { try { playwright = createRequire(from)("playwright"); break; } catch { /* not installed */ } }

const REQUESTS = [
  { id: 7, name: "Dana <b>Owner</b>", email: "dana@shop.test", company: "shop.test", sites: "2-5", note: "We run <i>three</i> shops.", status: "new", repeats: 1, createdAt: new Date(Date.now() - 3600e3).toISOString(), hasAccount: false },
  { id: 3, name: "Old", email: "old@x.test", company: "x.test", sites: "1", note: null, status: "declined", repeats: 0, createdAt: "2026-11-01T00:00:00Z", decidedBy: "admin@x.test", hasAccount: false },
];
function fake({ admin = false } = {}) {
  const calls = [], html = { body: "" };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "jwt", refresh_token: "r", expires_in: 3600, user: { email: "a@x.test" } });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop(), b = JSON.parse(body || "{}"); calls.push({ fn, b, auth: req.headers.authorization });
      if (fn === "request_invite") {
        if (b.p_email === "busy@shop.test") return send(429, { message: "We have had a lot of requests in the last hour. Please try again later." });
        return send(200, { ok: true, message: "Thank you, your request is in. If we can invite you, we will email you at this address." });
      }
      if (fn === "my_sites") return send(200, [{ site: { id: "s1", name: "Plumber", url: "https://plumber.test/", status: "live", mode: "url", last_snapshot_at: "2026-11-14T00:00:00Z" }, data: null }]);
      if (fn === "my_org") return send(200, { id: "org-a", name: "Agency A", role: "owner" });
      if (fn === "client_sites") return send(200, []);
      if (fn === "my_notifications") return send(200, { items: [], unread: 0 });
      if (fn === "portfolio") return send(200, { sites: [{ site: "s1", name: "Plumber", url: "https://plumber.test/", status: "live", scorecard: {}, reasons: [], attention: 0, stale: [] }] });
      if (fn === "agency_overview") return send(200, []);
      if (fn === "ops_alerts") return send(200, []);
      if (["platform_health", "gsc_sites", "google_conflicts", "invite_requests_list"].includes(fn)) return admin ? send(200, fn === "invite_requests_list" ? REQUESTS : fn === "platform_health" ? { control: {}, usage: {}, runs: [] } : []) : send(400, { message: "not allowed" });
      if (fn === "decide_invite_request") { if (!admin) return send(400, { message: "not allowed" }); const r = REQUESTS.find((x) => x.id === b.p_id); r.status = b.p_decision; return send(200, { id: r.id, email: r.email, status: r.status }); }
      return send(200, null);
    }
    send(404, { message: "not found" });
  });
  return { server, calls, html };
}
async function start(t, opts) {
  const f = fake(opts);
  await new Promise((r) => f.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${f.server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-landing-"));
  build({ url: base, key: "sb_publishable_test", publicUrl: "https://seo.example.test", out }); f.html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); f.server.close(); });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  return { page, calls: f.calls, errors, base, out, html: f.html.body };
}

test("build: crawlable landing in the HTML, indexable, canonical and Open Graph, robots.txt and sitemap.xml", async () => {
  const out = mkdtempSync(join(tmpdir(), "portal-landing-build-"));
  build({ url: "https://abc.supabase.co", key: "sb_publishable_x", out });
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.ok(!/name="robots" content="noindex/.test(html), "the landing page may be indexed");
  assert.match(html, /<title>SEO Autopilot: an AI SEO team for every website you run<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{80,200}">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/seo\.erudience\.com\/">/);
  for (const p of ["og:type", "og:title", "og:description", "og:url", "og:site_name"]) assert.match(html, new RegExp(`property="${p}" content="[^"]+"`), p);
  assert.ok(!html.includes("__PUBLIC_URL__"));
  for (const s of ["<h1>An AI SEO team for every website you run</h1>", "How it works", "Give read access", "Approve the plan", "A win/loss scorecard for every change", "Read-only Google access", "A daily budget cap", "Request an invite", "Questions"]) assert.ok(html.includes(s), `in the HTML: ${s}`);
  assert.ok(!/<script[^>]*\bsrc=|<iframe|<img\b|googletagmanager|gtag\(|connect\.facebook/i.test(html), "no external scripts, frames, pixels or trackers");
  assert.equal(readFileSync(join(out, "robots.txt"), "utf8"), "User-agent: *\nDisallow: /previous-\nSitemap: https://seo.erudience.com/sitemap.xml\n");
  assert.match(readFileSync(join(out, "sitemap.xml"), "utf8"), /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\s*<url><loc>https:\/\/seo\.erudience\.com\/<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod><\/url>\s*<\/urlset>/);
  assert.match(crawlFiles("https://a.test/", "2026-01-02").sitemap, /<loc>https:\/\/a\.test\/<\/loc><lastmod>2026-01-02<\/lastmod>/);
  assert.throws(() => build({ publicUrl: "http://insecure.test", out }), /PORTAL_PUBLIC_URL/);
  assert.throws(() => build({ publicUrl: "https://a.test/path", out }), /PORTAL_PUBLIC_URL/);
});

test("logged out: #/ is the landing page; Sign in reaches the form; the honest claims are all there", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, errors, base } = await start(t);
  await page.goto(`${base}/#/`);
  await page.waitForSelector("#landing h1");
  assert.ok(await page.isVisible("#landing") && !(await page.isVisible("#app")), "landing shown, app hidden");
  assert.equal(await page.title(), "SEO Autopilot: an AI SEO team for every website you run");
  assert.equal(await page.getAttribute("link[rel=canonical]", "href"), "https://seo.example.test/");
  const text = await page.textContent("#landing");
  for (const s of ["waits for your approval on anything risky", "Add your website", "Give read access", "Approve the plan", "A portfolio of all your websites", "Same-day alerts", "A daily digest", "A person approves", "Pricing is not published"]) assert.ok(text.includes(s), `shows: ${s}`);
  assert.ok(!/\b\d{2,}\s*%|\bclients? (say|love)|testimonial|award|trusted by/i.test(text), "no invented numbers, testimonials or awards");
  await page.click("#lp-signin");
  await page.waitForSelector("#login-form");
  assert.ok(await page.isVisible("#app") && !(await page.isVisible("#landing")), "app shown for sign-in");
  assert.ok((await page.textContent("#page")).includes("Request an invite"), "the sign-in page links back to the request");
  await page.click("#page a[href='#request-invite']");
  await page.waitForSelector("#invite-request", { state: "visible" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "fits a phone");
  assert.deepEqual(errors, []);
});

test("request an invite: checks before sending, the server's answer, a honeypot, and the anon key only", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, calls, errors, base } = await start(t);
  await page.goto(`${base}/#request-invite`);
  await page.waitForSelector("#invite-request", { state: "visible" });
  const sends = () => calls.filter((c) => c.fn === "request_invite");
  const f = (n, v) => page.fill(`#invite-request [name=${n}]`, v);
  await page.click("#invite-request button[type=submit]");
  assert.match(await page.textContent("#invite-err"), /your name/);
  assert.equal(await page.getAttribute("#invite-request [name=name]", "aria-invalid"), "true");
  await f("name", "Dana Owner"); await f("email", "not-an-email"); await page.click("#invite-request button[type=submit]");
  assert.match(await page.textContent("#invite-err"), /valid email/);
  await f("email", "Dana@Shop.test"); await page.click("#invite-request button[type=submit]");
  assert.match(await page.textContent("#invite-err"), /company or website/);
  await f("company", "shop.test"); await page.click("#invite-request button[type=submit]");
  assert.match(await page.textContent("#invite-err"), /how many websites/);
  assert.equal(sends().length, 0, "nothing sent while the form is wrong");
  assert.equal(await page.getAttribute("#invite-request [name=note]", "maxlength"), "1000");
  assert.equal(await page.getAttribute("#invite-request [name=name]", "maxlength"), "100");

  // The server's refusal is shown as is; the form stays usable.
  await page.selectOption("#invite-request [name=sites]", "2-5");
  await f("email", "busy@shop.test"); await page.click("#invite-request button[type=submit]");
  await page.waitForFunction(() => /try again later/.test(document.querySelector("#invite-err").textContent));
  assert.ok(await page.isEnabled("#invite-request button[type=submit]"));

  await f("email", " Dana@Shop.test "); await f("note", "We run three shops."); await page.click("#invite-request button[type=submit]");
  await page.waitForSelector("#invite-box .callout.ok");
  assert.match(await page.textContent("#invite-box"), /your request is in/);
  const last = sends().at(-1);
  assert.deepEqual(last.b, { p_name: "Dana Owner", p_email: "dana@shop.test", p_company: "shop.test", p_sites: "2-5", p_note: "We run three shops.", p_trap: null });
  assert.equal(last.auth, "Bearer sb_publishable_test", "sent with the publishable key, no user token");
  assert.ok(!(await page.isVisible("#invite-request [name=homepage]")), "the honeypot is not visible");
  assert.deepEqual(errors, []);
});

test("signed in: #/ still opens the portfolio, not the landing", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, errors, base } = await start(t);
  await page.goto(`${base}/#/login`); await page.fill("#login-form input[name=email]", "a@x.test"); await page.fill("#login-form input[name=password]", "correct-horse-battery"); await page.click("#login-form button[type=submit]");
  await page.waitForSelector("h1:has-text('Portfolio')");
  assert.ok(!(await page.isVisible("#landing")));
  await page.reload(); await page.waitForSelector("h1:has-text('Portfolio')");
  assert.ok(!(await page.isVisible("#landing")), "no landing after a reload either");
  await page.goto(`${base}/#/logout`); await page.waitForSelector("#login-form");
  await page.goto(`${base}/#/`); await page.waitForSelector("#landing h1", { state: "visible" });
  assert.deepEqual(errors, []);
});

test("platform admin: invite requests on Operations, escaped, invite and copy", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, calls, errors, base } = await start(t, { admin: true });
  await page.goto(`${base}/#/login`); await page.fill("#login-form input[name=email]", "a@x.test"); await page.fill("#login-form input[name=password]", "correct-horse-battery"); await page.click("#login-form button[type=submit]");
  await page.waitForSelector("#rail nav"); await page.goto(`${base}/#/ops`); await page.waitForSelector("#invite-requests");
  const card = await page.textContent("#invite-requests");
  for (const s of ["Dana <b>Owner</b> · shop.test", "dana@shop.test", "2 to 5 websites", "asked again 1×", "We run <i>three</i> shops.", "1 new", "Declined", "declined by admin@x.test", "#/signup"]) assert.ok(card.includes(s), `shows: ${s}`);
  assert.equal(await page.locator("#invite-requests b", { hasText: /^Owner$/ }).count(), 0, "names stay text");
  await page.click("#invite-requests [data-irdec=invited][data-ir='7']");
  await page.waitForSelector("#invite-requests [data-ircopy='__signup__']");
  assert.deepEqual(calls.find((c) => c.fn === "decide_invite_request").b, { p_id: 7, p_decision: "invited" });
  assert.deepEqual(errors, []);
});

test("an agency member who is not a platform admin sees no invite requests", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, errors, base } = await start(t);
  await page.goto(`${base}/#/login`); await page.fill("#login-form input[name=email]", "a@x.test"); await page.fill("#login-form input[name=password]", "correct-horse-battery"); await page.click("#login-form button[type=submit]");
  await page.waitForSelector("#rail nav"); await page.goto(`${base}/#/ops`); await page.waitForSelector("h1:has-text('Operations')");
  assert.equal(await page.locator("#invite-requests").count(), 0);
  assert.deepEqual(errors, []);
});
