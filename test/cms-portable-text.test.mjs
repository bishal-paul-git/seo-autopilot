import { test } from "node:test";
import assert from "node:assert/strict";
import { toMarkdown, fromMarkdown, roundTrip, normalizeBlocks, blockFacts, countWords } from "../src/cms/portable-text.mjs";

const span = (text, marks = []) => ({ _type: "span", _key: "s" + Math.random().toString(36).slice(2, 7), text, marks });
const block = (children, extra = {}) => ({ _type: "block", _key: "b" + Math.random().toString(36).slice(2, 7), style: "normal", markDefs: [], children, ...extra });

test("plain blocks become readable Markdown and come back unchanged", () => {
  const blocks = [
    block([span("Intro paragraph.")]),
    block([span("A heading")], { style: "h2" }),
    block([span("Smaller heading")], { style: "h3" }),
    block([span("first")], { listItem: "bullet", level: 1 }),
    block([span("nested")], { listItem: "bullet", level: 2 }),
    block([span("step one")], { listItem: "number", level: 1 }),
    block([span("A quote")], { style: "blockquote" }),
    { _type: "code", _key: "c1", language: "js", code: "const a = 1;\n```inner```" },
    { _type: "image", _key: "i1", alt: "A [chart]", asset: { url: "https://cdn.example.com/a.png" } },
  ];
  const r = roundTrip(blocks);
  assert.equal(r.ok, true, JSON.stringify(r.differences));
  assert.equal(r.opaque, 0);
  assert.match(r.markdown, /^Intro paragraph\.\n\n## A heading\n\n### Smaller heading\n\n- first\n  - nested\n1\. step one\n\n> A quote\n\n````js\n/);
  assert.match(r.markdown, /!\[A \\\[chart\\\]\]\(https:\/\/cdn\.example\.com\/a\.png\)/);
});

test("marks, overlapping marks and links survive", () => {
  const b = block([
    span("plain "), span("bold", ["strong"]), span(" and ", []), span("bold italic", ["strong", "em"]),
    span(" link ", ["l1"]), span("strong link", ["l1", "strong"]), span(" ", []), span("x_y*z", ["code"]),
    span(" ", []), span("gone", ["strike-through"]),
  ], { markDefs: [{ _key: "l1", _type: "link", href: "https://example.com/a_(b)" }] });
  const r = roundTrip([b]);
  assert.equal(r.ok, true, r.markdown);
  assert.equal(r.opaque, 0, r.markdown);
  assert.equal(r.markdown, "plain **bold** and _**bold italic**_[ link **strong link**](https://example.com/a_\\(b\\)) `x_y*z` ~~gone~~\n");
});

test("literal Markdown characters in text are escaped and restored", () => {
  const blocks = [
    block([span("snake_case and 2*3 and [x] and ~tilde~ and back\\slash")]),
    block([span("# not a heading")]),
    block([span("- not a list")]),
    block([span("1. not a list")]),
    block([span("> not a quote")]),
  ];
  const r = roundTrip(blocks);
  assert.equal(r.ok, true, r.markdown);
  assert.equal(r.opaque, 0, r.markdown);
});

test("a line break inside one block stays one block (the EmDash converter split these)", () => {
  const blocks = [block([span("line one\nline two\n# line three")]), block([span("item a\nmore of a")], { listItem: "bullet", level: 1 })];
  const r = roundTrip(blocks);
  assert.equal(r.ok, true, r.markdown);
  assert.equal(r.opaque, 0);
  assert.equal(fromMarkdown(r.markdown).length, 2);
  assert.match(r.markdown, /^line one\\\nline two\\\n\\# line three\n\n- item a\\\n  more of a\n$/);
});

test("Arabic text round-trips and counts words", () => {
  const blocks = [
    block([span("ما الذي تغيّر فعليًا للتاجر؟")], { style: "h2" }),
    block([span("العميل اليوم قد لا يزور 10 صفحات قبل الشراء. "), span("رابط", ["a"])], { markDefs: [{ _key: "a", _type: "link", href: "/posts/مثال" }] }),
  ];
  const r = roundTrip(blocks);
  assert.equal(r.ok, true, r.markdown);
  const f = blockFacts(blocks);
  assert.equal(f.words, 5 + 9 + 1);
  assert.deepEqual(f.headings, [{ level: 2, text: "ما الذي تغيّر فعليًا للتاجر؟" }]);
  assert.deepEqual(f.links, ["/posts/مثال"]);
  assert.equal(countWords("كلمة واحدة، وأخرى"), 3);
});

test("anything Markdown cannot hold exactly goes into an opaque fence and comes back unchanged", () => {
  const blocks = [
    { _type: "table", _key: "t1", rows: [{ cells: ["a", "b --> c"] }] },
    block([span("")]),
    block([span("underlined", ["underline"])]),
    block([span("custom", ["c1"])], { markDefs: [{ _key: "c1", _type: "internalLink", reference: { _ref: "x" } }] }),
    { _type: "image", _key: "i2", alt: "photo", asset: { _ref: "media-123", url: "https://x/y.jpg" }, caption: "c" },
    block([span("  leading spaces heading")], { style: "h2" }),
  ];
  const r = roundTrip(blocks);
  assert.equal(r.ok, true, r.markdown);
  assert.equal(r.opaque, 6);
  assert.equal(r.problems.length, 6);
  assert.ok(!r.markdown.includes("b --> c"), "a --> inside JSON must not close the comment");
});

test("normalisation ignores keys, mark order and split spans", () => {
  const a = [block([span("ab", ["strong", "em"])])];
  const b = [block([span("a", ["em", "strong"]), span("b", ["strong", "em"])])];
  assert.deepEqual(normalizeBlocks(a), normalizeBlocks(b));
});

test("hand-edited Markdown with an unclosed marker keeps the text", () => {
  const [b] = fromMarkdown("price is 5 * 3 and a_b");
  assert.equal(b.children.map((s) => s.text).join(""), "price is 5 * 3 and a_b");
  assert.ok(b.children.every((s) => s.marks.length === 0));
});

test("Markdown from the editor converts to the expected blocks", () => {
  const md = "## عنوان\n\nنص مع [رابط](https://example.com/x) و **غامق**.\n\n- أ\n- ب\n";
  const blocks = fromMarkdown(md);
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].style, "h2");
  assert.equal(blocks[1].markDefs[0].href, "https://example.com/x");
  assert.deepEqual(blocks[1].children.map((s) => s.text), ["نص مع ", "رابط", " و ", "غامق", "."]);
  assert.equal(blocks[2].listItem, "bullet");
  assert.equal(toMarkdown(blocks).markdown, md);
});
