// Brief 01 item 7: delivered HTML vs the page after JavaScript. The comparison is pure and tested here; the headless run
// is tested end to end only where Playwright can be loaded (skipped otherwise, like the Go engine test).
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareRender, sentences, isProse } from "../src/analysis/render.mjs";
import { blockText } from "../src/audit/extract.mjs";

const page = (text, title = "T", h1 = "H") => ({ title, h1, text });
const ids = (r) => r.findings.map((f) => f.id).sort();

test("block text keeps one line per block, so a heading never runs into its paragraph", () => {
  assert.equal(blockText("<main><h2>How we started</h2><p>We began in <b>2022</b>.</p><ul><li>One</li><li>Two</li></ul></main>"), "How we started\nWe began in 2022.\nOne\nTwo");
});

test("prose vs labels: only full sentences of eight words or more count as prose", () => {
  assert.equal(isProse("This policy explains what personal data we collect and why."), true);
  assert.equal(isProse("Acme services related to this guide"), false);
  assert.equal(isProse("Short sentence here."), false);
  assert.deepEqual(sentences("Menu\nThis line has six words in it.\nShort one."), ["This line has six words in it."]);
});

test("matching pages raise nothing; punctuation, case and line breaks do not matter", () => {
  const text = "Who we are\nWe build the systems that run the parts of your business by hand.";
  assert.deepEqual(compareRender(page(text), page(text.toUpperCase().replace("\n", " "))).findings, []);
});

test("a prerendered sentence the page does not say is high; a different label is low", () => {
  const raw = page("Acme services related to this guide\nWe began in 2022 as an IT provider and became an automation company.\nShared sentence that is on both pages for sure.");
  const ren = page("Where to go next\nWe began in 2022 as an IT provider, helping firms with their systems.\nShared sentence that is on both pages for sure.");
  const r = compareRender(raw, ren);
  assert.deepEqual(ids(r), ["prerender-labels-differ", "prerender-text-not-on-page"]);
  assert.equal(r.findings.find((f) => f.id === "prerender-text-not-on-page").severity, "high");
  assert.match(r.findings.find((f) => f.id === "prerender-text-not-on-page").evidence[0], /became an automation company/);
});

test("JS-only content, a changed title and a changed H1 are reported", () => {
  const body = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i} of the rendered article text.`).join("\n");
  const r = compareRender(page("Loading the page content now", "Old title", ""), page(body, "New title", "Real heading"));
  assert.deepEqual(ids(r), ["render-h1-changed", "render-title-changed", "rendered-text-missing"]);
  assert.equal(r.missingShare, 1);
});

let playwright = null;
for (const from of [import.meta.url, join(process.cwd(), "package.json")]) { try { playwright = createRequire(from)("playwright"); break; } catch { /* not installed here */ } }

test("render job end to end: opens a one-at-a-time FAQ, ignores labels, and catches a stale prerendered sentence", { skip: !playwright && "Playwright not installed" }, async () => {
  const faq = `<script>document.addEventListener("click",(e)=>{const b=e.target.closest("button.q");if(!b)return;document.querySelectorAll(".a").forEach(n=>n.remove());const p=document.createElement("p");p.className="a";p.textContent=b.dataset.a;b.after(p);});</script>`;
  const pages = {
    "/ok": { raw: `<main><h1>Ok</h1><p>This paragraph is the same in the delivered HTML and on the page.</p><button class="q" data-a="The first answer explains the first question in full sentences.">First question?</button><p>The first answer explains the first question in full sentences.</p><button class="q" data-a="The second answer is only shown once the visitor opens it.">Second question?</button><p>The second answer is only shown once the visitor opens it.</p></main>`,
      live: `<main><h1>Ok</h1><p>This paragraph is the same in the delivered HTML and on the page.</p><button class="q" data-a="The first answer explains the first question in full sentences.">First question?</button><button class="q" data-a="The second answer is only shown once the visitor opens it.">Second question?</button></main>${faq}` },
    "/stale": { raw: `<main><h1>Stale</h1><p>We began in 2022 as an IT provider and became an automation company.</p></main>`,
      live: `<main><h1>Stale</h1><p>We began in 2022 as an IT provider, helping firms with their systems.</p></main>` },
  };
  // The "delivered" HTML is what fetch gets; the browser gets the live version (the same URL, told apart by user agent).
  const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === "/sitemap.xml") return res.end(`<urlset>${Object.keys(pages).map((p) => `<url><loc>${base}${p}</loc></url>`).join("")}</urlset>`);
    const p = pages[req.url];
    if (!p) { res.statusCode = 404; return res.end(""); }
    res.setHeader("content-type", "text/html");
    res.end(`<html><head><title>${req.url}</title></head><body>${/Mozilla/.test(req.headers["user-agent"] || "") ? p.live : p.raw}</body></html>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const state = mkdtempSync(join(tmpdir(), "seo-render-"));
  const log = console.log; console.log = () => {};
  try {
    const { run } = await import("../src/jobs/render.mjs");
    const base = `http://127.0.0.1:${server.address().port}`;
    await run({ site: { id: "s", name: "S", url: `${base}/`, sitemap: `${base}/sitemap.xml`, paths: { state } }, cfg: { root: process.cwd() }, flags: {} });
  } finally { console.log = log; server.close(); }
  const out = JSON.parse(readFileSync(join(state, "render.json"), "utf8"));
  const by = Object.fromEntries(out.results.map((r) => [new URL(r.url).pathname, r.findings.map((f) => f.id)]));
  assert.deepEqual(by["/ok"], [], "both FAQ answers were read, though only one is open at a time");
  assert.deepEqual(by["/stale"], ["prerender-text-not-on-page"]);
});

test("router: stale prerendered text or JS-only content sends the technical fixer first; label differences alone do not", async () => {
  const { routeAgents } = await import("../src/analysis/agent-router.mjs");
  const base = { profile: { mode: "edit", signals: { structuredData: ["Organization"] } } };
  const stale = routeAgents({ ...base, render: { results: [{ url: "https://s.test/about", findings: [{ id: "prerender-text-not-on-page", severity: "high" }, { id: "prerender-labels-differ", severity: "low" }] }] } });
  const tf = stale.steps.find((s) => s.agent === "seo-technical-fixer");
  assert.equal(tf.phase, "block");
  assert.deepEqual(tf.evidence, ["/about: prerender-text-not-on-page"]);
  const labels = routeAgents({ ...base, render: { results: [{ url: "https://s.test/x", findings: [{ id: "prerender-labels-differ", severity: "low" }] }] } });
  assert.equal(labels.steps.some((s) => s.agent === "seo-technical-fixer"), false);
});
