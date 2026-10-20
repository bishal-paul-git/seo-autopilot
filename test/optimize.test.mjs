// Content optimiser: shared terms with ranges, shared sections, basics, the score and the job (robots.txt respected).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { termModel, termUsage, subtopics, basics, optimise } from "../src/analysis/optimize.mjs";
import { fromHtml, fromMarkdown } from "../src/jobs/optimize.mjs";

const filler = (n, seed) => Array.from({ length: n }, (_, i) => `Sentence ${seed}${i} keeps the page readable with plain short words.`).join(" ");
const comp = (domain, extra = "", heads = []) => ({ url: `https://${domain}/hosting`, domain, title: "Web hosting for small business", headings: heads.map((t) => ({ level: 2, text: t })),
  text: `Web hosting for small business explained. Choose a plan with enough storage and bandwidth. Uptime guarantee matters, and customer support should answer fast. A free SSL certificate and daily backups protect the site. ${extra} ${filler(30, domain)}` });
const comps = [
  comp("a.test", "Shared hosting is the cheapest option.", ["How much does web hosting cost?", "Shared vs VPS hosting", "Uptime and support"]),
  comp("b.test", "Compare shared hosting and VPS hosting before you buy.", ["How much does hosting cost", "Shared hosting or VPS hosting", "Backups"]),
  comp("c.test", "Brandname Turbo is our own plan.", ["What does web hosting cost?", "Uptime and customer support"]),
];

test("term model: terms most top pages share, from different sites, with a usage range; one site's brand is not a term", () => {
  const m = termModel(comps, { targetWords: 400 });
  const names = m.map((t) => t.label);
  for (const t of ["uptime guarantee", "customer support", "ssl certificate", "daily backups"]) assert.ok(names.includes(t), t);
  assert.ok(!names.some((t) => t.includes("brandname")), "a term on one site only is left out");
  const t = m.find((x) => x.label === "customer support");
  assert.equal(t.pages, 3); assert.ok(t.range[0] >= 1 && t.range[1] >= t.range[0]);
  assert.deepEqual(termModel(comps.slice(0, 1)), [], "one page is not a pattern");
});

test("usage, subtopics and basics: missing terms, shared sections covered or not, query in title and opening", () => {
  const page = { title: "Hosting plans", h1: "Our hosting", description: "", headings: [{ level: 2, text: "Shared vs VPS hosting" }], text: `We sell hosting. ${filler(20, "p")}` };
  const usage = termUsage(termModel(comps), page);
  assert.equal(usage.find((t) => t.label === "customer support").status, "missing");
  const subs = subtopics(comps, page);
  const cost = subs.find((s) => /cost/i.test(s.topic));
  assert.equal(cost.pages, 3); assert.equal(cost.question, true); assert.equal(cost.covered, "no");
  assert.equal(subs.find((s) => /vps/i.test(s.topic)).covered, "heading");
  const b = basics(page, "web hosting for small business");
  assert.ok(b.title < 1 && b.opening < 1);
});

test("score: a page matching what top pages share scores higher than a thin one; every recommendation has its evidence", () => {
  const thin = optimise({ title: "Hosting", h1: "Hosting", description: "", headings: [], text: `We sell hosting plans. ${filler(15, "t")}` }, comps, "web hosting for small business");
  const good = optimise({ title: "Web hosting for small business: how to choose", h1: "Web hosting for small business", description: "How to choose web hosting for a small business: cost, uptime, support, SSL and backups.", headings: [{ level: 2, text: "How much does web hosting cost?" }, { level: 2, text: "Shared vs VPS hosting" }, { level: 2, text: "Uptime and customer support" }],
    text: `Web hosting for small business starts with a plan that fits. Shared hosting suits most new sites; compare shared hosting and VPS hosting as you grow. Check storage and bandwidth. An uptime guarantee and customer support that answers fast matter. A free SSL certificate and daily backups protect the site. ${filler(30, "g")}` }, comps, "web hosting for small business");
  assert.ok(good.score > thin.score + 20, `${good.score} vs ${thin.score}`);
  assert.ok(thin.recommendations.some((r) => /title/.test(r)) && thin.recommendations.some((r) => /never does/.test(r)) && thin.recommendations.some((r) => /words/.test(r)));
  assert.equal(Object.values(good.parts).reduce((a, b) => a + b, 0), good.score);
});

test("page readers: HTML main content and outline; Markdown front matter, headings and text without markup", () => {
  const p = fromHtml("<html><head><title>T</title><meta name=description content=D></head><body><nav>Menu</nav><main><h1>H</h1><h2>Sub</h2><p>Body text</p></main></body></html>", "https://s.test/x");
  assert.deepEqual([p.title, p.h1, p.description, p.headings.length], ["T", "H", "D", 2]); assert.ok(!p.text.includes("Menu"));
  const m = fromMarkdown("---\ntitle: \"Draft title\"\ndescription: Draft desc\n---\n# Big\n\nSome **bold** [link](https://x.test) text.\n\n## Part two\n");
  assert.deepEqual([m.title, m.h1, m.description, m.headings.map((h) => h.text)], ["Draft title", "Big", "Draft desc", ["Big", "Part two"]]);
  assert.match(m.text, /Some bold link text/);
});

test("optimize job: reads a draft, finds top pages with the SERP provider, skips own site, platforms and robots-blocked pages", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-opt-")); const state = join(root, "state"); mkdirSync(state);
  writeFileSync(join(root, "draft.md"), "---\ntitle: Hosting\n---\n# Hosting\n\nWe sell hosting. " + filler(20, "d"));
  const html = (c) => `<html><head><title>${c.title}</title></head><body><main>${c.headings.map((h) => `<h2>${h.text}</h2>`).join("")}<p>${c.text}</p></main></body></html>`;
  const fetched = [];
  const f = async (url) => {
    url = String(url); fetched.push(url);
    const ok = (body, type = "text/html") => ({ ok: true, status: 200, headers: { get: () => type }, text: async () => body, json: async () => body });
    if (url.includes("serpapi")) return ok({ organic_results: ["s.test", "en.wikipedia.org", "a.test", "b.test", "blocked.test", "c.test"].map((d, i) => ({ link: `https://${d}/hosting`, position: i + 1 })) }, "application/json");
    if (url.endsWith("/robots.txt")) return url.includes("blocked.test") ? ok("User-agent: *\nDisallow: /") : { ok: false, status: 404 };
    const c = comps.find((x) => url.includes(x.domain));
    return c ? ok(html(c)) : { ok: false, status: 404 };
  };
  const site = { id: "s", name: "S", url: "https://s.test/", paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/optimize.mjs");
  const log = console.log; console.log = () => {};
  try { await run({ site, flags: { query: "web hosting for small business", file: "draft.md" } }, { env: { SERPAPI_KEY: "k" }, fetch: f, delayMs: 0 }); } finally { console.log = log; }
  assert.ok(!fetched.some((u) => u.startsWith("https://s.test/") || u.includes("wikipedia")), "own site and platforms are not fetched");
  assert.ok(!fetched.includes("https://blocked.test/hosting"), "robots.txt is respected");
  const out = JSON.parse(readFileSync(join(state, "optimize", readdirSync(join(state, "optimize")).find((x) => x.endsWith(".json"))), "utf8"));
  assert.deepEqual(out.competitors.map((c) => c.url), ["https://a.test/hosting", "https://b.test/hosting", "https://c.test/hosting"]);
  assert.ok(out.notes.some((n) => /blocked\.test.*robots/.test(n)));
  assert.ok(out.score >= 0 && out.score <= 100);
});
