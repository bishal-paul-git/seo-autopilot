// Brief 01 item 2: the redirect map check, the server-rule generators and the live smoke test.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normPath, parseMap, checkRedirects, generate, waiting, replaceBlock, judge, smokePlan, BEGIN, END } from "../src/analysis/redirects.mjs";

const SITE = "https://s.test/";

test("paths are normalised; same-host URLs become paths, other hosts stay URLs, junk is refused", () => {
  assert.equal(normPath("/a/", SITE), "/a");
  assert.equal(normPath("a", SITE), "/a");
  assert.equal(normPath("https://s.test/a/b/", SITE), "/a/b");
  assert.equal(normPath("/", SITE), "/");
  assert.equal(normPath("https://other.test/x", SITE), "https://other.test/x");
  assert.equal(normPath("/has space", SITE), null);
  assert.equal(normPath("", SITE), null);
});

test("the map reads both shapes and reports unusable entries instead of dropping them", () => {
  const m = parseMap({ _note: "x", map: { "/old/": "/new", "/bad": "has space" }, gone: ["/retired", "https://other.test/x"] }, SITE);
  assert.deepEqual([...m.redirects], [["/old", "/new"]]);
  assert.deepEqual(m.gone, ["/retired"]);
  assert.deepEqual(m.bad, ["/bad -> has space", "https://other.test/x"]);
  assert.equal(parseMap({ redirects: { "/a": "/b" } }, SITE).redirects.get("/a"), "/b");
});

test("check: self-redirects, hidden live pages, chains, loops, dead and gone targets are errors; scheduled and external targets wait", () => {
  const m = parseMap({ redirects: {
    "/self": "/self", "/live": "/new", "/c1": "/c2", "/c2": "/new", "/l1": "/l2", "/l2": "/l1",
    "/dead": "/nowhere", "/togone": "/retired", "/soon": "/scheduled", "/ext": "https://other.test/x", "/ok": "/new",
  }, gone: ["/retired", "/live", "/ok"] }, SITE);
  const r = checkRedirects(m, new Set(["/", "/new", "/live"]), new Set(["/scheduled"]));
  const has = (re) => r.errors.some((e) => re.test(e));
  assert.ok(has(/^\/self redirects to itself/));
  assert.ok(has(/^\/live is a live page/));
  assert.ok(has(/^\/c1 -> \/c2: chain .*finally to \/new/));
  assert.ok(has(/^\/l1 -> \/l2: redirect loop/));
  assert.ok(has(/^\/dead -> \/nowhere: the target is not a page/));
  assert.ok(has(/^\/togone -> \/retired: the target is marked gone/));
  assert.ok(has(/^\/ok is both redirected and marked gone/));
  assert.ok(has(/^\/live is marked gone but is a live page/));
  assert.ok(r.warnings.some((w) => /^\/soon -> \/scheduled: .*scheduled/.test(w)));
  assert.ok(r.warnings.some((w) => /^\/ext -> https:\/\/other.test\/x: another site/.test(w)));
  assert.ok(!r.errors.some((e) => /^\/c2 /.test(e)), "the last hop of a chain is itself fine");
  assert.deepEqual(checkRedirects(parseMap({ redirects: { "/a": "/b" }, gone: ["/g"] }, SITE), new Set(["/b"])).errors, []);
});

test("retired sections: a live page inside one is an error, redirects into one are errors, the rules come after the redirects", () => {
  const m = parseMap({ redirects: { "/solutions/voice": "/services/voice", "/x": "/solutions/y" }, goneSections: ["/solutions/", "/"] }, SITE);
  assert.deepEqual(m.goneSections, ["/solutions"]);
  assert.deepEqual(m.bad, ["/"], "retiring the whole site is refused");
  const r = checkRedirects(m, new Set(["/", "/services/voice", "/solutions/kept"]));
  assert.ok(r.errors.includes("/solutions/kept is a live page inside the retired section /solutions"));
  assert.ok(r.errors.includes("/x -> /solutions/y: the target is in a retired section"));
  assert.ok(!r.errors.some((e) => e.startsWith("/solutions/voice ")), "a mapped page inside a retired section may redirect");
  const apache = generate(m, "apache").split("\n");
  assert.ok(apache.indexOf("RewriteRule ^solutions/voice/?$ /services/voice [R=301,L]") < apache.indexOf("RewriteRule ^(solutions)(/.*)?$ - [G,L]"));
  assert.match(generate(m, "nginx"), /location ~ \^\/\(solutions\)\(\/\.\*\)\?\$ \{ return 410; \}/);
  assert.ok(smokePlan(m).some((c) => c.path === "/solutions/seo-autopilot-check-not-a-page" && c.expect === "gone"));
});

test("generators: Apache and nginx include 410s, special characters are escaped, chains are left out", () => {
  const m = parseMap({ redirects: { "/old.html": "/new", "/x": "/y", "/y": "/z" }, gone: ["/gone(1)", "/gone2"] }, SITE);
  const apache = generate(m, "apache");
  assert.ok(apache.startsWith(BEGIN) && apache.endsWith(END));
  assert.match(apache, /RewriteRule \^old\\\.html\/\?\$ \/new \[R=301,L\]/);
  assert.match(apache, /RewriteRule \^\(gone\\\(1\\\)\|gone2\)\/\?\$ - \[G,L\]/);
  assert.ok(!/\^x\//.test(apache), "a chained rule is not written; the check reports it");
  const nginx = generate(m, "nginx");
  assert.match(nginx, /location ~ \^\/old\\\.html\/\?\$ \{ return 301 \/new; \}/);
  assert.match(nginx, /location ~ \^\/gone2\/\?\$ \{ return 410; \}/);
  assert.match(generate(m, "netlify"), /^\/old\.html {2}\/new {2}301$/m);
  assert.match(generate(m, "netlify"), /^# gone \(handle on the platform\): \/gone2$/m);
  assert.deepEqual(JSON.parse(generate(m, "vercel")), { redirects: [{ source: "/old.html", destination: "/new", permanent: true }, { source: "/y", destination: "/z", permanent: true }] });
  assert.throws(() => generate(m, "iis"), /unknown format/);
});

test("generate holds back redirects whose target is not live yet, and lists them", () => {
  const m = parseMap({ redirects: { "/a": "/live", "/b": "/soon", "/c": "https://other.test/x" } }, SITE);
  const live = new Set(["/live"]);
  const out = generate(m, "apache", { live });
  assert.ok(out.includes("^a/?$ /live") && out.includes("^c/?$ https://other.test/x") && !out.includes("^b/"));
  assert.deepEqual(waiting(m, live), [["/b", "/soon"]]);
});

test("the generated block replaces the previous one between markers and keeps CRLF line endings", () => {
  const block = `${BEGIN}\nRewriteRule ^a/?$ /b [R=301,L]\n${END}`;
  const crlf = `RewriteEngine On\r\n${BEGIN}\r\nold rule\r\n${END}\r\n# after\r\n`;
  const out = replaceBlock(crlf, block);
  assert.equal(out, `RewriteEngine On\r\n${BEGIN}\r\nRewriteRule ^a/?$ /b [R=301,L]\r\n${END}\r\n# after\r\n`);
  assert.equal(replaceBlock("RewriteEngine On", block), `RewriteEngine On\n${block}\n`);
  assert.equal(replaceBlock("", block), `${block}\n`);
});

test("judging answers: 301/308 to the exact target pass, temporary or wrong targets fail, soft 404s fail", () => {
  const r = { expect: "redirect", to: "/new" };
  assert.equal(judge(r, { status: 301, location: "https://s.test/new/" }, SITE).ok, true);
  assert.equal(judge(r, { status: 308, location: "https://s.test/new" }, SITE).ok, true);
  assert.match(judge(r, { status: 302, location: "https://s.test/new" }, SITE).detail, /expected 301/);
  assert.match(judge(r, { status: 301, location: "https://s.test/" }, SITE).detail, /redirects to \/, expected \/new/);
  assert.equal(judge(r, { status: 301, location: "https://s.test/new" }, ["https://staging.test/", SITE]).ok, true, "staging answering with the production host");
  assert.equal(judge({ expect: "gone" }, { status: 410 }, SITE).ok, true);
  assert.ok(judge({ expect: "gone" }, { status: 404 }, SITE).warn);
  assert.equal(judge({ expect: "gone" }, { status: 301, location: "https://s.test/" }, SITE).ok, false);
  assert.match(judge({ expect: "missing" }, { status: 200 }, SITE).detail, /soft 404/);
  assert.equal(smokePlan(parseMap({ redirects: { "/a": "/b" }, gone: ["/g"] }, SITE)).length, 3);
});

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}
const quiet = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
const siteFor = (base, dir) => ({ id: "s", name: "S", url: `${base}/`, sitemap: `${base}/sitemap.xml`, paths: { root: dir, state: dir, redirects: join(dir, "redirects.json") } });

test("smoke job: asks the live site and reports each failure, a soft 404 included", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seo-redir-"));
  writeFileSync(join(dir, "redirects.json"), JSON.stringify({ redirects: { "/old": "/new", "/temp": "/new", "/wrong": "/new" }, gone: ["/gone", "/gone404"] }));
  await withServer((req, res) => {
    const to = { "/old": [301, "/new"], "/temp": [302, "/new"], "/wrong": [301, "/"] }[req.url];
    if (to) { res.statusCode = to[0]; res.setHeader("location", to[1]); return res.end(); }
    res.statusCode = req.url === "/gone" ? 410 : req.url === "/gone404" ? 404 : 200; res.end("page");
  }, async (base) => {
    const { run } = await import("../src/jobs/redirects.mjs");
    const code = process.exitCode;
    await quiet(() => run({ site: siteFor(base, dir), flags: {}, positional: ["smoke"] }));
    assert.equal(process.exitCode, 1); process.exitCode = code;
  });
  const out = JSON.parse(readFileSync(join(dir, "redirects-smoke.json"), "utf8"));
  assert.equal(out.checked, 6);
  assert.deepEqual(out.results.filter((r) => !r.ok).map((r) => r.path).sort(), ["/seo-autopilot-check-not-a-page", "/temp", "/wrong"]);
  assert.match(readFileSync(join(dir, "redirects-smoke.md"), "utf8"), /note \/gone404: answers 404, not 410/);
});

test("check job: pages come from the live sitemap; errors set a failing exit code; generate --write edits only the marked block", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seo-redir-"));
  writeFileSync(join(dir, "redirects.json"), JSON.stringify({ redirects: { "/old": "/new", "/broken": "/missing" }, gone: ["/retired"] }));
  await withServer((req, res) => {
    const base = `http://127.0.0.1:${req.socket.localPort}`;
    if (req.url === "/sitemap.xml") return res.end(`<urlset><url><loc>${base}/</loc></url><url><loc>${base}/new/</loc></url></urlset>`);
    res.end("x");
  }, async (base) => {
    const { run } = await import("../src/jobs/redirects.mjs");
    const code = process.exitCode;
    await quiet(() => run({ site: siteFor(base, dir), flags: {}, positional: [] }));
    assert.equal(process.exitCode, 1); process.exitCode = code;
    assert.ok(JSON.parse(readFileSync(join(dir, "redirects.json"), "utf8")).redirects, "the map itself is never overwritten");
    const report = JSON.parse(readFileSync(join(dir, "redirects-check.json"), "utf8"));
    assert.equal(report.livePages, 2);
    assert.deepEqual(report.errors, ["/broken -> /missing: the target is not a page on this site"]);
    writeFileSync(join(dir, ".htaccess"), "RewriteEngine On\r\n# keep me\r\n");
    await quiet(() => run({ site: siteFor(base, dir), flags: { write: ".htaccess" }, positional: ["generate"] }));
    const ht = readFileSync(join(dir, ".htaccess"), "utf8");
    assert.ok(ht.startsWith("RewriteEngine On\r\n# keep me\r\n") && ht.includes(`${BEGIN}\r\n`) && ht.includes("RewriteRule ^old/?$ /new [R=301,L]\r\n"));
  });
});

test("router: redirect map errors and live smoke failures send the redirect guardian first", async () => {
  const { routeAgents } = await import("../src/analysis/agent-router.mjs");
  const plan = routeAgents({ profile: { mode: "edit", signals: { structuredData: ["Organization"] } }, redirects: { check: { errors: ["/a -> /b: chain"] }, smoke: { results: [{ path: "/old", ok: false, detail: "expected 301 to /new, got 302" }, { path: "/x", ok: true }] } } });
  const g = plan.steps.find((s) => s.agent === "seo-redirect-guardian");
  assert.equal(g.phase, "block");
  assert.deepEqual(g.evidence, ["/a -> /b: chain", "live: /old expected 301 to /new, got 302"]);
  assert.equal(routeAgents({ profile: { mode: "edit", signals: { structuredData: ["Organization"] } }, redirects: { check: { errors: [] }, smoke: null } }).steps.some((s) => s.agent === "seo-redirect-guardian"), false);
});
