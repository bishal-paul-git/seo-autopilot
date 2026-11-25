import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fakeEmDash } from "./fixtures/fake-emdash.mjs";
import { cms } from "../src/cms/commands.mjs";
import { parseMirror, stringifyMirror, stateOfFile, stateOfItem, validateFile, validateSet, writePlan } from "../src/cms/mirror.mjs";
import { parseFrontMatter } from "../src/adapters/index.mjs";
import { fileFacts } from "../src/cms/mirror.mjs";

const URL_ = "https://cms.example.test";
const para = (text) => ({ _type: "block", _key: "p" + text.length, style: "normal", markDefs: [], children: [{ _type: "span", _key: "s", text, marks: [] }] });
const h2 = (text) => ({ _type: "block", _key: "h" + text.length, style: "h2", markDefs: [], children: [{ _type: "span", _key: "s", text, marks: [] }] });
const linked = (text, href) => ({ _type: "block", _key: "l", style: "normal", markDefs: [{ _key: "a", _type: "link", href }], children: [{ _type: "span", _key: "s1", text: "See ", marks: [] }, { _type: "span", _key: "s2", text, marks: ["a"] }] });

function site(opts = {}) {
  return fakeEmDash({
    posts: [
      { slug: "first-post", data: { title: "First post", excerpt: "Short summary.", content: [para("Intro words for the first post."), h2("Section one"), linked("the guide", "/posts/second-post")], featured_image: { id: "m1", src: "/_emdash/api/media/file/m1.jpg", alt: "A photo" } }, seo: { title: "First post | Example", description: "About the first post." }, terms: { category: ["guides"], tag: ["basics"] } },
      { slug: "second-post", publishedAt: null, data: { title: "Second post", content: [para("Line one\nline two of the same paragraph."), { _type: "table", _key: "t", rows: [["a", "b"]] }] } },
      { slug: "third-post", data: { title: "Third post", content: [para("Third post body text here.")] } },
    ],
    ...opts,
  });
}

async function run(args, fake, env = {}) {
  const flags = {}; const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) { const [k, v] = a.slice(2).split("="); if (v !== undefined) flags[k] = v; else if (args[i + 1] && !args[i + 1].startsWith("--")) flags[k] = args[++i]; else flags[k] = true; }
    else positional.push(a);
  }
  const saved = { log: console.log, url: process.env.EMDASH_URL, token: process.env.EMDASH_TOKEN, proven: process.env.EMDASH_REVISIONS_PROVEN };
  const lines = [];
  console.log = (s) => lines.push(String(s));
  process.env.EMDASH_URL = URL_;
  process.env.EMDASH_TOKEN = "test-token-not-real";
  delete process.env.EMDASH_REVISIONS_PROVEN;
  Object.assign(process.env, env);
  try {
    const code = await cms({ flags, positional }, { fetch: fake.fetch });
    return { code, report: JSON.parse(lines.join("\n")) };
  } finally {
    console.log = saved.log;
    for (const [k, v] of [["EMDASH_URL", saved.url], ["EMDASH_TOKEN", saved.token], ["EMDASH_REVISIONS_PROVEN", saved.proven]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

const tmp = () => mkdtempSync(join(tmpdir(), "cms-mirror-"));
const edit = (file, fn) => { const p = parseMirror(readFileSync(file, "utf8")); fn(p); writeFileSync(file, stringifyMirror(p.meta, p.body)); };
const writes = (fake) => fake.log.filter((l) => l.method !== "GET" && l.path.startsWith("/_emdash/"));

test("export writes one file per published post that converts back unchanged", async () => {
  const fake = site(); const dir = tmp();
  const { code, report } = await run(["export", "--dir", dir, "--sitemap", "/sitemap.xml"], fake);
  assert.equal(code, 0);
  assert.deepEqual(report.written.sort(), ["first-post", "second-post", "third-post"]);
  assert.deepEqual(report.skipped, []);
  assert.deepEqual(report.noPublishedAt, ["second-post"]);
  assert.equal(report.opaque[0].slug, "second-post");
  assert.equal(report.seoEnabled, true);
  assert.deepEqual(report.sitemap.listedNotInSitemap, []);
  assert.equal(writes(fake).length, 0, "export only reads");
  const text = readFileSync(join(dir, "first-post.md"), "utf8");
  const parsed = parseMirror(text);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.meta.seoTitle, "First post | Example");
  assert.deepEqual(parsed.meta.categories, ["guides"]);
  assert.equal(parsed.meta.image, "/_emdash/api/media/file/m1.jpg");
  assert.ok(parsed.meta.baseRev);
  // The file states exactly what the CMS holds.
  const live = (await fake.fetch(`${URL_}/_emdash/api/content/posts/first-post`, { headers: { authorization: "x" } }).then((r) => r.json())).data.item;
  assert.deepEqual(stateOfFile(parsed), stateOfItem(live));
  // The project's own front-matter reader (markdown adapter) reads the same file.
  const fm = parseFrontMatter(text);
  assert.equal(fm.title, "First post");
  assert.equal(fm.slug, "first-post");
  // Plain Markdown headings and links, as a Markdown content-loss guard reads them; and the mirror's own facts.
  assert.deepEqual([...text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1]), ["Section one"]);
  assert.deepEqual([...text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]), ["/posts/second-post"]);
  const f = fileFacts(parsed);
  assert.equal(f.words, 11);
  assert.deepEqual(f.headings, [{ level: 2, text: "Section one" }]);
  assert.deepEqual(f.links, ["/posts/second-post"]);
  assert.equal(f.seo.seoTitle, "First post | Example");
  // The second post keeps its line break inside one block and its table as an opaque block.
  const second = readFileSync(join(dir, "second-post.md"), "utf8");
  assert.match(second, /Line one\\\nline two/);
  assert.match(second, /<!--ec:block \{"_type":"table"/);
});

test("validate catches slug, read-only, length, fence and duplicate problems", () => {
  const base = parseMirror(stringifyMirror({ id: "1", slug: "a-post", title: "T", excerpt: null, categories: ["x"], noIndex: false, canonical: null }, "Some words here.\n"));
  const head = structuredClone(base);
  head.meta.slug = "a-new-url"; head.meta.categories = ["y"]; head.meta.seoDescription = "d".repeat(501); head.meta.noIndex = true;
  head.body = "Some words here.\n\n<!--ec:block {broken -->\n";
  const v = validateFile(head, { file: "content/a-post.md", base });
  assert.ok(v.errors.some((e) => /slug changed/.test(e)));
  assert.ok(v.errors.some((e) => /categories is a read-only/.test(e)));
  assert.ok(v.errors.some((e) => /seoDescription is 501/.test(e)));
  assert.ok(v.errors.some((e) => /line 3: a <!--ec:block --> line is broken/.test(e)));
  assert.ok(v.highRisk.some((h) => /noIndex/.test(h)));
  const fresh = parseMirror(stringifyMirror({ slug: "مقال-جديد", title: "New" }, "Words.\n"));
  assert.ok(validateFile(fresh, { file: "مقال-جديد.md" }).errors.some((e) => /new post slug/.test(e)));
  const dup = validateSet([{ file: "a.md", parsed: parseMirror(stringifyMirror({ id: "1", slug: "a", title: "A" }, "x\n")) }, { file: "b.md", parsed: parseMirror(stringifyMirror({ id: "1", slug: "a", title: "B" }, "y\n")) }]);
  assert.equal(dup.ok, false);
  assert.ok(dup.results[1].errors.some((e) => /also used by a\.md/.test(e)));
});

test("a draft save on a live post is refused while revisions are unproven, and makes no write", async () => {
  const fake = site(); const dir = tmp();
  await run(["export", "--dir", dir], fake);
  const file = join(dir, "third-post.md");
  const base = join(dir, "base.md.txt"); copyFileSync(file, base);
  edit(file, (p) => { p.body += "\nA new closing paragraph.\n"; });
  const before = writes(fake).length;
  const { code, report } = await run(["draft", "--file", file, "--base", base], fake);
  assert.equal(code, 3);
  assert.equal(report.refused, true);
  assert.match(report.error, /preview-check/);
  assert.equal(writes(fake).length, before);
});

test("a collection without revisions is never written to", async () => {
  const fake = site({ revisions: false, schemaReadable: true }); const dir = tmp();
  await run(["export", "--dir", dir], fake);
  const file = join(dir, "third-post.md");
  edit(file, (p) => { p.body += "\nMore.\n"; });
  const { code, report } = await run(["draft", "--file", file, "--revisions-proven"], fake);
  assert.equal(code, 3);
  assert.match(report.error, /does not keep revisions/);
  assert.equal(writes(fake).length, 0);
});

test("draft keeps the live post unchanged; publish makes the file live; revert publishes the old file", async () => {
  const fake = site(); const dir = tmp();
  await run(["export", "--dir", dir], fake);
  const file = join(dir, "first-post.md");
  const v1 = join(dir, "v1.md.txt"); copyFileSync(file, v1);
  edit(file, (p) => { p.meta.title = "First post, refreshed"; p.meta.seoDescription = "A better description."; p.body += "\n## New section\n\nNew words added in the refresh.\n"; });
  const liveBefore = structuredClone(fake.find("first-post").data);
  const seoBefore = { ...fake.seoRows.get(fake.find("first-post").id) };

  const d = await run(["draft", "--file", file, "--base", v1, "--revisions-proven"], fake);
  assert.equal(d.code, 0, JSON.stringify(d.report));
  assert.equal(d.report.draftSaved, true);
  assert.equal(d.report.previewUrl, null);
  assert.equal(d.report.previewError, "NOT_CONFIGURED");
  assert.deepEqual(fake.find("first-post").data, liveBefore, "live row untouched by the draft");
  assert.deepEqual(fake.seoRows.get(fake.find("first-post").id), seoBefore, "SEO untouched by the draft");

  const p = await run(["publish", "--file", file, "--base", v1, "--revisions-proven", "--write-back"], fake);
  assert.equal(p.code, 0, JSON.stringify(p.report));
  assert.equal(p.report.verified, true);
  assert.equal(p.report.seoSet, true);
  const live = fake.find("first-post");
  assert.equal(live.data.title, "First post, refreshed");
  assert.equal(fake.seoRows.get(live.id).description, "A better description.");
  assert.equal(fake.seoRows.get(live.id).title, "First post | Example", "unchanged SEO keys stay");
  const after = parseMirror(readFileSync(file, "utf8"));
  assert.notEqual(after.meta.baseRev, parseMirror(readFileSync(v1, "utf8")).meta.baseRev);

  // Publishing the same file again changes nothing.
  const again = await run(["publish", "--file", file, "--revisions-proven"], fake);
  assert.equal(again.code, 0);
  assert.equal(again.report.reason, "the CMS already matches the file");
  // A retried job still passes the old base; the CMS already holds the new file, so that is not drift.
  const retried = await run(["publish", "--file", file, "--base", v1, "--revisions-proven"], fake);
  assert.equal(retried.code, 0, JSON.stringify(retried.report));
  assert.equal(retried.report.published, false);

  // Revert: the previous version is published back, checked against the version now live.
  const v2 = join(dir, "v2.md.txt"); copyFileSync(file, v2);
  copyFileSync(v1, file);
  const r = await run(["publish", "--file", file, "--base", v2, "--revisions-proven"], fake);
  assert.equal(r.code, 0, JSON.stringify(r.report));
  assert.deepEqual(stateOfItem(structuredClone({ ...fake.find("first-post"), seo: fake.seoRows.get(fake.find("first-post").id) })), stateOfFile(parseMirror(readFileSync(v1, "utf8"))));
  assert.ok(!fake.log.some((l) => l.path.includes("/revisions/")), "never uses revision restore");
});

test("an edit made in the CMS outside the mirror stops the write", async () => {
  const fake = site(); const dir = tmp();
  await run(["export", "--dir", dir], fake);
  const file = join(dir, "third-post.md");
  const base = join(dir, "base.md.txt"); copyFileSync(file, base);
  fake.find("third-post").data.title = "Edited in the admin";
  edit(file, (p) => { p.body += "\nMore words.\n"; });
  const { code, report } = await run(["publish", "--file", file, "--base", base, "--revisions-proven"], fake);
  assert.equal(code, 3);
  assert.match(report.error, /changed outside the mirror \(title/);
});

test("someone else's unpublished CMS draft stops the write", () => {
  const head = { slug: "a", title: "Mine", excerpt: null, body: [], seo: null };
  const live = { ...head, title: "Live" };
  const plan = writePlan({ live, base: live, pendingDraft: { ...head, title: "Theirs" }, head });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /unpublished draft/);
  assert.equal(writePlan({ live, base: live, pendingDraft: head, head }).ok, true, "our own earlier draft is fine");
});

test("a new post: explicit slug, one draft across re-runs, then published; a taken slug is refused", async () => {
  const fake = site(); const dir = tmp();
  const file = join(dir, "new-guide.md");
  writeFileSync(file, stringifyMirror({ id: null, slug: "new-guide", title: "A new guide", excerpt: "Summary.", seoTitle: "New guide", seoDescription: null, seoImage: null, canonical: null, noIndex: false }, "## Why\n\nWords of the new guide.\n"));
  const d1 = await run(["draft", "--file", file], fake);
  assert.equal(d1.code, 0, JSON.stringify(d1.report));
  const d2 = await run(["draft", "--file", file], fake);
  assert.equal(d2.code, 0);
  assert.equal([...fake.rows.values()].filter((r) => r.slug === "new-guide").length, 1);
  assert.equal(fake.find("new-guide").status, "draft");
  const p = await run(["publish", "--file", file, "--write-back"], fake);
  assert.equal(p.code, 0, JSON.stringify(p.report));
  assert.equal(fake.find("new-guide").status, "published");
  assert.equal(parseMirror(readFileSync(file, "utf8")).meta.id, fake.find("new-guide").id);
  const taken = join(dir, "third-post.md");
  writeFileSync(taken, stringifyMirror({ slug: "third-post", title: "Clash" }, "Words.\n"));
  const t = await run(["draft", "--file", taken], fake);
  assert.equal(t.code, 3);
  assert.match(t.report.error, /already used by a published post/);
});

test("preview-check makes one private draft, proves revisions, and leaves live pages alone", async () => {
  const fake = site({ previewSecret: true });
  const args = ["preview-check", "--title", "TEST preview check, do not publish", "--slug", "preview-check-test"];
  const a = await run(args, fake);
  assert.equal(a.code, 0, JSON.stringify(a.report));
  assert.equal(a.report.revisions, true);
  assert.equal(a.report.preview.ok, true);
  assert.equal(a.report.checks.publicUrlHidden, true);
  assert.equal(a.report.checks.notIn_sitemap, true);
  assert.equal(a.report.checks.notIn_rss, true);
  assert.equal(a.report.existingPages.length, 3);
  assert.ok(a.report.existingPages.every((p) => p.unchanged && p.before.status === 200));
  const b = await run(args, fake);
  assert.equal(b.report.created, false);
  assert.equal([...fake.rows.values()].filter((r) => r.slug === "preview-check-test").length, 1);
  assert.equal(fake.find("preview-check-test").status, "draft");
  assert.ok(!writes(fake).some((l) => /publish|unpublish|DELETE/.test(l.path + l.method)));
  // Only the throwaway draft was ever written to.
  const id = fake.find("preview-check-test").id;
  assert.ok(writes(fake).every((l) => l.path.includes(id) || l.path.includes("preview-check-test") || l.path === "/_emdash/api/content/posts"));
});

test("preview-check without a preview secret reports it and still checks privacy", async () => {
  const fake = site();
  const { code, report } = await run(["preview-check", "--title", "TEST", "--slug", "preview-check-test"], fake);
  assert.equal(code, 0);
  assert.equal(report.preview.ok, false);
  assert.equal(report.preview.error, "NOT_CONFIGURED");
});

test("the token never appears in output and plain http is refused for a remote host", async () => {
  const fake = site(); const dir = tmp();
  const { report } = await run(["export", "--dir", dir], fake);
  assert.ok(!JSON.stringify(report).includes("test-token-not-real"));
  const { createClient } = await import("../src/cms/emdash.mjs");
  assert.throws(() => createClient({ url: "http://cms.example.test", token: "x" }), /https/);
  assert.doesNotThrow(() => createClient({ url: "http://localhost:4321", token: "x" }));
});

test("validate --base-ref reads the previous version from git", () => {
  const dir = tmp();
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  git("init", "-q"); git("config", "user.email", "t@example.test"); git("config", "user.name", "t");
  const file = join(dir, "a-post.md");
  writeFileSync(file, stringifyMirror({ id: "1", slug: "a-post", title: "A", categories: ["x"] }, "Words here.\n"));
  git("add", "."); git("commit", "-qm", "base");
  edit(file, (p) => { p.meta.categories = ["y"]; });
  const lines = []; const log = console.log; console.log = (s) => lines.push(s);
  let code;
  try { code = validateCmdSync(["--dir", dir, "--base-ref", "HEAD"]); } finally { console.log = log; }
  assert.equal(code, 1);
  assert.match(lines.join(""), /categories is a read-only/);
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith(".md")), ["a-post.md"]);
});

import { validateCmd } from "../src/cms/commands.mjs";
function validateCmdSync(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 2) flags[args[i].slice(2)] = args[i + 1];
  return validateCmd(flags);
}
