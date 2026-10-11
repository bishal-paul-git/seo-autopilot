import test from "node:test";
import assert from "node:assert/strict";
import { parseFeed, score } from "../src/lib/feed.mjs";

test("parses RSS items, decodes entities and CDATA", () => {
  const rss = `<rss><channel><item><title>ICO &amp; AI: new <![CDATA[guidance]]></title><link>https://ico.org.uk/x</link>
    <pubDate>Fri, 09 Oct 2026 10:00:00 GMT</pubDate><description>about voice ai and call recording</description></item></channel></rss>`;
  const [it] = parseFeed(rss);
  assert.equal(it.title, "ICO & AI: new guidance");
  assert.equal(it.link, "https://ico.org.uk/x");
  assert.equal(it.date, "2026-10-09");
});

test("parses Atom entries with href links", () => {
  const atom = `<feed><entry><title>Core update</title><link href="https://a.com/p"/><updated>2026-10-01T00:00:00Z</updated><summary>core update rolling</summary></entry></feed>`;
  const [it] = parseFeed(atom);
  assert.equal(it.link, "https://a.com/p");
  assert.equal(it.date, "2026-10-01");
});

test("drops items without a valid http(s) link", () => {
  assert.equal(parseFeed(`<rss><item><title>x</title><link>javascript:alert(1)</link></item></rss>`).length, 0);
});

test("scores title hits double and ignores unrelated items", () => {
  const kw = { "voice ai": 3, "call recording": 3 };
  assert.equal(score({ title: "Voice AI rules", summary: "" }, kw).score, 6);
  assert.equal(score({ title: "Other", summary: "call recording" }, kw).score, 3);
  assert.equal(score({ title: "Cats", summary: "dogs" }, kw).score, 0);
});
