// Page change monitor: snapshots, field-by-field diff, watch list and the job over two runs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshot, diff, describe } from "../src/analysis/changes.mjs";
import { watchList } from "../src/jobs/changes.mjs";

const html = ({ title = "Web hosting", h2 = ["Plans", "Support"], body = "We host sites. Support answers fast. Backups run daily.", schema = "Product", noindex = false } = {}) =>
  `<html><head><title>${title}</title><meta name="description" content="Hosting plans">${noindex ? '<meta name="robots" content="noindex">' : ""}<script type="application/ld+json">{"@type":"${schema}","name":"x"}</script></head><body><main><h1>Hosting</h1>${h2.map((h) => `<h2>${h}</h2>`).join("")}<p>${body}</p></main></body></html>`;

test("diff: unchanged pages report nothing; titles, headings, schema, indexability and rewrites are reported", () => {
  const a = snapshot(html(), "https://r.test/");
  assert.deepEqual(diff(a, snapshot(html(), "https://r.test/")), []);
  const b = snapshot(html({ title: "Cheap web hosting", h2: ["Plans", "Pricing"], schema: "FAQPage", noindex: true, body: "Totally new copy here. Prices start low. Compare our plans now." }), "https://r.test/");
  const d = diff(a, b);
  const by = Object.fromEntries(d.map((c) => [c.field, c]));
  assert.ok(by.noindex.important && by.title.important);
  assert.deepEqual([by.headings.added, by.headings.removed], [["## Pricing"], ["## Support"]]);
  assert.deepEqual([by.schema.added, by.schema.removed], [["FAQPage"], ["Product"]]);
  assert.ok(by.text.rewritten > 0.5);
  assert.match(describe(by.headings), /added "## Pricing"; removed "## Support"/);
  assert.deepEqual(diff(null, a), [{ field: "new", note: "first snapshot" }]);
});

test("watch list: your list wins; otherwise top pages by clicks plus competitors' winning pages", () => {
  const site = { url: "https://s.test/" };
  assert.deepEqual(watchList(site, { list: ["https://www.s.test/a", { url: "https://r.test/x" }, "not a url"] }), [{ url: "https://www.s.test/a", kind: "yours" }, { url: "https://r.test/x", kind: "competitor" }]);
  const w = watchList(site, { rows: [{ page: "https://s.test/b", clicks: 9 }, { page: "https://s.test/a", clicks: 1 }], gap: { pages: [{ url: "https://r.test/y" }] } });
  assert.deepEqual(w.map((x) => [x.url, x.kind]), [["https://s.test/b", "yours"], ["https://s.test/a", "yours"], ["https://r.test/y", "competitor"]]);
});

test("changes job: first run takes snapshots; second run reports what changed and keeps a log", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-chg-")); const state = join(root, "state"); mkdirSync(state);
  writeFileSync(join(root, "watch-pages.json"), JSON.stringify(["https://r.test/hosting"]));
  let version = html();
  const f = async (url) => url.endsWith("robots.txt") ? { ok: false, status: 404 } : { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => version };
  const site = { id: "s", name: "S", url: "https://s.test/", paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/changes.mjs");
  const log = console.log; console.log = () => {};
  try {
    await run({ site }, { fetch: f, delayMs: 0, today: "2026-10-01" });
    version = html({ title: "Web hosting from 1 a month" });
    await run({ site }, { fetch: f, delayMs: 0, today: "2026-10-08" });
  } finally { console.log = log; }
  const store = JSON.parse(readFileSync(join(state, "page-snapshots.json"), "utf8"))["https://r.test/hosting"];
  assert.equal(store.kind, "competitor"); assert.equal(store.log.length, 1); assert.equal(store.log[0].changes[0].field, "title");
  assert.match(readFileSync(join(state, "changes.md"), "utf8"), /title: "Web hosting" to "Web hosting from 1 a month"/);
});
