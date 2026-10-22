// Internal link graph: PageRank maths, click depth, orphans, leaks and under-linked pages with demand.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pagerank, clickDepth, analyseGraph } from "../src/analysis/linkgraph.mjs";

test("pagerank: sums to 1, a page everyone links to wins, dangling pages spread their weight", () => {
  const pr = pagerank({ a: ["c"], b: ["c"], c: ["a"], d: [] });
  assert.ok(Math.abs(Object.values(pr).reduce((x, y) => x + y, 0) - 1) < 1e-9);
  assert.ok(pr.c > pr.a && pr.a > pr.b && pr.b > 0);
  const sym = pagerank({ a: ["b"], b: ["a"] });
  assert.ok(Math.abs(sym.a - 0.5) < 1e-9);
  assert.deepEqual(clickDepth({ h: ["a"], a: ["b"], b: [], z: [] }, "h"), { h: 0, a: 1, b: 2 });
});

const S = "https://s.test";
const page = (path, links, extra = {}) => ({ url: `${S}${path}`, status: 200, noindex: false, title: extra.title || path, links: links.map((l) => `${S}${l}`), ...extra });

test("graph: orphans, depth, leaks to redirects and noindex pages, and under-linked pages with demand get related donors", () => {
  // Every page carries the site navigation, as real pages do.
  const nav = ["/", "/hosting", "/blog", "/about", "/contact"];
  const pages = [
    page("/", [...nav, "/old"]),
    page("/hosting", nav, { title: "Web hosting plans" }), page("/about", nav), page("/contact", nav),
    page("/blog", [...nav, "/blog/a", "/private"]),
    page("/blog/a", [...nav, "/blog/b"], { title: "Choosing web hosting" }), page("/blog/b", [...nav, "/blog/c"]), page("/blog/c", [...nav, "/blog/d"]), page("/blog/d", nav, { title: "Hosting for shops" }),
    page("/lonely", ["/"]),
    { url: `${S}/old`, status: 301, links: [] }, { url: `${S}/private`, status: 200, noindex: true, links: [] },
  ];
  const rows = [{ page: `${S}/blog/d`, impressions: 900, clicks: 5, position: 9 }, { page: `${S}/hosting`, impressions: 100, clicks: 9, position: 3 }, { page: `${S}/blog/a`, impressions: 10, position: 30 }];
  const r = analyseGraph(pages, { home: `${S}/`, rows });
  assert.equal(r.pages, 10, "redirects and noindex pages are not nodes");
  assert.deepEqual(r.orphans.map((x) => x.url), [`${S}/lonely`]);
  assert.deepEqual(r.unreachable.map((x) => x.url), [`${S}/lonely`]);
  assert.deepEqual(r.deep.map((x) => [x.url, x.depth]), [[`${S}/blog/d`, 5], [`${S}/blog/c`, 4]]);
  assert.equal(r.leaks.links, 2); assert.deepEqual(r.leaks.targets.map((x) => x.why).sort(), ["noindex", "redirects"]);
  assert.equal(r.top[0].score, 100);
  const u = r.underLinked.find((x) => x.url === `${S}/blog/d`);
  assert.ok(u, "lots of demand, little weight, position 9");
  assert.equal(u.donors[0].url, `${S}/hosting`, "a strong page about a related topic comes first");
  assert.ok(!r.underLinked.some((x) => x.url === `${S}/hosting`), "already strong and at position 3");
});

test("linkgraph job: reads the saved audit and Search Console rows, fetches nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-lg-")); const state = join(root, "state"); mkdirSync(state);
  writeFileSync(join(state, "audit.json"), JSON.stringify({ generatedAt: "2026-10-01", pages: [page("/", ["/a"]), page("/a", ["/"])] }));
  const site = { id: "s", name: "S", url: `${S}/`, paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/linkgraph.mjs");
  const log = console.log; console.log = () => {};
  try { await run({ site }); } finally { console.log = log; }
  const r = JSON.parse(readFileSync(join(state, "linkgraph.json"), "utf8"));
  assert.equal(r.pages, 2); assert.equal(r.orphans.length, 0);
  assert.match(readFileSync(join(state, "linkgraph.md"), "utf8"), /internal PageRank/);
});
