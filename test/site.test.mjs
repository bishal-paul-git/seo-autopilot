import test from "node:test";
import assert from "node:assert/strict";
import { markdown, inline, frontMatter } from "../scripts/md.mjs";

test("markdown escapes HTML and blocks script links", () => {
  const h = markdown("# T <script>alert(1)</script>\n\n[x](javascript:alert(1)) and [ok](https://a.com)");
  assert.ok(!h.includes("<script>"));
  assert.ok(!/href="javascript/i.test(h));
  assert.ok(h.includes('<a href="https://a.com"'));
});

test("headings, lists, tables, code and bold render", () => {
  const h = markdown("## Head\n\n- one\n- **two**\n\n1. a\n2. b\n\n| A | B |\n|---|---|\n| 1 | `x` |\n\n```\nraw <b>\n```");
  assert.ok(h.includes("<h2>Head</h2>"));
  assert.ok(h.includes("<ul><li>one</li><li><strong>two</strong></li></ul>"));
  assert.ok(h.includes("<ol><li>a</li><li>b</li></ol>"));
  assert.ok(h.includes("<th>A</th>") && h.includes("<td><code>x</code></td>"));
  assert.ok(h.includes("raw &lt;b&gt;"));
});

test("front matter is split and links can be rewritten", () => {
  const { meta, body } = frontMatter("---\nname: a\ntools: Read, Grep\n---\n# Body");
  assert.equal(meta.name, "a"); assert.equal(meta.tools, "Read, Grep"); assert.equal(body.trim(), "# Body");
  assert.equal(inline("[p](x.md)", (h) => "#" + h.replace(/\.md$/, "")), '<a href="#x">p</a>');
});
