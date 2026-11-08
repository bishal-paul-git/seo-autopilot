// Changes to the website through GitHub (D37) on the SEO God page, in real Chromium against a stand-in for Supabase:
// an owner connects a repository (the token is sent once and cleared from the page), turns accepted advice into a work
// order, sees the exact work order to approve and the pull request and verification afterwards; members cannot connect;
// links from stored data are safe; it fits a phone. Skipped when Playwright is not installed. No network.
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
const WO = { title: "SEO: Shorten the home page title", kind: "seo-snippet", url: "https://plumber.test/", body: "Approved by the agency in SEO Autopilot.\n\n> <script>window.__pwned=1</script>", labels: ["seo-proposal", "seo-snippet", "seo-hosted"] };
const consoleData = () => ({
  strategy: { status: "approved", firstSteps: [] }, questions: [], answers: [], facts: 3,
  waiting: [{ id: "j-impl", kind: "implement", title: "Implement: shorten title", risk: "medium", stage: "result", outputs: { proposal: { workOrder: WO } }, costUsd: 0 }],
  escalated: [], active: [],
  recent: [{ id: "j-advice", kind: "agent:title-tuner", title: "Fix titles", status: "completed", costUsd: 0.05, updatedAt: "2026-11-08T01:00:00Z",
    outputs: { proposal: { summary: "One title is long.", recommendations: [{ title: "Shorten the home page title", url: "https://plumber.test/", why: "71 characters", evidence: ["audit"], effort: "small" }, { title: "Add a title to /x", url: "https://plumber.test/x", why: "missing", evidence: [], effort: "small" }] } } }],
  costs: { today: 0, month: 0 }, lessons: [], experiments: [],
});

function fake({ role = "owner" } = {}) {
  const calls = [], html = { body: "" }, state = { connected: false };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(html.body); }
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "user-jwt", refresh_token: "r", expires_in: 3600, user: { email: "alice@agency.test" } });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop(), b = JSON.parse(body || "{}");
      calls.push({ fn, b });
      if (fn === "my_sites") return send(200, [{ site: SITE, data: null, decisions: [] }]);
      if (fn === "my_org") return send(200, { id: "org-a", name: "alice", role });
      if (fn === "god_console") return send(200, consoleData());
      if (fn === "site_integrations") return send(200, state.connected ? [{ provider: "github", scope: "write", status: "connected", repo: "acme/plumber", lastOkAt: "2026-11-08T02:00:00Z", lastError: null }] : []);
      if (fn === "site_deployments") return send(200, state.connected ? [
        { id: "d1", title: "Implement: add title", status: "verifying", page: "https://plumber.test/x", issue: 41, issueUrl: "https://github.com/acme/plumber/issues/41", pr: 7, prUrl: "javascript:alert(1)", verification: null },
        { id: "d2", title: "Implement: fix h1", status: "completed", page: "https://plumber.test/", issue: 40, issueUrl: "https://github.com/acme/plumber/issues/40", pr: 6, prUrl: "https://github.com/acme/plumber/pull/6", verification: "verified: 1 of 1 problems on https://plumber.test/ fixed (h1-missing)" }] : []);
      if (fn === "connect_github") { if (!/^github_pat_/.test(b.p_token)) return send(400, { message: "that does not look like a GitHub token" }); state.connected = true; return send(200, { provider: "github", repo: b.p_repo, status: "connected" }); }
      if (fn === "disconnect_github") { state.connected = false; return send(200, { status: "revoked" }); }
      if (["request_implementation", "approve_job"].includes(fn)) return send(200, { ok: true });
    }
    send(404, { message: "not found" });
  });
  return { server, calls, html, state };
}

async function open(t, opts) {
  const f = fake(opts);
  await new Promise((r) => f.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${f.server.address().port}`, out = mkdtempSync(join(tmpdir(), "portal-gh-"));
  build({ url: base, key: "sb_publishable_test", out }); f.html.body = readFileSync(join(out, "index.html"), "utf8");
  const browser = await playwright.chromium.launch().catch(() => playwright.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
  t.after(async () => { await browser.close(); f.server.close(); });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/#/login`); await page.fill("input[name=email]", "alice@agency.test"); await page.fill("input[name=password]", "correct-horse");
  await page.click("button[type=submit]"); await page.waitForSelector("text=Plumber");
  await page.goto(`${base}/#/s/${SITE.id}/god`); await page.waitForSelector("h2:has-text('Changes to the website')");
  return { page, f, errors };
}
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); };

test("owner: connect GitHub, prepare a pull request from accepted advice, see the work order, follow the pull request", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, f, errors } = await open(t);
  let text = await page.textContent("#page");
  assert.ok(text.includes("Advice only") && text.includes("Connect GitHub"));
  assert.equal(await page.locator("[data-impl]").count(), 0, "no pull request buttons before GitHub is connected");
  // The exact work order waiting for approval is shown as text, never run.
  assert.ok(text.includes("Work order for GitHub") && text.includes("SEO: Shorten the home page title"));
  assert.ok(text.includes("<script>window.__pwned=1</script>"), "work order shown literally");
  // A bad token is refused and cleared from the field.
  await page.fill("#gh-repo", "acme/plumber"); await page.fill("#gh-token", "nope-not-a-token-at-all");
  await page.click("#gh-form button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#gh-err")?.textContent.includes("does not look"));
  assert.equal(await page.inputValue("#gh-token"), "", "token cleared after a failure");
  await page.fill("#gh-token", "github_pat_" + "a".repeat(30));
  await page.click("#gh-form button[type=submit]");
  await page.waitForSelector('a:has-text("pull request #6")'); // the reloaded page, not the toast
  const con = f.calls.filter((c) => c.fn === "connect_github").at(-1);
  assert.deepEqual(con.b, { p_site: SITE.id, p_repo: "acme/plumber", p_token: "github_pat_" + "a".repeat(30) });
  text = await page.textContent("#page");
  assert.ok(!text.includes("github_pat_"), "the token is never shown");
  // Deployments: issue and pull request links, verification; an unsafe stored link is neutralised.
  assert.ok(text.includes("merged: verifying with the next scan") && text.includes("verified: 1 of 1 problems"));
  assert.equal(await page.getAttribute('a:has-text("pull request #7")', "href"), "#");
  assert.equal(await page.getAttribute('a:has-text("pull request #6")', "href"), "https://github.com/acme/plumber/pull/6");
  // Accepted advice: one button per recommendation.
  await page.click("summary:has-text('Show result')");
  assert.equal(await page.locator("[data-impl]").count(), 2);
  await page.click('[data-impl="j-advice"][data-idx="1"]');
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Work order requested"));
  assert.deepEqual(f.calls.find((c) => c.fn === "request_implementation").b, { p_job: "j-advice", p_index: 1 });
  // Phone layout.
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "fits a phone");
  // Disconnect.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click("#gh-disconnect");
  await until(() => f.calls.some((c) => c.fn === "disconnect_github"));
  await page.waitForSelector("#gh-form");
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.deepEqual(errors, []);
});

test("member: sees the status but cannot connect GitHub", { skip: !playwright && "Playwright not installed" }, async (t) => {
  const { page, errors } = await open(t, { role: "member" });
  assert.equal(await page.locator("#gh-form").count(), 0);
  assert.ok((await page.textContent("#page")).includes("An owner of the agency can connect it."));
  assert.deepEqual(errors, []);
});
