// Scope helpers (thinIgnore, retired, trailing-slash canonicals, site language), the safe date writer behind `pace --apply`,
// and the pure part of automatic experiment logging. All offline: temp folders only.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchesAny, slashOnlyDifference, detectLanguage, inSiteLanguage } from "../src/analysis/scope.mjs";
import { applyDates } from "../src/adapters/index.mjs";
import { metaChanges } from "../src/analysis/experiments.mjs";
import { runChecks } from "../src/audit/rules.mjs";
import { validate } from "../src/core/config.mjs";

test("matchesAny: exact paths, wildcards, trailing slashes and absolute URLs", () => {
  const list = ["/contact", "/blog/*", "/tools/roi-*"];
  assert.ok(matchesAny("https://example.com/contact", list));
  assert.ok(matchesAny("https://example.com/contact/", list));
  assert.ok(matchesAny("/blog/any-post", list));
  assert.ok(matchesAny("/tools/roi-calculator", list));
  assert.ok(!matchesAny("/contact-us", list));
  assert.ok(!matchesAny("/blog", list), "a wildcard under /blog/ does not match the hub itself");
  assert.ok(!matchesAny("/about", []));
  assert.ok(!matchesAny("/about", undefined));
});

test("slashOnlyDifference: only a trailing slash counts", () => {
  assert.ok(slashOnlyDifference("https://e.com/about/", "https://e.com/about"));
  assert.ok(!slashOnlyDifference("https://e.com/about", "https://e.com/about"));
  assert.ok(!slashOnlyDifference("https://e.com/about/", "https://e.com/contact"));
  assert.ok(!slashOnlyDifference("https://e.com/about?a=1", "https://e.com/about"));
  assert.ok(!slashOnlyDifference(undefined, "https://e.com/"));
});

test("language: clear signals are detected, unclear ones stay in scope", () => {
  assert.equal(detectLanguage("mejor software de citas para clinicas gratis"), "es");
  assert.equal(detectLanguage("le meilleur logiciel pour les cliniques"), "fr");
  assert.equal(detectLanguage("how to automate invoice follow up"), "en");
  assert.equal(detectLanguage("hubspot"), null);
  assert.equal(detectLanguage(""), null);
  assert.ok(inSiteLanguage("ai receptionist for clinics", "en"));
  assert.ok(!inSiteLanguage("mejor software para las clinicas", "en"));
  assert.ok(inSiteLanguage("hubspot zapier", "en"), "no signal: keep it");
  assert.ok(inSiteLanguage("anything at all", undefined), "no language configured: no filter");
  assert.ok(!inSiteLanguage("自動化 ソフト", "en"));
  assert.ok(inSiteLanguage("自動化 ソフト", "ja"));
  assert.ok(inSiteLanguage("mejor software para las clinicas", "es-MX"));
});

test("thin-content rule skips pages matching thinIgnore", () => {
  const page = (url, words) => ({ url, finalUrl: url, status: 200, isHtml: true, inSitemap: true, robots: "", words, title: "A decent page title for testing", description: "x".repeat(100), h1s: ["Heading"], canonical: url, jsonld: { invalid: 0, nodes: [] }, links: [], og: { title: "t" }, headings: [], chain: [], mixed: [], viewport: "width=device-width", lang: "en", inbound: 5, depth: 1, ttfb: 100, images: 0, imagesNoAlt: 0 });
  const pages = [page("https://e.com/contact", 120), page("https://e.com/guide", 120)];
  const find = (issues) => issues.filter((i) => i.rule === "thin-content").map((i) => i.url);
  assert.deepEqual(find(runChecks(pages, { siteHost: "e.com" })).sort(), ["https://e.com/contact", "https://e.com/guide"]);
  assert.deepEqual(find(runChecks(pages, { siteHost: "e.com", thinIgnore: ["/contact"] })), ["https://e.com/guide"]);
});

test("config: thinIgnore, retired and language are validated", () => {
  const ok = { sites: [{ id: "a", url: "https://a.com/", searchConsoleProperty: "https://a.com/", sitemap: "https://a.com/sitemap.xml", thinIgnore: ["/contact"], retired: ["/old/*"], language: "en-GB" }] };
  assert.deepEqual(validate(ok), []);
  const bad = { sites: [{ ...ok.sites[0], thinIgnore: "/contact", retired: [1], language: "english" }] };
  const errs = validate(bad);
  assert.equal(errs.length, 3);
});

function site(dir, content) {
  return { paths: { root: dir }, content };
}

test("applyDates: rewrites JSON exactly, keeps CRLF, never touches other fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "seo-apply-"));
  mkdirSync(join(dir, "c"));
  const list = [{ slug: "a", h1: "A", publishAt: "2026-10-21", body: ["é", "x"] }, { slug: "b", h1: "B", publishAt: "2026-10-22" }];
  const text = JSON.stringify(list, null, 2) + "\n";
  writeFileSync(join(dir, "c", "guides.json"), text.replace(/\n/g, "\r\n"));
  const s = site(dir, { type: "json" });
  const dry = applyDates(s, [{ id: "a", file: "c/guides.json", from: "2026-10-21", to: "2026-10-24" }], { dry: true });
  assert.equal(dry.applied.length, 1);
  assert.equal(readFileSync(join(dir, "c", "guides.json"), "utf8"), text.replace(/\n/g, "\r\n"), "dry run writes nothing");
  const r = applyDates(s, [{ id: "a", file: "c/guides.json", from: "2026-10-21", to: "2026-10-24" }, { id: "zzz", file: "c/guides.json", from: "x", to: "y" }]);
  assert.equal(r.applied.length, 1);
  assert.equal(r.skipped[0].reason, "page not found in file");
  const out = readFileSync(join(dir, "c", "guides.json"), "utf8");
  assert.ok(out.includes("\r\n") && !/[^\r]\n/.test(out), "CRLF kept");
  const parsed = JSON.parse(out);
  assert.equal(parsed[0].publishAt, "2026-10-24");
  assert.equal(parsed[1].publishAt, "2026-10-22");
  assert.deepEqual(parsed[0].body, ["é", "x"]);
});

test("applyDates: refuses a JSON file it could not rewrite without changing its formatting", () => {
  const dir = mkdtempSync(join(tmpdir(), "seo-apply-"));
  writeFileSync(join(dir, "g.json"), '[{"slug":"a","publishAt":"2026-10-21"}]');
  const r = applyDates(site(dir, { type: "json" }), [{ id: "a", file: "g.json", from: "2026-10-21", to: "2026-10-24" }]);
  assert.equal(r.applied.length, 0);
  assert.match(r.skipped[0].reason, /formatting/);
  assert.equal(readFileSync(join(dir, "g.json"), "utf8"), '[{"slug":"a","publishAt":"2026-10-21"}]');
});

test("applyDates: markdown front matter", () => {
  const dir = mkdtempSync(join(tmpdir(), "seo-apply-"));
  writeFileSync(join(dir, "p.md"), "---\ntitle: P\npublishAt: 2026-10-21\n---\nBody\n");
  const r = applyDates(site(dir, { type: "markdown" }), [{ id: "p", file: "p.md", from: "2026-10-21", to: "2026-10-25" }]);
  assert.equal(r.applied.length, 1);
  assert.equal(readFileSync(join(dir, "p.md"), "utf8"), "---\ntitle: P\npublishAt: 2026-10-25\n---\nBody\n");
});

test("metaChanges: finds rewritten titles, descriptions and H1s, ignores new pages and untouched ones", () => {
  const before = [{ slug: "a", metaTitle: "Old", metaDescription: "d", h1: "H" }, { slug: "b", metaTitle: "Same" }];
  const after = [{ slug: "a", metaTitle: "New", metaDescription: "d2", h1: "H" }, { slug: "b", metaTitle: "Same" }, { slug: "c", metaTitle: "Brand new" }];
  assert.deepEqual(metaChanges(before, after), [{ id: "a", fields: ["title", "description"], change: "title, description rewritten" }]);
  assert.deepEqual(metaChanges(null, after), []);
  assert.deepEqual(metaChanges(before, "nope"), []);
});
