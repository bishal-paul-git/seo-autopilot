// Inbound links audit: export parsing, matching to the crawl, and honest review notes. Sample files are shaped like
// Search Console and backlink-tool exports; they are not real downloads.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv, matchColumns, readExport, analyseInbound } from "../src/analysis/inbound.mjs";
import { routeAgents } from "../src/analysis/agent-router.mjs";

const H = "s.test";

test("CSV: byte-order mark, quotes with commas and doubled quotes, CRLF, tabs and blank lines", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  assert.deepEqual(parseCsv("a\tb\n1\t2\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(matchColumns(["Linking page", "Last crawled"]).source, 0);
});

test("exports: latest links, top linking sites and top linked pages are recognised; your own site and unknown files are skipped", () => {
  const links = readExport("Linking page,Last crawled\nhttps://blog.other.test/post,2026-10-01\nhttps://s.test/self,2026-10-01\n", H);
  assert.equal(links.kind, "links"); assert.equal(links.rows.length, 1); assert.equal(links.rows[0].domain, "blog.other.test");
  const tool = readExport("Referring page URL,Target URL,Anchor\nhttps://news.test/a,https://s.test/old,invoice software\n", H);
  assert.deepEqual(tool.rows[0], { source: "https://news.test/a", domain: "news.test", target: "/old", anchor: "invoice software", date: null });
  assert.equal(readExport("Site,Linking pages,Target pages\nwww.partner.test,120,3\n", H).rows[0].domain, "partner.test");
  assert.deepEqual(readExport("Target page,Incoming links,Linking sites\nhttps://s.test/guide,40,12\n", H).rows, [{ target: "/guide", links: 40 }]);
  assert.equal(readExport("Foo,Bar\n1,2\n", H).kind, "unknown");
});

test("analysis: links into erroring pages are reclaimable, redirects are noted, sitewide and anchor patterns go to review, new and lost sites are diffed", () => {
  const rows = ["Referring page URL,Target URL,Anchor"];
  for (let i = 0; i < 25; i++) rows.push(`https://farm${i}.test/p,https://s.test/old,cheap invoices`);
  rows.push("https://news.test/a,https://s.test/moved,Acme", "https://news.test/b,https://s.test/guide,guide");
  const exports = [readExport(rows.join("\n"), H), readExport("Site,Linking pages\npartner.test,80\n", H)];
  const pages = [{ url: "https://s.test/old", status: 404 }, { url: "https://s.test/moved", status: 301, finalUrl: "https://s.test/new" }, { url: "https://s.test/guide", status: 200 }];
  const r = analyseInbound(exports, { siteHost: H, pages, previous: { domains: ["news.test", "gone.test"] } });
  assert.deepEqual(r.reclaim.map((x) => [x.target, x.status, x.links]), [["/old", 404, 25]]);
  assert.equal(r.reclaim[0].sources.length, 5);
  assert.deepEqual(r.redirected, [{ target: "/moved", to: "/new", links: 1 }]);
  assert.deepEqual(r.review.map((x) => x.kind).sort(), ["anchor-concentration", "sitewide"]);
  assert.ok(r.newDomains.includes("partner.test") && !r.newDomains.includes("news.test"));
  assert.deepEqual(r.lostDomains, ["gone.test"]);
  assert.equal(r.totals.domains, 27);
});

test("analysis: a small, natural profile raises nothing to review", () => {
  const r = analyseInbound([readExport("Linking page\nhttps://a.test/x\nhttps://b.test/y\n", H)], { siteHost: H, pages: [] });
  assert.deepEqual([r.reclaim, r.review], [[], []]);
});

test("router: reclaimable links send the backlink auditor in the fix phase with every broken target; patterns alone are grow phase", () => {
  const base = { profile: { mode: "edit", signals: { structuredData: ["Organization"] } } };
  const p = routeAgents({ ...base, inbound: { reclaim: [{ target: "/old", status: 404, links: 25 }, { target: "/gone", status: 410, links: 2 }], review: [] } });
  const s = p.steps.find((x) => x.agent === "seo-backlink-auditor");
  assert.equal(s.phase, "fix"); assert.deepEqual(s.targets, ["/old", "/gone"]); assert.match(s.prompt, /inbound\.json/);
  const q = routeAgents({ ...base, inbound: { reclaim: [], review: [{ kind: "sitewide", note: "80 linking pages from one site. Fine if real." }] } });
  assert.equal(q.steps.find((x) => x.agent === "seo-backlink-auditor").phase, "grow");
});

test("inbound job: reads every CSV in the export folder, matches the crawl, writes the report and a snapshot, and never suggests a disavow by default", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-inbound-"));
  const state = join(root, "state"), data = join(root, "data");
  mkdirSync(join(data, "inbound-links"), { recursive: true }); mkdirSync(state);
  writeFileSync(join(data, "inbound-links", "latest.csv"), "Referring page URL,Target URL\nhttps://news.test/a,https://s.test/old\n");
  writeFileSync(join(state, "audit.json"), JSON.stringify({ generatedAt: "t", pages: [{ url: "https://s.test/old", status: 404 }] }));
  const site = { id: "s", name: "S", url: "https://s.test/", paths: { state, root, data } };
  const log = console.log; let out = ""; console.log = (m) => { out += m; };
  try { await (await import("../src/jobs/inbound.mjs")).run({ site, flags: {} }); } finally { console.log = log; }
  const r = JSON.parse(readFileSync(join(state, "inbound.json"), "utf8"));
  assert.deepEqual(r.reclaim.map((x) => x.target), ["/old"]);
  assert.deepEqual(JSON.parse(readFileSync(join(state, "inbound-snapshot.json"), "utf8")).domains, ["news.test"]);
  assert.match(out, /Links to reclaim[\s\S]*\/old answers 404/);
  assert.match(out, /Most sites never need to disavow/);
  console.log = () => {};
  let msg = ""; console.log = (m) => { msg = m; };
  try { await (await import("../src/jobs/inbound.mjs")).run({ site: { ...site, paths: { ...site.paths, data: join(root, "none") } }, flags: {} }); } finally { console.log = log; }
  assert.match(msg, /No inbound-links export found/);
});
