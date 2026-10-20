// Entity check: confirm the right entity by official website, spot look-alikes, compare sameAs; job with mocked APIs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseKg, parseWikidata, assess } from "../src/analysis/entity.mjs";

const kgJson = { itemListElement: [
  { result: { "@id": "kg:/g/1", name: "Acme", "@type": ["Organization"], description: "Toy maker", url: "https://acme-toys.test" }, resultScore: 900 },
  { result: { "@id": "kg:/g/2", name: "Acme", "@type": ["Organization", "Corporation"], description: "Plumbing company", url: "https://www.acme.test/", detailedDescription: { url: "https://en.wikipedia.org/wiki/Acme_Plumbing" } }, resultScore: 400 },
] };
const wdSearch = { search: [{ id: "Q1", label: "Acme", description: "plumbing company" }, { id: "Q2", label: "Acme", description: "fictional company" }] };
const wdEntities = { entities: { Q1: { claims: { P856: [{ mainsnak: { datavalue: { value: "https://acme.test" } } }] }, sitelinks: { enwiki: { title: "Acme Plumbing" } } }, Q2: { claims: {} } } };

test("parsing and assessment: the entity whose website is this site is the match; look-alikes and missing sameAs are actions", () => {
  const kg = parseKg(kgJson, "https://acme.test/"), wd = parseWikidata(wdSearch, wdEntities, "https://acme.test/");
  assert.deepEqual(kg.map((x) => x.matchesSite), [false, true]);
  assert.deepEqual(wd.map((x) => [x.id, x.matchesSite, x.wikipedia]), [["Q1", true, "https://en.wikipedia.org/wiki/Acme_Plumbing"], ["Q2", false, null]]);
  const r = assess({ name: "Acme", siteUrl: "https://acme.test/", kg, wikidata: wd, sameAs: ["https://www.wikidata.org/wiki/Q1"], kgChecked: true });
  assert.equal(r.knowledgeGraph.found, true); assert.equal(r.wikidata.id, "Q1");
  assert.ok(r.actions.some((a) => a.includes("https://en.wikipedia.org/wiki/Acme_Plumbing")), "Wikipedia not yet in sameAs");
  assert.ok(!r.actions.some((a) => a.includes("Add https://www.wikidata.org/wiki/Q1")), "already declared");
  assert.ok(r.actions.some((a) => /Other entities share the name/.test(a)));
  const none = assess({ name: "Acme", siteUrl: "https://acme.test/", kg: [], wikidata: [], kgChecked: true });
  assert.equal(none.knowledgeGraph.found, false); assert.ok(none.actions.some((a) => /never create one just for SEO/.test(a)));
});

test("entity job: Wikidata without a key, Knowledge Graph with one, sameAs read from the home page markup", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-ent-")); const state = join(root, "state"); mkdirSync(state);
  const urls = [];
  const res = (b) => ({ ok: true, status: 200, headers: { get: () => "text/html" }, json: async () => b, text: async () => b });
  const f = async (url) => {
    urls.push(String(url));
    if (url.includes("kgsearch")) return res(kgJson);
    if (url.includes("wbsearchentities")) return res(wdSearch);
    if (url.includes("wbgetentities")) return res(wdEntities);
    if (url.endsWith("robots.txt")) return { ok: false, status: 404 };
    return res('<html><head><script type="application/ld+json">{"@type":"Organization","name":"Acme","sameAs":["https://en.wikipedia.org/wiki/Acme_Plumbing"]}</script></head><body>Acme</body></html>');
  };
  const site = { id: "s", name: "Acme", url: "https://acme.test/", paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/entity.mjs");
  const log = console.log; console.log = () => {};
  try { await run({ site, flags: {} }, { env: { GOOGLE_KG_API_KEY: "k" }, fetch: f }); } finally { console.log = log; }
  assert.ok(urls.some((u) => /wbgetentities.*ids=Q1%7CQ2/.test(u)));
  const r = JSON.parse(readFileSync(join(state, "entity.json"), "utf8"));
  assert.equal(r.wikidata.found, true); assert.deepEqual(r.sameAs, ["https://en.wikipedia.org/wiki/Acme_Plumbing"]);
  assert.ok(r.actions.some((a) => a.includes("Add https://www.wikidata.org/wiki/Q1")));
  assert.match(readFileSync(join(state, "entity.md"), "utf8"), /Google Knowledge Graph: \*\*found\*\*/);
});
