import { test } from "node:test";
import assert from "node:assert/strict";
import { urlProblem, isBlockedIPv4, isBlockedIPv6, guardedFetch } from "../src/hosted/safe-fetch.mjs";
import { scanSite } from "../src/hosted/scan.mjs";

test("urlProblem refuses private, reserved, internal and odd addresses", () => {
  for (const u of ["http://127.0.0.1/", "http://10.1.2.3/", "http://169.254.169.254/latest/meta-data/", "http://192.168.1.1/", "http://172.20.0.1/",
    "http://100.64.0.1/", "http://0.0.0.0/", "http://[::1]/", "http://[fd00::1]/", "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/",
    "http://localhost/", "http://db.internal/", "http://printer.local/", "http://metadata.google.internal/", "http://2130706433/",
    "http://0x7f000001/", "http://127.1/", "ftp://a.com/", "file:///etc/passwd", "https://a.com:8443/", "https://user:pw@a.com/", "http://intranet/"]) {
    assert.ok(urlProblem(u), `should refuse ${u}`);
  }
  for (const u of ["https://example.com/", "http://www.example.co.uk/a?b=1", "https://8.8.8.8/", "https://a.com:443/"]) assert.equal(urlProblem(u), "", u);
});

test("IP range helpers", () => {
  assert.ok(isBlockedIPv4("172.31.255.255") && !isBlockedIPv4("172.32.0.1") && !isBlockedIPv4("1.1.1.1"));
  assert.ok(isBlockedIPv6("::ffff:10.0.0.1") && !isBlockedIPv6("2606:4700::1111"));
});

test("guardedFetch checks every redirect hop and DNS answers", async () => {
  const calls = [];
  const fake = async (u) => {
    calls.push(String(u));
    if (String(u) === "https://good.example/") return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } });
    if (String(u) === "https://ok.example/") return new Response("hello", { status: 200 });
    return new Response("?", { status: 404 });
  };
  const f = guardedFetch(fake, { resolve: async (h) => (h === "rebind.example" ? ["10.0.0.5"] : ["93.184.216.34"]) });
  await assert.rejects(f("https://good.example/"), /private or reserved/);
  assert.deepEqual(calls, ["https://good.example/"], "the internal hop is never requested");
  await assert.rejects(f("https://rebind.example/"), /resolves to private address 10\.0\.0\.5/);
  assert.equal(await (await f("https://ok.example/")).text(), "hello");
  // With redirect: "manual" (the crawler follows hops itself) the 302 comes back, and the next hop is checked on its own call.
  assert.equal((await f("https://good.example/", { redirect: "manual" })).status, 302);
});

test("guardedFetch caps large bodies", async () => {
  const big = async () => new Response("x".repeat(5000), { status: 200 });
  assert.equal((await (await guardedFetch(big, { maxBytes: 1000 })("https://a.example/")).text()).length, 1000);
  const declared = async () => new Response("x", { status: 200, headers: { "content-length": "999999999" } });
  await assert.rejects(guardedFetch(declared, { maxBytes: 1000 })("https://a.example/"), /larger than/);
});

test("scanSite refuses internal addresses and sites whose robots.txt disallows everything", async () => {
  await assert.rejects(scanSite({ id: "x", name: "x", url: "http://169.254.169.254/" }, { resolve: null }), /address refused/);
  const fetchImpl = async (u) => String(u).endsWith("/robots.txt") ? new Response("User-agent: *\nDisallow: /", { status: 200 }) : new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
  await assert.rejects(scanSite({ id: "y", name: "y", url: "https://private-site.example/" }, { fetchImpl, resolve: null }), /robots\.txt asks crawlers not to read/);
});

test("scanSite skips pages robots.txt disallows", async () => {
  const pages = { "https://s.example/": '<html><a href="/private/x">p</a><a href="/open">o</a></html>', "https://s.example/open": "<html>o</html>", "https://s.example/private/x": "<html>secret</html>" };
  const seen = [];
  const fetchImpl = async (u, o = {}) => {
    u = String(u); seen.push(u);
    if (u.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private/", { status: 200 });
    if (pages[u]) return new Response(o.method === "HEAD" ? null : pages[u], { status: 200, headers: { "content-type": "text/html" } });
    return new Response("no", { status: 404, headers: { "content-type": "text/html" } });
  };
  const r = await scanSite({ id: "s", name: "s", url: "https://s.example/" }, { fetchImpl, resolve: null });
  assert.ok(!seen.includes("https://s.example/private/x"), "disallowed page is never fetched");
  assert.ok(r.audit.pages.some((p) => p.url === "https://s.example/open"));
});
