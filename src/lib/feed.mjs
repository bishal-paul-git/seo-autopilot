// Dependency-free RSS 2.0 / Atom parser. Good enough for headlines; treats all text as untrusted data.
const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/\s+/g, " ").trim();
const tag = (block, name) => {
  const open = new RegExp("<" + name + "(?:\\s[^>]*)?>", "i");
  const start = block.search(open);
  if (start < 0) return "";
  const from = start + block.slice(start).match(open)[0].length;
  const end = block.toLowerCase().indexOf("</" + name.toLowerCase() + ">", from);
  return end < 0 ? "" : block.slice(from, end);
};

export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = decode(tag(b, "title"));
    let link = decode(tag(b, "link"));
    if (!link) { const m = b.match(/<link[^>]*href=["']([^"']+)["']/i); link = m ? m[1] : ""; }
    const date = decode(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const summary = decode(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 400);
    const t = Date.parse(date);
    if (title && /^https?:\/\//.test(link)) items.push({ title, link, summary, date: Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10) });
  }
  return items;
}

// Weighted keyword relevance: each configured keyword found in title (x2) or summary (x1) adds its weight.
export function score(item, keywords) {
  const title = item.title.toLowerCase(), sum = (item.summary || "").toLowerCase();
  const has = (text, kw) => new RegExp("(^|[^a-z0-9])" + kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)").test(text);
  let s = 0; const hits = [];
  for (const [kw, w] of Object.entries(keywords)) {
    if (has(title, kw)) { s += 2 * w; hits.push(kw); } else if (has(sum, kw)) { s += w; hits.push(kw); }
  }
  return { score: s, hits };
}
