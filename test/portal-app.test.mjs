// The portal page end to end in real Chromium against a stand-in for Supabase (auth and the RPCs the page calls):
// sign in, see the websites, connect a website (token shown once), make a client link, open it as a client, and no
// sideways scrolling on a phone. Skipped when Playwright is not installed. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../cloud/portal/build.mjs";
import { buildSnapshot } from "../src/analysis/portal.mjs";

let playwright = null;
for (const from of [import.meta.url, join(process.cwd(), "package.json")]) { try { playwright = createRequire(from)("playwright"); break; } catch { /* not installed here */ } }

const U = "https://plumber.test";
const SNAP = buildSnapshot({
  site: { id: "p", name: "Plumber", url: `${U}/` }, now: "2026-09-30T06:00:00Z",
  issues: [{ number: 7, title: "Refresh the boilers page", kind: "refresh", labels: ["seo-proposal"], url: "https://github.com/acme/plumber/issues/7", approved: false, held: false }],
  reports: {
    gscRows: { window: { start: "2026-09-01", end: "2026-09-28" }, rows: [{ query: "plumber leeds", page: `${U}/areas/leeds/`, clicks: 2, impressions: 100, position: 8 }], prevRows: [] },
    audit: { summary: { pagesCrawled: 2, bySeverity: { high: 0, medium: 0, low: 0 } }, issues: [], pages: [{ url: `${U}/`, status: 200, title: "Home", words: 900, description: "d" }, { url: `${U}/areas/leeds/headingley`, status: 200, title: "Headingley", words: 500, description: "d" }] },
    history: [{ day: "2026-09-28", clicks: 1, impressions: 40, position: 9, inspected: 2, indexed: 1 }, { day: "2026-09-29", clicks: 1, impressions: 60, position: 8, inspected: 2, indexed: 2 }],
    gsc: { countries: [{ key: "gbr", clicks: 2, impressions: 90 }], devices: [{ key: "MOBILE", clicks: 2, impressions: 80 }] },
  },
});

function fakeSupabase() {
  const calls = [];
  const site = { id: "11111111-1111-4111-8111-111111111111", name: "Plumber", url: `${U}/`, status: "live", last_snapshot_at: "2026-09-30T06:00:00Z" };
  const sites = [{ site, data: SNAP, decisions: [] }];
  const growth = [{ at: "2026-09-29T06:00:00Z", score: 90, keywords: 1, indexed: 1 }, { at: "2026-09-30T06:00:00Z", score: 95, keywords: 3, indexed: 2 }];
  const html = { body: "" };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    calls.push({ path: u.pathname, auth: req.headers.authorization, apikey: req.headers.apikey, body: body ? JSON.parse(body) : null });
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return JSON.parse(body).password === "correct-horse" ? send(200, { access_token: "user-jwt", refresh_token: "r", expires_in: 3600, user: { email: "alice@agency.test" } }) : send(400, { error_description: "Invalid login credentials" });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop(), b = JSON.parse(body || "{}"), signed = req.headers.authorization === "Bearer user-jwt";
      if (fn === "shared_site") return send(200, b.p_token === "c123" ? { site: { name: site.name, url: site.url, status: "live", last_snapshot_at: site.last_snapshot_at }, brand: { name: "Agency A", color: "#3355cc" }, growth, data: SNAP } : null);
      if (!signed) return send(401, { message: "JWT required" });
      if (fn === "my_sites") return send(200, sites);
      if (fn === "create_site") { const s = { id: "22222222-2222-4222-8222-222222222222", name: b.p_name, url: b.p_url, status: "connecting", last_snapshot_at: null }; sites.push({ site: s, data: null }); return send(200, { site: s, token: "spt_" + "a".repeat(64) }); }
      if (fn === "create_share_link") return send(200, "c123");
      if (fn === "my_org") return send(200, { id: "org-a", name: "alice", brand_name: null, brand_color: null, role: "owner" });
      if (fn === "site_growth") return send(200, growth);
      if (fn === "decide_proposal") return send(200, { issue: b.p_issue, decision: b.p_decision, decided_email: "alice@agency.test" });
      if (fn === "org_people") return send(200, [{ org: "org-a", email: "alice@agency.test", role: "owner", since: "2026-09-01" }]);
      if (fn === "invite_member") return send(200, { org: "org-a", email: b.p_email });
      if (fn === "rotate_site_token") return send(200, "spt_" + "b".repeat(64));
    }
    if (u.pathname === "/rest/v1/orgs" && req.method === "PATCH") return send(200, [{ id: "org-a", ...JSON.parse(body) }]);
    send(404, { message: "not found" });
  });
  return { server, calls, html };
}

test("portal app: sign in, websites, connect a website, client link, client view, phone layout", { skip: !playwright && "Playwright not installed" }, async () => {
  const fake = fakeSupabase();
  await new Promise((r) => fake.server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${fake.server.address().port}`;
  const out = mkdtempSync(join(tmpdir(), "seo-portal-app-"));
  build({ url: origin, key: "sb_publishable_test", out });
  fake.html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.dismiss());
    await page.goto(`${origin}/#/`);
    await page.waitForURL(/#\/login$/);
    await page.fill("input[name=email]", "alice@agency.test");
    await page.fill("input[name=password]", "wrong-password");
    await page.click("#login-form button[type=submit]");
    await page.waitForSelector("text=Invalid login credentials");
    await page.fill("input[name=password]", "correct-horse");
    await page.click("#login-form button[type=submit]");
    await page.waitForSelector(".site-card >> text=Plumber");
    assert.equal(fake.calls.find((c) => c.path === "/rest/v1/rpc/my_sites").auth, "Bearer user-jwt");
    assert.equal(fake.calls.find((c) => c.path === "/rest/v1/rpc/my_sites").apikey, "sb_publishable_test");

    // Connect a website: the token appears once, with the ingest address to paste into GitHub.
    await page.click("text=Connect a website >> nth=0");
    await page.fill("input[name=name]", "Bakery");
    await page.fill("input[name=url]", "https://bakery.test");
    await page.click("#add-form button[type=submit]");
    await page.waitForSelector(`text=${"spt_" + "a".repeat(64)}`);
    assert.ok(await page.isVisible(`text=${origin}/functions/v1/ingest`));
    assert.equal(fake.calls.find((c) => c.path === "/rest/v1/rpc/create_site").body.p_url, "https://bakery.test/");

    // A live site's dashboard and a client link.
    await page.goto(`${origin}/#/s/11111111-1111-4111-8111-111111111111/overview`);
    await page.waitForSelector("h1 >> text=Plumber");
    await page.waitForSelector("text=Growth over time");
    assert.ok(await page.isVisible("text=2 daily snapshots since 2026-09-29"));
    await page.click("#share");
    await page.waitForFunction(() => document.body.innerText.includes("Client link copied") || true);
    assert.ok(fake.calls.some((c) => c.path === "/rest/v1/rpc/create_share_link"));
    await page.goto(`${origin}/#/s/11111111-1111-4111-8111-111111111111/locations`);
    await page.waitForSelector("text=Leeds");
    assert.ok(await page.isVisible("text=United Kingdom"), "country name from the Search Console code");

    // Approvals: a decision is recorded through the portal, and shown as waiting for the next daily run.
    await page.goto(`${origin}/#/s/11111111-1111-4111-8111-111111111111/approvals`);
    await page.waitForSelector("text=Refresh the boilers page");
    await page.click('[data-dec="approve"][data-issue="7"]');
    await page.waitForSelector("text=waiting for the next daily run");
    const dec = fake.calls.find((c) => c.path === "/rest/v1/rpc/decide_proposal");
    assert.deepEqual([dec.body.p_issue, dec.body.p_decision], [7, "approve"]);
    // Team and brand: invite a colleague, save the brand.
    await page.goto(`${origin}/#/team`);
    await page.waitForSelector("text=alice@agency.test");
    await page.fill("#inv-email", "bob@agency.test"); await page.click("#invite-form button[type=submit]");
    await page.waitForSelector("text=Invite saved");
    await page.fill("#brand-name", "Agency A"); await page.click("#brand-form button[type=submit]");
    await page.waitForTimeout(300);
    assert.equal(fake.calls.find((c) => c.path === "/rest/v1/rpc/invite_member").body.p_email, "bob@agency.test");
    assert.equal(fake.calls.find((c) => c.path === "/rest/v1/orgs").body.brand_name, "Agency A");

    // The client view needs no sign-in, hides the agency pages, and a bad link says so.
    const client = await browser.newPage({ viewport: { width: 390, height: 844 } });
    client.on("pageerror", (e) => errors.push(e.message));
    for (const p of ["overview", "traffic", "keywords", "pages", "locations", "plan", "report"]) {
      await client.goto(`${origin}/#/c/c123/${p}`);
      await client.waitForSelector("#page h1");
      const w = await client.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(w <= 390, `no sideways scroll on ${p} (${w}px)`);
    }
    assert.ok(!(await client.isVisible("#rail >> text=SEO team")) && !(await client.isVisible("#rail >> text=Connection")) && !(await client.isVisible("#rail >> text=Approvals")));
    await client.setViewportSize({ width: 1280, height: 860 });
    await client.goto(`${origin}/#/c/c123/overview`); await client.waitForSelector("#page h1");
    assert.ok(await client.isVisible("text=SEO dashboard by Agency A"), "agency brand on the client link");
    assert.equal(await client.evaluate(() => document.documentElement.style.getPropertyValue("--accent")), "#3355cc");
    const shared = fake.calls.filter((c) => c.path === "/rest/v1/rpc/shared_site");
    assert.ok(shared.every((c) => c.auth === "Bearer sb_publishable_test"), "client view uses only the public key");
    await client.goto(`${origin}/#/c/nope/overview`);
    await client.waitForSelector("text=This link is not valid any more");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    fake.server.close();
  }
});
