import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPages, makeCovered, pipeline, scheduleQueued, parseFrontMatter } from "../src/adapters/index.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "seo-ad-"));
const site = (root, content) => ({ id: "t", url: "https://t.com/", content, paths: { root } });

test("json adapter reads pages, FAQ questions and URLs from routes", async () => {
  const d = tmp(); mkdirSync(join(d, "content"));
  writeFileSync(join(d, "content/guides.json"), JSON.stringify([
    { slug: "a-guide", h1: "A Guide to Widgets", primaryKeyword: "widgets guide", faqs: [{ q: "What is a widget?" }], publishAt: "2026-10-20" },
    { slug: "b", h1: "B", queued: true },
  ]));
  const pages = await loadPages(site(d, { type: "json", include: ["content/**/*.json"], routes: [{ match: "guides.json", urlPattern: "/blog/{slug}" }] }));
  assert.equal(pages.length, 2);
  assert.equal(pages[0].url, "https://t.com/blog/a-guide");
  assert.ok(pages[0].text.includes("what is a widget"));
  assert.equal(pages[1].queued, true);
});

test("markdown adapter reads front matter", async () => {
  const d = tmp(); mkdirSync(join(d, "posts"));
  writeFileSync(join(d, "posts/hello.md"), "---\ntitle: \"Hello World\"\nkeyword: hello\ntags: [a, b]\nqueued: true\n---\nBody");
  const pages = await loadPages(site(d, { type: "markdown", dir: "posts", urlPattern: "/p/{slug}" }));
  assert.equal(pages[0].title, "Hello World");
  assert.equal(pages[0].url, "https://t.com/p/hello");
  assert.equal(pages[0].queued, true);
  assert.deepEqual(parseFrontMatter("---\na: 1\nb: [x, y]\nc: true\n---").b, ["x", "y"]);
});

test("covered() matches existing pages fuzzily and ignores unrelated topics", () => {
  const covered = makeCovered([{ text: "plumbing and hvac automation guide" }], ["ai readiness checklist score"]);
  assert.ok(covered("automation for plumbing"));
  assert.ok(covered("ai readiness checklist"));
  assert.ok(!covered("dental practice marketing"));
});

test("scheduler dates queued pages N a day, respects hold and existing dates", () => {
  const d = tmp(); mkdirSync(join(d, "c"));
  const file = join(d, "c/g.json");
  writeFileSync(file, JSON.stringify([
    { slug: "live", publishAt: "2026-10-12" },
    { slug: "q1", queued: true }, { slug: "q2", queued: true }, { slug: "q3", queued: true },
    { slug: "held", queued: true, hold: true },
  ]));
  const s = site(d, { type: "json", include: ["c/*.json"] });
  const plan = scheduleQueued(s, { perDay: 2, start: "2026-10-12", dry: true });
  assert.deepEqual(plan.map((p) => `${p.date} ${p.id}`), ["2026-10-12 q1", "2026-10-13 q2", "2026-10-13 q3"]);
  assert.ok(readFileSync(file, "utf8").includes('"queued"'), "dry run changes nothing");
  scheduleQueued(s, { perDay: 2, start: "2026-10-12" });
  const out = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(out.find((x) => x.slug === "q1").publishAt, "2026-10-12");
  assert.ok(!("queued" in out.find((x) => x.slug === "q1")));
  assert.equal(out.find((x) => x.slug === "held").queued, true, "held page stays queued");
});

test("scheduler edits markdown front matter", () => {
  const d = tmp(); mkdirSync(join(d, "p"));
  writeFileSync(join(d, "p/a.md"), "---\ntitle: A\nqueued: true\n---\nBody");
  scheduleQueued(site(d, { type: "markdown", dir: "p" }), { perDay: 3, start: "2026-11-01" });
  const out = readFileSync(join(d, "p/a.md"), "utf8");
  assert.match(out, /publishAt: 2026-11-01/);
  assert.ok(!/queued: true/.test(out));
});

test("a sitemap site cannot be scheduled", () => {
  assert.throws(() => scheduleQueued(site(tmp(), { type: "sitemap" }), {}), /json" or "markdown/);
});

test("pipeline counts live, upcoming, queued and held", () => {
  const p = pipeline([
    { publishAt: "2026-10-10", title: "a" }, { publishAt: "2026-10-20", title: "b", url: "u" },
    { queued: true }, { queued: true, hold: true },
  ], "2026-10-11");
  assert.equal(p.tracked, true);
  assert.equal(p.liveThisWeek, 1); assert.equal(p.upcoming, 1); assert.equal(p.queued, 1); assert.equal(p.held, 1);
  assert.equal(p.schedule[0].date, "2026-10-20");
});
