// Turns the HTML a server sends into the facts an SEO audit needs. Dependency-free, regex based, and deliberately
// conservative: it reads what a crawler sees before running any JavaScript.

const decodeEntities = (s) => String(s || "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const stripTags = (s) => decodeEntities(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  const body = tag.replace(/^<\w+/, "").replace(/\/?>$/, "");
  while ((m = re.exec(body))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

/** Remove scripts, styles and other non-visible blocks, then return the visible text. */
export function visibleText(html) {
  return stripTags(String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|head)[\s\S]*?<\/\1>/gi, " "));
}

const normalizeUrl = (href, base) => {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    return u.toString();
  } catch { return null; }
};

export function extractPage(html, pageUrl) {
  html = String(html || "");
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [html.slice(0, 20000)])[0];
  const title = stripTags((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");

  const metas = {}, props = {};
  for (const t of head.match(/<meta\b[^>]*>/gi) || []) {
    const a = attrs(t);
    if (a.name) metas[a.name.toLowerCase()] = a.content ?? "";
    if (a.property) props[a.property.toLowerCase()] = a.content ?? "";
  }
  let canonical = null; const alternates = [];
  for (const t of head.match(/<link\b[^>]*>/gi) || []) {
    const a = attrs(t);
    const rel = (a.rel || "").toLowerCase();
    if (rel.split(/\s+/).includes("canonical") && a.href) canonical = normalizeUrl(a.href, pageUrl);
    if (rel === "alternate" && a.hreflang && a.href) alternates.push({ hreflang: a.hreflang, href: normalizeUrl(a.href, pageUrl) });
  }

  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1])).filter(Boolean);
  const h2s = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => stripTags(m[1])).filter(Boolean);

  const jsonld = { types: [], invalid: 0, blocks: 0, articleFields: null };
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    jsonld.blocks++;
    try {
      const data = JSON.parse(m[1]);
      const nodes = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const n of nodes) {
        const types = [].concat(n?.["@type"] || []);
        jsonld.types.push(...types);
        if (types.some((t) => /Article|BlogPosting|NewsArticle/.test(t))) jsonld.articleFields = { headline: !!n.headline, datePublished: !!n.datePublished, author: !!n.author, image: !!n.image };
      }
    } catch { jsonld.invalid++; }
  }

  const links = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = attrs("<a " + m[1] + ">");
    if (!a.href || /^(mailto:|tel:|javascript:|#)/i.test(a.href)) continue;
    const url = normalizeUrl(a.href, pageUrl);
    if (url) links.push({ url, text: stripTags(m[2]).slice(0, 120), nofollow: /nofollow/i.test(a.rel || "") });
  }

  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const imagesNoAlt = imgs.filter((t) => !/\balt\s*=/i.test(t)).length;
  const https = /^https:/i.test(pageUrl);
  const mixed = https ? [...html.matchAll(/<(?:script|link|img|iframe|source)\b[^>]*?(?:src|href)=["'](http:\/\/[^"']+)["']/gi)].map((m) => m[1]).filter((u) => !/rel=["']?(?:alternate|canonical)/i.test(u)).slice(0, 5) : [];

  const text = visibleText(html);
  const words = text ? text.split(/\s+/).length : 0;
  return {
    title, description: metas.description ?? null, robots: (metas.robots || "").toLowerCase(), viewport: metas.viewport ?? null,
    canonical, alternates, h1s, h2s, lang: (html.match(/<html\b[^>]*\blang=["']?([A-Za-z-]+)/i) || [])[1] || null,
    og: { title: props["og:title"] ?? null, image: props["og:image"] ?? null },
    jsonld, links, images: imgs.length, imagesNoAlt, mixed, words, text,
  };
}

export { normalizeUrl, stripTags };
