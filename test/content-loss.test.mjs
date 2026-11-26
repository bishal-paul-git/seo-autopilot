// Content-loss guard: a forced refresh must never quietly shrink a page. Each kind of loss is tested on its own, in English
// and Arabic, in Markdown, HTML and JSON page lists; so are the things that must NOT fail (rewording, small trims, new pages).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countWords, textFacts, objectFacts, pagesInFile, comparePage, guardFiles, guardTable, overrideApplied, revertTrusted, newPageWarnings, internalLink } from "../src/analysis/content-loss.mjs";

const SITE = "https://example.test/";
const EN = [
  "A good running shoe fits the shape of your foot rather than the other way round.",
  "Try shoes on late in the day, when your feet are slightly larger after hours of walking.",
  "Leave about a thumb's width of space between your longest toe and the front of the shoe.",
  "Cushioning helps on long road runs, while a firmer sole gives more feedback on trails.",
  "Replace your shoes when the midsole feels flat or the tread has worn smooth in places.",
  "Rotating two pairs lets the foam recover between runs and spreads the wear more evenly.",
];
const AR = [
  "تحتاج النباتات المنزلية إلى ضوء غير مباشر في معظم الأحيان، لذلك ضعها قرب نافذة مع ستارة خفيفة.",
  "اسقِ النبتة عندما تجف الطبقة العليا من التربة، ولا تترك الماء راكدًا في الصحن أسفل الأصيص.",
  "تُفضّل أغلب النباتات رطوبة معتدلة، ويمكن رفعها بوضع الأصيص فوق حصى مبلل بالماء.",
  "سمّد النبتة مرة كل شهر خلال الربيع والصيف، وتوقف عن التسميد في فصل الشتاء.",
  "انقل النبتة إلى أصيص أكبر حين تخرج الجذور من فتحات التصريف في الأسفل.",
  "نظّف الأوراق بقطعة قماش رطبة حتى تتنفس النبتة وتحصل على ضوء أكثر.",
];
/** About `n` words of paragraphs cycling through `sentences`, with H2 sections every 5 paragraphs. */
function article(sentences, n, { h2 = "Section", link = "/guides/fit", image = "/img/shoe.jpg" } = {}) {
  const parts = [];
  let words = 0, i = 0, para = 0;
  while (words < n) {
    if (para % 5 === 0) parts.push(`## ${h2} ${para / 5 + 1}`);
    const p = sentences.slice(i % sentences.length).concat(sentences.slice(0, i % sentences.length)).slice(0, 3).join(" ");
    parts.push(p); words += countWords(p); i++; para++;
  }
  parts.splice(2, 0, `Read [our fitting guide](${link}) and look at ![the sole](${image}).`);
  return parts.join("\n\n");
}
const md = (title, body, extra = "") => `---\ntitle: "${title}"\nslug: guide\nimage: /img/cover.webp\n${extra}---\n\n# ${title}\n\n${body}\n`;
const run = (before, after, path = "content/blog/guide.md", o = {}) => guardFiles([{ path, before, after }], { siteUrl: SITE, ...o });

test("words are counted in any script: Arabic with and without vowel marks, accented Latin, digits; CJK per character", () => {
  assert.equal(countWords("مرحبا بكم في مدونتنا، هذه مقالة عن تحسين محركات البحث."), 10);
  assert.equal(countWords("مَرْحَبًا بِكُمْ"), 2, "vowel marks (harakat) stay inside the word");
  assert.equal(countWords("Café crème, naïve résumé: 3 items"), 6);
  assert.equal(countWords("state-of-the-art it's 2026"), 3);
  assert.equal(countWords("中文字"), 3);
  assert.equal(countWords("١٢٣ كتابًا"), 2, "Arabic-Indic digits count");
  assert.ok(countWords(article(AR, 2000)) >= 2000 && countWords(article(EN, 2000)) >= 2000);
});

for (const [lang, sentences, title] of [["English", EN, "How to choose a running shoe"], ["Arabic", AR, "دليل العناية بالنباتات المنزلية"]]) {
  test(`negative test (${lang}): a forced refresh that cuts a 2,000-word post to 300 words is BLOCKED`, () => {
    const before = md(title, article(sentences, 2000)), after = md(title, article(sentences, 300));
    const r = run(before, after);
    assert.equal(r.failed, 1);
    const p = r.pages[0];
    assert.equal(p.status, "fail");
    assert.ok(p.words.before >= 2000 && p.words.after < 400, `${p.words.before} -> ${p.words.after}`);
    assert.ok(p.words.dropPercent > 80);
    assert.match(p.reasons[0], /words fell/);
    assert.ok(p.removed.headings.length > 0, "the cut sections' headings are listed as removed");
    const table = guardTable(r);
    assert.match(table, /FAILED/);
    assert.match(table, new RegExp(`${p.words.before} -> ${p.words.after}`));
  });

  test(`${lang}: removing exactly one heading, one internal link, one image or one JSON-LD block each blocks`, () => {
    const body = article(sentences, 600) + `\n\n<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script>\n`;
    const base = md(title, body);
    assert.equal(run(base, base).failed, 0, "unchanged passes");
    const cases = {
      heading: base.replace(/\n## \S+ 2\n/, "\n"),
      link: base.replace("[our fitting guide](/guides/fit)", "our fitting guide"),
      image: base.replace("![the sole](/img/shoe.jpg)", ""),
      jsonld: base.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, ""),
      "front-matter image": base.replace("image: /img/cover.webp\n", ""),
    };
    for (const [what, after] of Object.entries(cases)) {
      assert.notEqual(after, base, what);
      const r = run(base, after);
      assert.equal(r.failed, 1, `${what} removal must fail`);
      const p = r.pages[0];
      if (what === "heading") assert.equal(p.removed.headings.length, 1);
      if (what === "link") assert.deepEqual(p.removed.links, ["/guides/fit"]);
      if (what === "image") assert.deepEqual(p.removed.images, ["/img/shoe.jpg"]);
      if (what === "front-matter image") assert.deepEqual(p.removed.images, ["/img/cover.webp"]);
      if (what === "jsonld") assert.ok(p.removed.schema.includes("FAQPage"));
      assert.ok(p.words.dropPercent < 15, `${what}: fails on the removal itself, not on words (${p.words.dropPercent}%)`);
    }
  });
}

test("word threshold: a 10% trim passes, 16% fails, and the limit is configurable", () => {
  const sentence = "Short sentences make a page easier to read on a small screen.";
  const page = (n) => md("Readable pages", Array.from({ length: n }, () => sentence).join(" "));
  const base = page(100);
  assert.equal(run(base, page(90)).failed, 0);
  assert.equal(run(base, page(84)).failed, 1);
  assert.equal(run(base, page(84), undefined, { maxWordDropPercent: 20 }).failed, 0);
  assert.equal(run(base, page(130)).failed, 0, "growing is fine");
});

test("a reworded heading is a warning, not a failure; a heading gone with nothing in its place fails", () => {
  const base = md("Care guide", "## Watering\n\nWater weekly in summer and less in winter.\n\n## Light\n\nBright, indirect light suits most plants.\n\n[More](/care)");
  const reworded = base.replace("## Watering", "## How often to water");
  const r = run(base, reworded);
  assert.equal(r.failed, 0);
  assert.match(r.pages[0].warnings[0], /H2 reworded: "Watering" -> "How often to water"/);
  assert.equal(run(base, base.replace("## Light\n\n", "")).failed, 1);
  assert.equal(run(base, base.replace("## Watering", "## **Watering**")).failed, 0, "formatting is not a change of text");
});

test("the limit is compared unrounded: a 15.04% drop fails at a 15% limit", () => {
  const page = (n) => md("Readable", Array.from({ length: n }, (_, i) => `word${i}`).join(" "));
  const r = run(page(9999), page(8495)); // 10,000 -> 8,496 words with the title: 15.04%
  assert.equal(r.pages[0].words.dropPercent, 15.04);
  assert.equal(r.failed, 1);
  assert.equal(run(page(9999), page(8500)).failed, 0, "15.00% is at the limit, not over it");
});

test("a deleted section with a tiny unrelated H2 put in its place counts as a removed heading", () => {
  const base = md("Plans", "## Our pricing plans\n\nThree plans, billed monthly or yearly, each with a free trial.\n\n## Support\n\nEmail and chat on weekdays.\n\n[More](/help)");
  const r = run(base, base.replace("## Our pricing plans", "## More"));
  assert.equal(r.failed, 1);
  assert.match(r.pages[0].reasons.join(" "), /heading\(s\) removed: H2 "Our pricing plans"/);
  assert.equal(run(base, base.replace("## Our pricing plans", "## Our plans and pricing")).failed, 0, "a real rewording still passes");
});

test("hidden or commented-out text does not count: MDX comments, hidden elements, Liquid and HTML comments", () => {
  const body = article(EN, 600);
  const base = md("Guide", body);
  for (const [name, wrap] of [
    ["MDX {/* */}", (b) => `{/*\n${b}\n*/}\n\nShort.`],
    ["<div hidden>", (b) => `<div hidden>\n\n${b}\n\n</div>\n\nShort.`],
    ["style display:none", (b) => `<section style="display: none">\n\n${b}\n\n</section>\n\nShort.`],
    ["class sr-only", (b) => `<div class="note sr-only">\n\n${b}\n\n</div>\n\nShort.`],
    ["Jekyll {% comment %}", (b) => `{% comment %}\n${b}\n{% endcomment %}\n\nShort.`],
    ["HTML <!-- -->", (b) => `<!--\n${b}\n-->\n\nShort.`],
  ]) {
    const r = run(base, md("Guide", wrap(body)), "content/blog/guide.mdx");
    assert.equal(r.failed, 1, name);
    assert.ok(r.pages[0].words.after < 20, `${name}: ${r.pages[0].words.after} words counted`);
  }
  assert.equal(run(base, md("Guide", `<div class="hidden md:block">\n\n${body}\n\n</div>`)).failed, 0, "shown on wider screens: counts");
});

test("page settings: draft, noindex, canonical, permalink and slug changes fail (front matter, HTML head, JSON)", () => {
  const body = article(EN, 400);
  const base = md("Guide", body, "canonical: https://example.test/blog/guide\npermalink: /blog/guide/\n");
  for (const [name, after] of [
    ["draft: true", md("Guide", body, "canonical: https://example.test/blog/guide\npermalink: /blog/guide/\ndraft: true\n")],
    ["noindex: true", md("Guide", body, "canonical: https://example.test/blog/guide\npermalink: /blog/guide/\nnoindex: true\n")],
    ["canonical elsewhere", md("Guide", body, "canonical: https://other.test/guide\npermalink: /blog/guide/\n")],
    ["permalink", md("Guide", body, "canonical: https://example.test/blog/guide\npermalink: /blog/old-guide/\n")],
    ["slug", md("Guide", body, "canonical: https://example.test/blog/guide\npermalink: /blog/guide/\n").replace("slug: guide", "slug: guide-2")],
  ]) {
    const r = run(base, after);
    assert.equal(r.failed, 1, name);
    assert.match(r.pages[0].reasons.join(" "), /page settings changed/, name);
  }
  const html = (head) => `<html><head><title>Guide</title>${head}</head><body><h1>Guide</h1><p>${body}</p></body></html>`;
  assert.equal(run(html(""), html('<meta name="robots" content="noindex">'), "guide.html").failed, 1, "meta robots noindex");
  assert.equal(run(html('<link rel="canonical" href="https://example.test/guide">'), html('<link rel="canonical" href="https://other.test/">'), "guide.html").failed, 1, "link canonical");
  const page = (extra) => JSON.stringify([{ slug: "guide", title: "Guide", body: EN.join(" "), ...extra }], null, 2);
  assert.equal(run(page({}), page({ draft: true }), "data/pages.json").failed, 1, "JSON draft");
  assert.equal(run(page({ status: "published" }), page({ status: "draft" }), "data/pages.json").failed, 1, "JSON status draft");
  assert.equal(run(page({ status: "published" }), page({ status: "published" }), "data/pages.json").failed, 0, "unchanged");
});

test("internal links: relative, root and same-host absolute links count (www ignored); external, anchors and mail do not", () => {
  assert.equal(internalLink("/a/b/", SITE), "/a/b");
  assert.equal(internalLink("https://www.example.test/a#top", SITE), "/a");
  assert.equal(internalLink("https://other.test/a", SITE), null);
  assert.equal(internalLink("#faq", SITE), null);
  assert.equal(internalLink("mailto:x@example.test", SITE), null);
  const base = md("Links", "See [x](https://other.test/a) and [y](/b) and <a href=\"https://example.test/c\">c</a>.");
  assert.equal(run(base, base.replace("[x](https://other.test/a)", "x")).failed, 0, "an external link is not an internal link");
  assert.equal(run(base, base.replace('<a href="https://example.test/c">c</a>', "c")).failed, 1);
});

test("HTML pages: words, headings, links, images and JSON-LD from the body; the head and scripts are not words", () => {
  const html = (extra = "") => `<!doctype html><html><head><title>T</title><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Article"},{"@type":"BreadcrumbList"}]}</script></head><body><h1>Guide</h1><h2>Steps</h2><p>${EN.join(" ")}</p><a href="/next">Next</a><img src="/img/a.png" alt="a">${extra}</body></html>`;
  const f = textFacts(html(), { format: "html", siteUrl: SITE });
  assert.deepEqual(f.headings.map((h) => h.level), [1, 2]);
  assert.deepEqual(f.links, ["/next"]); assert.deepEqual(f.images, ["/img/a.png"]);
  assert.deepEqual(f.schema.types.sort(), ["Article", "BreadcrumbList"]);
  const r = guardFiles([{ path: "public/guide.html", before: html(), after: html().replace(/\{"@type":"BreadcrumbList"\}/, "").replace(",]", "]") }], { siteUrl: SITE });
  assert.equal(r.failed, 1); assert.deepEqual(r.pages[0].removed.schema, ["BreadcrumbList"]);
});

test("JSON page lists: each page compared by slug; nested sections, links, images and schema; removed pages fail; new pages warn", () => {
  const page = (o = {}) => ({ slug: "fit", h1: "Shoe fit", metaTitle: "Shoe fit guide", body: EN.join(" "), sections: [{ heading: "Toe room", text: EN.slice(0, 3).join(" "), image: "/img/toe.jpg" }, { heading: "Heel", text: EN.slice(3).join(" "), link: "/guides/heel" }], schema: { "@type": "HowTo" }, ...o });
  const other = { slug: "socks", h1: "Socks", body: "Wool socks keep feet dry on long runs. See [shoes](/guides/fit)." };
  const file = (list) => JSON.stringify(list, null, 2);
  const f = objectFacts(page(), { siteUrl: SITE });
  assert.deepEqual(f.headings.map((h) => `${h.level}:${h.text}`), ["1:Shoe fit", "2:Toe room", "2:Heel"]);
  assert.deepEqual(f.links, ["/guides/heel"]); assert.deepEqual(f.images, ["/img/toe.jpg"]); assert.deepEqual(f.schema.types, ["HowTo"]);
  const base = file([page(), other]);
  assert.equal(guardFiles([{ path: "src/content/guides.json", before: base, after: base }], { siteUrl: SITE }).failed, 0);
  const noSchema = page(); delete noSchema.schema;
  for (const [what, after] of [["section", page({ sections: [page().sections[0]] })], ["schema", noSchema], ["image", page({ sections: [{ ...page().sections[0], image: undefined }, page().sections[1]] })]]) {
    const r = guardFiles([{ path: "src/content/guides.json", before: base, after: file([after, other]) }], { siteUrl: SITE });
    assert.equal(r.failed, 1, what);
    assert.equal(r.pages.find((p) => p.id === "fit").status, "fail", what);
    assert.equal(r.pages.find((p) => p.id === "socks").status, "pass", `${what}: the untouched page passes`);
  }
  const gone = guardFiles([{ path: "src/content/guides.json", before: base, after: file([page()]) }], { siteUrl: SITE });
  assert.equal(gone.failed, 1); assert.match(gone.pages.find((p) => p.id === "socks").reasons[0], /removed from the file/);
  const added = guardFiles([{ path: "src/content/guides.json", before: base, after: file([page(), other, { slug: "laces", h1: "Lacing", body: "" }]) }], { siteUrl: SITE });
  assert.equal(added.failed, 0);
  const n = added.pages.find((p) => p.id === "laces");
  assert.equal(n.status, "new"); assert.deepEqual(n.warnings, ["no internal link"]);
  const empty = guardFiles([{ path: "src/content/guides.json", before: base, after: file([page(), other, { slug: "empty" }]) }], { siteUrl: SITE }).pages.find((p) => p.id === "empty");
  assert.deepEqual(empty.warnings, ["the page has no text", "no H1 (and no title in the front matter that a template could use)", "no internal link"]);
});

test("files that are not content are ignored; a deleted page file and broken JSON fail", () => {
  assert.equal(pagesInFile("package.json", '{"name":"x","scripts":{}}'), null);
  assert.equal(pagesInFile("redirects.json", '[{"from":"/a","to":"/b"}]'), null);
  assert.equal(pagesInFile("notes.txt", "hello"), null);
  assert.equal(guardFiles([{ path: "redirects.json", before: '[{"from":"/a","to":"/b"}]', after: "[]" }]).checked, 0);
  const del = run(md("Old", "Some text [x](/y)"), null);
  assert.equal(del.failed, 1); assert.match(del.pages[0].reasons[0], /deleted/);
  const broken = guardFiles([{ path: "c/pages.json", before: '[{"slug":"a","h1":"A"}]', after: '[{"slug":"a",' }]);
  assert.equal(broken.failed, 1);
});

test("new pages: only sanity warnings (no text, no H1, no internal link), never a failure", () => {
  const r = run(null, "---\nslug: new\n---\n\nJust a line.\n", "content/blog/new.md");
  assert.equal(r.failed, 0); assert.equal(r.pages[0].status, "new");
  assert.deepEqual(r.pages[0].warnings, ["no H1 (and no title in the front matter that a template could use)", "no internal link"]);
  assert.deepEqual(newPageWarnings(textFacts(md("Good", "Text with [a link](/x)."))), []);
});

test("an exact undo of the latest change passes as a restore", () => {
  const r = guardFiles([{ path: "content/a.md", before: md("A", "long text ".repeat(50)), after: md("A", "short"), restores: "abc1234" }]);
  assert.equal(r.failed, 0); assert.equal(r.pages[0].status, "restore");
});

test("Markdown details: code blocks are not headings or links; setext headings count; MDX components count", () => {
  const f = textFacts("---\ntitle: X\n---\nIntro\n\nTitle\n=====\n\n```bash\n# not a heading\ncurl [x](/not-a-link)\n```\n\n<Link href=\"/real\">Real</Link> <Image src=\"/img/x.avif\" />\n");
  assert.deepEqual(f.headings, [{ level: 1, text: "Title" }]);
  assert.deepEqual(f.links, ["/real"]); assert.deepEqual(f.images, ["/img/x.avif"]);
});

test("override: only a person who is not the author, with the label still on; bots, the author and unknown never count", () => {
  const ev = (actor, type = "User", label = "allow-content-shrink") => ({ event: "labeled", label, actor, type });
  assert.equal(overrideApplied({ labels: [], events: [ev("editor")] }).applied, false, "label removed since");
  assert.equal(overrideApplied({ labels: ["allow-content-shrink"], events: [] }).applied, false, "events unreadable: fail closed");
  assert.equal(overrideApplied({ labels: ["allow-content-shrink"], events: [ev("github-actions[bot]", "Bot")] }).applied, false);
  assert.equal(overrideApplied({ labels: ["allow-content-shrink"], events: [ev("someone[bot]", "User")] }).applied, false);
  assert.equal(overrideApplied({ labels: ["allow-content-shrink"], events: [ev("agent-user")], author: "agent-user" }).applied, false, "the author cannot approve their own shrink");
  assert.equal(overrideApplied({ labels: ["allow-content-shrink"], events: [ev("editor"), ev("github-actions[bot]", "Bot")], author: "agent-user" }).applied, false, "the latest add decides");
  const ok = overrideApplied({ labels: ["allow-content-shrink"], events: [ev("editor"), { event: "labeled", label: "seo-refresh", actor: "x", type: "Bot" }], author: "agent-user" });
  assert.equal(ok.applied, true); assert.equal(ok.by, "editor");
  assert.match(guardTable({ pages: [{ file: "a.md", id: "a.md", status: "fail", reasons: ["x"], before: textFacts("a b c"), after: textFacts("a"), removed: { headings: [], links: [], images: [], schema: [] }, words: { before: 3, after: 1, dropPercent: 66.7 } }], failed: 1, checked: 1 }, { override: ok }), /allowed by the human override/);
});

test("revertTrusted: only a seo/revert-<n> pull request opened and labelled seo-revert by the watch's account", () => {
  const bot = "github-actions[bot]", lab = (actor) => ({ event: "labeled", label: { name: "seo-revert" }, actor: { login: actor, type: "Bot" } });
  assert.equal(revertTrusted({ branch: "seo/revert-4", author: bot, labels: ["seo-revert"], events: [lab(bot)] }).trusted, true);
  assert.equal(revertTrusted({ branch: "seo/revert-4", author: bot, labels: ["seo-revert"], events: [lab(bot), lab("someone")] }).trusted, false, "the last labeller counts");
  assert.equal(revertTrusted({ branch: "seo/revert-x", author: bot, labels: ["seo-revert"], events: [lab(bot)] }).trusted, false);
  assert.equal(revertTrusted({ branch: "seo/issue-4", author: bot, labels: ["seo-revert"], events: [lab(bot)] }).trusted, false);
  assert.equal(revertTrusted({ branch: "seo/revert-4", author: "a-person", labels: ["seo-revert"], events: [lab("a-person")] }).trusted, false);
});

const git = (cwd, ...args) => { const r = spawnSync("git", args, { cwd, encoding: "utf8" }); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };
function repo() {
  const root = mkdtempSync(join(tmpdir(), "seo-guard-"));
  git(root, "init", "-q", "-b", "main"); git(root, "config", "user.email", "t@example.test"); git(root, "config", "user.name", "t"); git(root, "config", "commit.gpgsign", "false");
  mkdirSync(join(root, "content", "blog"), { recursive: true });
  writeFileSync(join(root, "seo-autopilot.config.json"), JSON.stringify({ sites: [{ id: "ex", name: "Ex", url: SITE, searchConsoleProperty: SITE, sitemap: SITE + "sitemap.xml", content: { type: "markdown", dir: "content/blog", urlPattern: "/blog/{slug}" } }] }, null, 2));
  return root;
}
// Runs the guard the way seo-check does: from a folder outside the checkout holding the BASE branch's config, --repo
// pointing at the checkout.
async function guard(root, flags) {
  const { run: job } = await import("../src/jobs/content-guard.mjs");
  const { loadConfig } = await import("../src/core/config.mjs");
  const out = mkdtempSync(join(tmpdir(), "seo-guard-run-"));
  writeFileSync(join(out, "seo-autopilot.config.json"), git(root, "show", `${flags.base || "main"}:seo-autopilot.config.json`));
  const cfg = loadConfig({ cwd: out });
  const log = console.log; console.log = () => {}; process.exitCode = 0;
  try { await job({ site: cfg.sites[0], cfg, flags: { repo: root, ...flags } }); return { code: process.exitCode, report: JSON.parse(readFileSync(join(out, ".seo-autopilot", "ex", "content-guard.json"), "utf8")) }; }
  finally { console.log = log; process.exitCode = 0; }
}

const later = (iso, sec) => new Date(Date.parse(iso) + sec * 1000).toISOString();
const headTime = (root) => git(root, "log", "-1", "--format=%cI", "HEAD");
const write = (root, path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); };

test("job: fails the shrink; every guard input (limit, site address, skipped folders) comes from the BASE config", async () => {
  const root = repo();
  write(root, "content/blog/guide.md", md("How to choose a running shoe", article(EN, 2000)));
  git(root, "add", "-A"); git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "seo/issue-7");
  write(root, "content/blog/guide.md", md("How to choose a running shoe", article(EN, 300)));
  // The pull request also tries to loosen its own check: limit 100, its content folder declared as the data folder (which
  // is skipped), and another site address (so its internal links would look external). All ignored: the base decides.
  const cfg = JSON.parse(readFileSync(join(root, "seo-autopilot.config.json"), "utf8"));
  cfg.dataDir = "content"; cfg.stateDir = "content/blog"; cfg.sites[0].contentGuard = { maxWordDropPercent: 100 }; cfg.sites[0].url = "https://elsewhere.test/";
  writeFileSync(join(root, "seo-autopilot.config.json"), JSON.stringify(cfg));
  git(root, "commit", "-qam", "shrink");
  const r = await guard(root, { base: "main", branch: "seo/issue-7" });
  assert.equal(r.code, 1, "exit 1 blocks the check");
  assert.equal(r.report.checked, 1); assert.equal(r.report.failed, 1);
  assert.equal(r.report.settings.maxWordDropPercent, 15); assert.equal(r.report.settings.siteUrl, SITE);
  assert.ok(!r.report.settings.skipDirs.includes("content"), "the pull request's dataDir is not used");
  assert.equal(r.report.pages[0].file, "content/blog/guide.md"); assert.equal(r.report.pages[0].status, "fail");
});

test("job: an Arabic (non-ASCII) file name is checked like any other (git quotes such names unless told not to)", async () => {
  const root = repo();
  const path = "content/blog/دليل-العناية-بالنباتات.md";
  write(root, path, md("دليل العناية بالنباتات المنزلية", article(AR, 300, { h2: "قسم" })));
  git(root, "add", "-A"); git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "seo/issue-8");
  write(root, path, md("دليل العناية بالنباتات المنزلية", "كلمتان فقط"));
  git(root, "commit", "-qam", "shrink");
  const r = await guard(root, { base: "main", branch: "seo/issue-8" });
  assert.equal(r.report.checked, 1, "the page was found"); assert.equal(r.code, 1);
  assert.equal(r.report.pages[0].file, path);
});

test("job: the override needs a person who is not the author, added AFTER the latest commit", async () => {
  const root = repo();
  write(root, "content/blog/guide.md", md("Guide", article(EN, 600)));
  git(root, "add", "-A"); git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "seo/issue-11");
  write(root, "content/blog/guide.md", md("Guide", article(EN, 200)));
  git(root, "commit", "-qam", "prune");
  const t = headTime(root);
  const events = (actor, at) => { const f = join(root, `ev-${actor}-${Date.parse(at)}.jsonl`); writeFileSync(f, JSON.stringify({ event: "labeled", label: "allow-content-shrink", actor, type: "User", created_at: at }) + "\n"); return f; };
  const flags = (actor, at, author = "seo-bot") => ({ base: "main", branch: "seo/issue-11", labels: "allow-content-shrink", events: events(actor, at), author });
  assert.equal((await guard(root, flags("editor", later(t, 60)))).code, 0, "a person, after the last push");
  assert.equal((await guard(root, flags("editor", later(t, 60), "editor"))).code, 1, "the author cannot override");
  const stale = await guard(root, flags("editor", later(t, -60)));
  assert.equal(stale.code, 1, "a label added before the latest push does not carry over"); assert.match(stale.report.override.reason, /before the latest commit/);
  const f = join(root, "ev-nodate.jsonl"); writeFileSync(f, JSON.stringify({ event: "labeled", label: "allow-content-shrink", actor: "editor", type: "User" }) + "\n");
  assert.equal((await guard(root, { base: "main", branch: "seo/issue-11", labels: "allow-content-shrink", events: f, author: "seo-bot" })).code, 1, "no time on the event: fail closed");
});

// A merged seo/* pull request (a real merge commit, GitHub's default), then revert branches for it.
function mergedRefresh() {
  const root = repo();
  write(root, "content/blog/guide.md", md("How to choose a running shoe", article(EN, 1200)));
  write(root, "content/blog/other.md", md("Trail shoes", article(EN, 800)));
  git(root, "add", "-A"); git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "seo/issue-9");
  write(root, "content/blog/guide.md", md("How to choose a running shoe", article(EN, 1200) + "\n\n## Extra section\n\nMore detail with [a link](/guides/extra).\n"));
  git(root, "commit", "-qam", "refresh the guide");
  git(root, "checkout", "-q", "main"); git(root, "merge", "-q", "--no-ff", "-m", "Merge pull request #9 from example/seo/issue-9", "seo/issue-9");
  const merged = git(root, "rev-parse", "HEAD");
  const pr = (extra = {}) => { const info = join(root, "..", `revert-of-${Math.random().toString(36).slice(2)}.json`); writeFileSync(info, JSON.stringify({ number: 9, merged: true, mergeCommit: merged, headRefName: "seo/issue-9", commits: ["refresh the guide"], ...extra })); return info; };
  return { root, merged, pr };
}
const BOT = "github-actions[bot]";
const botFlags = (root, extra = {}) => { const f = join(root, `ev-bot-${Math.random().toString(36).slice(2)}.jsonl`); writeFileSync(f, JSON.stringify({ event: "labeled", label: "seo-revert", actor: BOT, type: "Bot", created_at: new Date().toISOString() }) + "\n"); return { base: "main", author: BOT, labels: "seo-revert", events: f, ...extra }; };

test("job: a seo-watch undo passes only when it is the exact inverse of a merged seo/* pull request, opened and labelled by the bot", async () => {
  const { root, merged, pr } = mergedRefresh();
  git(root, "checkout", "-qb", "seo/revert-9"); git(root, "revert", "--no-edit", "-m", "1", merged);
  const ok = await guard(root, botFlags(root, { branch: "seo/revert-9", "revert-of": pr() }));
  assert.equal(ok.code, 0); assert.equal(ok.report.revert.trusted, true); assert.equal(ok.report.pages[0].status, "restore");
  // Spoofs: each fails.
  const spoofs = [
    [{ branch: "seo/revert-9" }, { author: "", labels: "", events: "" }, /could not be found/],
    [{ branch: "seo/revert-9", "revert-of": pr() }, { author: "drafting-agent" }, /not by the seo-watch job/],
    [{ branch: "seo/revert-9" }, {}, /#9 \(the one being reverted\) could not be read/],
    [{ branch: "seo/revert-9", "revert-of": pr({ headRefName: "feature/x" }) }, {}, /not from a seo\/\* branch/],
    [{ branch: "seo/revert-9", "revert-of": pr({ merged: false }) }, {}, /never merged/],
    [{ branch: "seo/revert-9", "revert-of": pr({ number: 8 }) }, {}, /could not be read/],
  ];
  for (const [flags, over, why] of spoofs) {
    const r = await guard(root, { ...botFlags(root, flags), ...over });
    assert.equal(r.code, 1, JSON.stringify(over) + JSON.stringify(flags)); assert.equal(r.report.revert.trusted, false); assert.match(r.report.revert.reason, why);
  }
  // The drafter (same bot account) names a branch seo/revert-9 and also cuts another page: not the exact inverse.
  git(root, "checkout", "-q", "main"); git(root, "checkout", "-qb", "seo/revert-9b");
  git(root, "revert", "--no-edit", "-m", "1", merged);
  write(root, "content/blog/other.md", md("Trail shoes", article(EN, 100))); git(root, "commit", "-qam", "and cut another page");
  const fake = await guard(root, botFlags(root, { branch: "seo/revert-9", "revert-of": pr() }));
  assert.equal(fake.code, 1); assert.equal(fake.report.revert.trusted, false);
  // The same undo on a normal seo/* branch fails (the added section and link are lost).
  git(root, "checkout", "-q", "main"); git(root, "checkout", "-qb", "seo/issue-10"); git(root, "revert", "--no-edit", "-m", "1", merged);
  assert.equal((await guard(root, { base: "main", branch: "seo/issue-10" })).code, 1);
});

test("job: a seo-watch unpublish passes only when it is exactly the adapter's draft + hold on the page the pull request added", async () => {
  const root = repo();
  write(root, "content/blog/old.md", md("Old", article(EN, 400)));
  git(root, "add", "-A"); git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "seo/topic-12");
  write(root, "content/blog/new.md", md("New page", article(EN, 400))); git(root, "add", "-A"); git(root, "commit", "-qm", "new page");
  git(root, "checkout", "-q", "main"); git(root, "merge", "-q", "--squash", "seo/topic-12"); git(root, "commit", "-qm", "New page (#12)");
  const sha = git(root, "rev-parse", "HEAD");
  const info = join(root, "..", `rv12-${Date.now()}.json`); writeFileSync(info, JSON.stringify({ number: 12, merged: true, mergeCommit: sha, headRefName: "seo/topic-12", commits: ["new page"] }));
  git(root, "checkout", "-qb", "seo/revert-12");
  const { unpublishText } = await import("../src/adapters/index.mjs");
  const now = readFileSync(join(root, "content/blog/new.md"), "utf8");
  write(root, "content/blog/new.md", unpublishText("content/blog/new.md", now, ["content/blog/new.md"], { field: "draft", value: true }).out);
  git(root, "commit", "-qam", "Unpublish the new page from #12 (seo-watch)");
  const ok = await guard(root, botFlags(root, { branch: "seo/revert-12", "revert-of": info }));
  assert.equal(ok.code, 0, JSON.stringify(ok.report.revert)); assert.equal(ok.report.pages[0].status, "restore");
  // Without the bot's provenance the same draft: true is a page-setting change and fails.
  assert.equal((await guard(root, { base: "main", branch: "seo/revert-12" })).code, 1);
  // With anything else changed in the file, it is not the adapter's unpublish.
  write(root, "content/blog/new.md", readFileSync(join(root, "content/blog/new.md"), "utf8").replace("# New page", "# New page\n\nAnd a sneaky extra line."));
  git(root, "commit", "-qam", "extra");
  assert.equal((await guard(root, botFlags(root, { branch: "seo/revert-12", "revert-of": info }))).code, 1);
});
