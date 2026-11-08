// Regression tests for the independent security review of 2026-11-08 (D34). Database-side fixes are in rls12.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { discoverSite } from "../src/analysis/discover.mjs";
import { makeAgentHandler } from "../src/god/agent-runner.mjs";
import { makeSearchConsoleHandler } from "../src/god/search-console.mjs";
import { MemoryStore } from "../src/god/stores.mjs";

test("finding 3: a javascript: address in a site's structured data never becomes a social link or logo", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "Organization", name: "X", logo: "javascript:alert(1)", sameAs: ["javascript://facebook.com/%0aalert(document.domain)", "https://facebook.com/realpage", "data:text/html,alert(1)"] })}</script>`;
  const d = discoverSite({ siteUrl: "https://x.test/", docs: [{ url: "https://x.test/", html }] });
  assert.deepEqual(d.socials.map((s) => s.value), ["https://facebook.com/realpage"]);
  assert.equal(d.logo ?? null, null);
});

test("finding 3: the portal's link helper allows only http(s)", () => {
  const html = readFileSync(new URL("../cloud/portal/app/index.html", import.meta.url), "utf8");
  const src = html.match(/const esc = [^\n]+\n/)[0] + html.match(/const safeHref = [^\n]+\n/)[0];
  const ctx = {}; vm.runInNewContext(`${src}; this.safeHref = safeHref;`, ctx);
  assert.equal(ctx.safeHref("javascript://facebook.com/%0aalert(1)"), "#");
  assert.equal(ctx.safeHref(" javascript:alert(1)"), "#");
  assert.equal(ctx.safeHref("data:text/html,x"), "#");
  assert.equal(ctx.safeHref('https://a.test/"onmouseover="x'), "https://a.test/&quot;onmouseover=&quot;x");
  assert.doesNotMatch(html, /href="\$\{esc\(/, "every link from site data goes through safeHref");
});

test("finding 2: the site's daily budget caps every paid run, whoever created the job", async () => {
  const store = new MemoryStore(); let called = 0;
  const h = makeAgentHandler({ store, siteOf: async () => ({ id: "A", url: "https://a.test/" }), apiKey: "k", fetchImpl: async () => { called++; return new Response("{}"); }, promptOf: () => "You are an agent.", dailyRemaining: async () => 0.01 });
  const out = await h({ siteId: "A", kind: "agent:seo-strategist", inputs: { agent: "seo-strategist" }, budgetUsd: 5 }, { budgetUsd: 5 });
  assert.match(out.escalate, /daily budget is used up/);
  assert.equal(called, 0, "no model call, nothing spent");
});

test("finding 1: Search Console is never read for a site a platform admin has not confirmed", async () => {
  const store = new MemoryStore(); let calls = 0;
  store.writeMemory("A", [{ kind: "experiment", key: "exp:j", value: { job: "j", agent: "a", openedAt: "2026-10-01T00:00:00Z", status: "open", items: [{ url: "a.test/x", href: "https://a.test/x", status: "open" }] }, basis: "verified" }]);
  const h = makeSearchConsoleHandler({ store, siteOf: async () => ({ id: "A", url: "https://a.test/" }), getToken: async () => { calls++; return "t"; }, fetchImpl: async () => { calls++; return new Response("{}"); }, now: () => "2026-11-08T00:00:00Z", allowed: async () => false });
  const out = await h({ siteId: "A" });
  assert.match(out.evidence[0], /not confirmed/);
  assert.equal(calls, 0, "no token, no Google request");
});
