// Content-loss guard: a refresh must not quietly throw away what a page already had. For every page a pull request
// changes, compare the version before (base) with the version after (head) and fail when the page lost more than a set
// share of its words, or lost a heading, an internal link, an image or a piece of structured data.
// Pure: pass the file contents, get a verdict and a table back. The job (src/jobs/content-guard.mjs) reads git.
//
// Formats: Markdown and MDX with front matter, HTML, and JSON files that hold an array of page objects (the json
// adapter). Words are counted Unicode-aware, so Arabic, accented Latin and other scripts count like English; Chinese and
// Japanese characters count one each (those scripts do not separate words with spaces).
// Headings: a heading whose text is gone while a SIMILAR heading of the same level appeared (character overlap of at least
// half) is reported as reworded (a warning): rewriting a heading is normal editing. Any other heading that is gone fails,
// even when an unrelated heading was added in its place.
// Hidden text does not count: HTML/MDX/Liquid/Hugo/Nunjucks comments and elements hidden with the hidden attribute,
// display:none, visibility:hidden or a hiding class are removed before anything is counted, so wrapping the old text in
// a comment or a hidden block is a loss like deleting it.
// Page settings: a change to a front-matter (or JSON page) key that takes a page off the site or moves it (draft,
// published, noindex, robots, canonical, permalink, slug, redirect, expiry...) fails, whatever happened to the words.

export const GUARD_DEFAULTS = { maxWordDropPercent: 15 };
export const OVERRIDE_LABEL = "allow-content-shrink";

// ---------------------------------------------------------------------------------------------------------------- words

const CJK = /([\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}])/gu;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}‌‍'’_-]*/gu;

/** Words in plain text, in any script: letters and digits with their combining marks (Arabic vowel signs stay in the word). */
export function countWords(text) {
  return (String(text || "").replace(CJK, " $1 ").match(WORD) || []).length;
}

// ------------------------------------------------------------------------------------------------------------- helpers

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|tiff?)(\?[^\s"'()<>]*)?$/i;
const IMG_IN_TEXT = /[^\s"'()<>\[\]{}]+\.(?:png|jpe?g|gif|webp|avif|svg|bmp|tiff?)(?:\?[^\s"'()<>]*)?/gi;
const norm = (s) => String(s || "").normalize("NFC").replace(/\s+/g, " ").trim();
const headingKey = (s) => norm(String(s).replace(/\{#[^}]*\}\s*$/, "").replace(/[*_`~]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, " ")).toLowerCase();
const decode = (s) => String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");

function hostOf(u) { try { return new URL(u).host.replace(/^www\./i, "").toLowerCase(); } catch { return ""; } }

/** An internal link as a comparable path ("/guides/a"), or null for external, anchors, mail and phone links. */
export function internalLink(href, siteUrl = "") {
  let h = decode(String(href || "").trim()).replace(/^<|>$/g, "");
  if (!h || /^(#|mailto:|tel:|javascript:|data:|sms:|ftp:)/i.test(h)) return null;
  if (/^\/\//.test(h)) h = "https:" + h;
  let path;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) {
    const host = hostOf(h);
    if (!siteUrl || !host || host !== hostOf(siteUrl)) return null;
    const u = new URL(h); path = u.pathname + u.search;
  } else if (/^[{$]/.test(h)) return null; // a template expression, not a URL
  else path = h;
  path = path.split("#")[0];
  if (!path) return null;
  if (path.length > 1) path = path.replace(/\/+$/, "") || "/";
  return path;
}

const imageKey = (src) => decode(String(src || "").trim()).replace(/^<|>$/g, "").split("#")[0];

function schemaTypes(value, out) {
  if (Array.isArray(value)) { for (const v of value) schemaTypes(v, out); return out; }
  if (!value || typeof value !== "object") return out;
  for (const t of [].concat(value["@type"] || [])) if (typeof t === "string") out.push(t);
  for (const [k, v] of Object.entries(value)) if (k !== "@type") schemaTypes(v, out);
  return out;
}

const uniq = (a) => [...new Set(a)];

// ------------------------------------------------------------------------------------------------------ hidden text

const HIDING_CLASS = /(?:^|\s)(hidden|d-none|sr-only|visually-hidden|invisible|is-hidden|screen-reader-text)(?=\s|$)/i;
const SHOWING_CLASS = /(?:^|\s)[\w-]+:(block|flex|grid|inline|inline-block|inline-flex|table|contents|visible)(?=\s|$)/i;
function isHidden(attrs) {
  if (/(?:^|\s)hidden(?![\w-])(?!\s*=\s*\{?\s*["']?false)/i.test(attrs)) return true;
  if (/display\s*:\s*["']?none|visibility\s*:\s*["']?hidden/i.test(attrs)) return true;
  const cls = attrs.match(/\bclass(?:Name)?\s*=\s*\{?\s*["'`]([^"'`]*)["'`]/i);
  return Boolean(cls && HIDING_CLASS.test(cls[1]) && !SHOWING_CLASS.test(cls[1]));
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Remove comments and hidden elements (balanced on the same tag name; an unclosed one hides everything after it). */
export function stripInvisible(src) {
  let s = String(src || "")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")                       // MDX {/* */}
    .replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g, " ")               // Hugo {{/* */}}
    .replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?(?:\{%-?\s*endcomment\s*-?%\}|$)/g, " ") // Liquid / Jekyll
    .replace(/\{#[\s\S]*?#\}/g, " ");                                     // Nunjucks / Jinja
  const open = /<([A-Za-z][\w.:-]*)((?:\s[^>]*)?)>/g;
  let out = "", i = 0, m;
  while ((m = open.exec(s))) {
    const [tag, name, attrs] = m;
    if (/\/\s*$/.test(attrs) || !isHidden(attrs)) continue;
    const re = new RegExp(`<(/?)${escapeRe(name)}(?![\\w.:-])[^>]*?(/?)>`, "gi");
    re.lastIndex = m.index + tag.length;
    let depth = 1, end = s.length, x;
    while ((x = re.exec(s))) { if (x[1]) { if (--depth === 0) { end = x.index + x[0].length; break; } } else if (!x[2]) depth++; }
    out += s.slice(i, m.index) + " ";
    i = end; open.lastIndex = end;
  }
  return out + s.slice(i);
}

// --------------------------------------------------------------------------------------------------- page settings

// Keys that take a page off the site, hide it from search or move it. The scheduler's own fields (queued, hold,
// publishAt) are not here: dating a page is its job.
const CONTROL_KEYS = /^(draft|published|status|noindex|nofollow|robots|index|sitemap|canonical|canonical_?url|permalink|slug|url|path|redirect|redirect_?to|expiry_?date|publish_?date|unlisted|hidden|private|headless|_?build|visibility)$/i;

/** Page settings from YAML ("key: value", with indented lines under it) or TOML ("key = value") front matter. */
function frontControls(front) {
  const out = {}, lines = String(front || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*)\s*[:=]\s*(.*)$/);
    if (!m || !CONTROL_KEYS.test(m[1])) continue;
    let v = m[2].trim();
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) v += " " + lines[++i].trim();
    out[m[1].toLowerCase()] = v.replace(/^["']|["']$/g, "").trim();
  }
  return out;
}
function htmlControls(src) {
  const out = {};
  for (const t of String(src || "").match(/<meta\b[^>]*>/gi) || []) if (/\bname\s*=\s*["']?(robots|googlebot)\b/i.test(t)) out.robots = ((t.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1] || "").toLowerCase();
  for (const t of String(src || "").match(/<link\b[^>]*>/gi) || []) if (/\brel\s*=\s*["']?canonical\b/i.test(t)) out.canonical = (t.match(/\bhref\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
  return out;
}

// ------------------------------------------------------------------------------------------------- markdown and HTML

/** Split "---\nfront matter\n---\nbody" (YAML or TOML "+++"). */
export function splitFrontMatter(src) {
  const s = String(src || "").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = s.match(/^(---|\+\+\+)\n([\s\S]*?)\n\1[ \t]*(?:\n|$)/);
  return m ? { front: m[2], body: s.slice(m[0].length) } : { front: "", body: s };
}

const fmValue = (front, key) => { const m = front.match(new RegExp(`^${key}:\\s*(.+)$`, "mi")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""; };

/**
 * What a page holds, from Markdown/MDX (with front matter) or HTML. format: "markdown" | "html".
 * Returns { words, headings: [{ level, text }], links: [paths], images: [srcs], schema: { blocks, types }, title }.
 */
export function textFacts(src, { format = "markdown", siteUrl = "" } = {}) {
  let { front, body } = format === "markdown" ? splitFrontMatter(src) : { front: "", body: String(src || "") };
  const controls = { ...htmlControls(format === "html" ? src : ""), ...frontControls(front) };
  const schema = { blocks: 0, types: [] };
  // Structured data: <script type="application/ld+json"> blocks (HTML, MDX) and schema objects in the front matter.
  body = body.replace(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, (_, json) => {
    schema.blocks++;
    try { schemaTypes(JSON.parse(decode(json)), schema.types); } catch { for (const m of json.matchAll(/"@type"\s*:\s*"([^"]+)"/g)) schema.types.push(m[1]); }
    return " ";
  });
  if (/^(schema|jsonLd|jsonld|structuredData|structured_data)\s*:/m.test(front)) schema.blocks++;
  for (const m of front.matchAll(/["']?@type["']?\s*:\s*["']?([A-Za-z][\w]*)/g)) schema.types.push(m[1]);
  if (format === "html") body = body.replace(/<head\b[\s\S]*?<\/head>/i, " ");
  body = stripInvisible(body).replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ");

  // Images: Markdown ![alt](src), any src= attribute on an image tag or component, and image paths in the front matter.
  const images = [];
  for (const m of body.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) images.push(imageKey(m[1]));
  for (const m of body.matchAll(/<(?:img|Image|picture|source|amp-img)\b[^>]*?\b(?:src|srcSet|srcset)\s*=\s*\{?\s*["']([^"']+)["']/gi)) images.push(imageKey(m[1].split(/\s+/)[0]));
  for (const m of front.matchAll(IMG_IN_TEXT)) images.push(imageKey(m[0]));

  // Links: Markdown [text](url), reference definitions, <autolinks>, and href= on <a> or link components.
  const rawLinks = [];
  const code = []; // fenced code is kept for words, not for headings or links
  const prose = body.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (m) => { code.push(m); return "\n"; }).replace(/`[^`\n]+`/g, (m) => { code.push(m); return " "; });
  for (const m of prose.matchAll(/(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) rawLinks.push(m[1]);
  for (const m of prose.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) rawLinks.push(m[1]);
  for (const m of prose.matchAll(/<(https?:\/\/[^>\s]+)>/g)) rawLinks.push(m[1]);
  for (const m of prose.matchAll(/<(?:a|Link|NextLink|RouterLink)\b[^>]*?\b(?:href|to)\s*=\s*\{?\s*["']([^"']+)["']/gi)) rawLinks.push(m[1]);
  const links = uniq(rawLinks.map((h) => internalLink(h, siteUrl)).filter(Boolean));

  // Headings: ATX (# Title), setext (Title\n====), and <h1>..<h6>.
  const headings = [];
  const lines = prose.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const atx = lines[i].match(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (atx) { headings.push({ level: atx[1].length, text: norm(atx[2]) }); continue; }
    const next = lines[i + 1] || "";
    const prevBlank = i === 0 || !lines[i - 1].trim();
    if (format === "markdown" && prevBlank && lines[i].trim() && !/^\s*([-*+>|]|\d+\.)/.test(lines[i]) && /^ {0,3}(=+|-+)[ \t]*$/.test(next)) {
      headings.push({ level: next.trim()[0] === "=" ? 1 : 2, text: norm(lines[i]) }); i++;
    }
  }
  for (const m of prose.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) headings.push({ level: Number(m[1]), text: norm(decode(m[2].replace(/<[^>]+>/g, " "))) });

  // Words: the visible prose. Link and image targets, tags, import/export lines and table rules are not words.
  const visible = body
    .replace(/^(import|export)\s[^\n]*$/gm, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/^\s{0,3}\[[^\]]+\]:\s*\S+.*$/gm, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  const title = fmValue(front, "title") || fmValue(front, "h1");
  return { words: countWords(decode(visible)), headings: headings.filter((h) => h.text), links, images: uniq(images.filter(Boolean)), schema: { blocks: schema.blocks, types: uniq(schema.types) }, title, controls };
}

// ---------------------------------------------------------------------------------------------------------------- JSON

// Keys whose values are addresses, dates or settings, not words on the page.
const NOT_WORDS = /^(slug|id|path|url|href|link|src|srcset|image|images|cover|thumbnail|thumb|ogImage|og_image|heroImage|icon|logo|img|photo|picture|publishAt|publish_at|date|datePublished|dateModified|published|updated|updatedAt|createdAt|lastmod|template|type|layout|canonical|lang|locale|status|queued|hold|draft|order|weight|color|colour|class|className|style|width|height|redirect|noindex|robots)$/i;
const SCHEMA_KEYS = /^(schema|jsonLd|jsonld|structuredData|structured_data|ld)$/i;
const IMAGE_KEYS = /^(image|images|src|cover|thumbnail|thumb|ogImage|og_image|heroImage|img|photo|picture|gallery)$/i;
const LINK_KEYS = /^(href|link|url|to|path)$/i;
const HEADING_KEYS = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6, heading: 2, subheading: 3, title: 2 };

/** What one JSON page object holds. Nested strings may be Markdown or HTML and are read the same way. */
export function objectFacts(obj, { siteUrl = "" } = {}) {
  const f = { words: 0, headings: [], links: [], images: [], schema: { blocks: 0, types: [] }, title: String(obj?.h1 ?? obj?.title ?? obj?.name ?? ""), controls: {} };
  if (obj && typeof obj === "object" && !Array.isArray(obj)) for (const [k, v] of Object.entries(obj)) if (CONTROL_KEYS.test(k) && v != null) f.controls[k.toLowerCase()] = typeof v === "string" ? v.trim() : JSON.stringify(v);
  if (obj?.h1 != null) f.headings.push({ level: 1, text: norm(obj.h1) });
  else if (obj?.title != null) f.headings.push({ level: 1, text: norm(obj.title) });
  const walk = (v, key, depth) => {
    if (v == null) return;
    if (SCHEMA_KEYS.test(key || "") && typeof v === "object") { f.schema.blocks++; f.schema.types.push(...schemaTypes(v, [])); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, key, depth + 1); return; }
    if (typeof v === "object") {
      if (v["@type"] && depth > 0) { f.schema.blocks++; f.schema.types.push(...schemaTypes(v, [])); return; }
      for (const [k, x] of Object.entries(v)) {
        if (depth === 0 && (k === "h1" || k === "title")) { if (typeof x === "string") f.words += countWords(x); continue; }
        if (depth > 0 && HEADING_KEYS[k.toLowerCase()] && typeof x === "string") { f.headings.push({ level: HEADING_KEYS[k.toLowerCase()], text: norm(x) }); f.words += countWords(x); continue; }
        if (depth === 0 && /^h[2-6]$/i.test(k) && typeof x === "string") { f.headings.push({ level: Number(k[1]), text: norm(x) }); f.words += countWords(x); continue; }
        walk(x, k, depth + 1);
      }
      return;
    }
    if (typeof v !== "string") return;
    const k = key || "";
    if (IMAGE_KEYS.test(k) || IMG_EXT.test(v.trim())) { if (v.trim()) f.images.push(imageKey(v)); return; }
    if (LINK_KEYS.test(k) && !(depth <= 1 && /^(path|url)$/i.test(k))) { const l = internalLink(v, siteUrl); if (l) f.links.push(l); return; }
    if (NOT_WORDS.test(k) || k.startsWith("@")) return;
    // Free text: may carry Markdown or HTML with its own headings, links and images.
    if (/[<\[#!{]|\n/.test(v)) {
      const t = textFacts(v, { format: "markdown", siteUrl });
      f.words += t.words; f.headings.push(...t.headings); f.links.push(...t.links); f.images.push(...t.images);
      f.schema.blocks += t.schema.blocks; f.schema.types.push(...t.schema.types);
    } else f.words += countWords(v);
  };
  walk(obj, "", 0);
  f.headings = f.headings.filter((h) => h.text);
  f.links = uniq(f.links); f.images = uniq(f.images); f.schema.types = uniq(f.schema.types);
  return f;
}

const pageId = (o) => String(o.slug ?? o.id ?? o.path ?? o.h1 ?? o.title ?? o.name ?? "");
const looksLikePage = (o) => o && typeof o === "object" && !Array.isArray(o) && ["slug", "id", "path", "h1", "title", "body", "content", "text"].some((k) => o[k] != null);

/**
 * The pages in one file, as [{ id, facts }]. JSON: every object of a top-level array (or one page object); other JSON
 * (settings, package files) returns null, meaning "not content". Markdown/MDX and HTML: one page.
 */
export function pagesInFile(path, src, { siteUrl = "" } = {}) {
  if (src == null) return [];
  const p = String(path).toLowerCase();
  if (p.endsWith(".json")) {
    let data; try { data = JSON.parse(String(src).replace(/^﻿/, "")); } catch { return { error: "not valid JSON" }; }
    const list = Array.isArray(data) ? data.filter(looksLikePage) : looksLikePage(data) ? [data] : [];
    if (!list.length) return null;
    const seen = new Map();
    return list.map((o, i) => { let id = pageId(o) || `#${i + 1}`; if (seen.has(id)) id = `${id} (${seen.set(id, seen.get(id) + 1).get(id)})`; else seen.set(id, 1); return { id, facts: objectFacts(o, { siteUrl }) }; });
  }
  if (/\.(html?|xhtml)$/.test(p)) return [{ id: path, facts: textFacts(src, { format: "html", siteUrl }) }];
  if (/\.(md|mdx|markdown|mdoc)$/.test(p)) return [{ id: path, facts: textFacts(src, { format: "markdown", siteUrl }) }];
  return null;
}

// ---------------------------------------------------------------------------------------------------------- comparison

const bigrams = (s) => { const a = [...headingKey(s).replace(/[^\p{L}\p{N}]+/gu, "")], m = new Map(); if (a.length === 1) m.set(a[0], 1); for (let i = 0; i < a.length - 1; i++) { const g = a[i] + a[i + 1]; m.set(g, (m.get(g) || 0) + 1); } return m; };
/**
 * How much of the old heading x lives on in the new heading y, 0 to 1, in any script: the larger of the Dice overlap of
 * character pairs and the share of x's character pairs found in y ("Watering" -> "How often to water" keeps most of it;
 * "Our pricing plans" -> "More" keeps nothing).
 */
export function headingSimilarity(x, y) {
  const A = bigrams(x), B = bigrams(y);
  let n = 0, ta = 0, tb = 0;
  for (const v of A.values()) ta += v;
  for (const v of B.values()) tb += v;
  for (const [g, v] of A) n += Math.min(v, B.get(g) || 0);
  return ta && tb ? Math.max((2 * n) / (ta + tb), n / ta) : 0;
}
export const REWORD_SIMILARITY = 0.5;

/** Compare two versions of one page. Returns { fail, words, removed: { headings, links, images, schema }, settings, reworded, reasons }. */
export function comparePage(before, after, o = GUARD_DEFAULTS) {
  const max = Number(o.maxWordDropPercent ?? GUARD_DEFAULTS.maxWordDropPercent);
  const reasons = [];
  // Compared unrounded: 15.04% is more than 15%.
  const raw = before.words ? ((before.words - after.words) / before.words) * 100 : 0;
  const drop = Math.round(raw * 100) / 100;
  if (raw > max) reasons.push(`words fell ${drop}% (${before.words} -> ${after.words}; the limit is ${max}%)`);
  // Headings by level: a gone heading is a rewrite only when a similar new heading of the same level appeared.
  const removedHeadings = [], reworded = [];
  for (let level = 1; level <= 6; level++) {
    const b = before.headings.filter((h) => h.level === level), a = after.headings.filter((h) => h.level === level);
    const ak = new Map(), bk = new Map();
    for (const h of a) ak.set(headingKey(h.text), (ak.get(headingKey(h.text)) || 0) + 1);
    for (const h of b) bk.set(headingKey(h.text), (bk.get(headingKey(h.text)) || 0) + 1);
    const gone = [], added = [];
    { const left = new Map(ak); for (const h of b) { const k = headingKey(h.text); if (left.get(k)) left.set(k, left.get(k) - 1); else gone.push(h); } }
    { const left = new Map(bk); for (const h of a) { const k = headingKey(h.text); if (left.get(k)) left.set(k, left.get(k) - 1); else added.push(h); } }
    const used = new Set();
    for (const h of gone) {
      let best = -1, score = 0;
      added.forEach((x, i) => { if (used.has(i)) return; const sc = headingSimilarity(h.text, x.text); if (sc > score) { score = sc; best = i; } });
      if (best >= 0 && score >= REWORD_SIMILARITY) { used.add(best); reworded.push({ level, from: h.text, to: added[best].text }); }
      else removedHeadings.push({ level, text: h.text });
    }
  }
  // Page settings that take the page off the site or move it.
  const bc = before.controls || {}, ac = after.controls || {};
  const settings = [...new Set([...Object.keys(bc), ...Object.keys(ac)])].filter((k) => (bc[k] ?? "") !== (ac[k] ?? "")).map((k) => ({ key: k, from: bc[k] ?? null, to: ac[k] ?? null }));
  const removed = {
    headings: removedHeadings,
    links: before.links.filter((l) => !after.links.includes(l)),
    images: before.images.filter((s) => !after.images.includes(s)),
    schema: [...before.schema.types.filter((t) => !after.schema.types.includes(t)), ...(after.schema.blocks < before.schema.blocks ? [`${before.schema.blocks - after.schema.blocks} structured-data block(s)`] : [])],
  };
  if (removed.headings.length) reasons.push(`heading(s) removed: ${removed.headings.map((h) => `H${h.level} "${h.text}"`).join(", ")}`);
  if (removed.links.length) reasons.push(`internal link(s) removed: ${removed.links.join(", ")}`);
  if (removed.images.length) reasons.push(`image(s) removed: ${removed.images.join(", ")}`);
  if (removed.schema.length) reasons.push(`structured data removed: ${removed.schema.join(", ")}`);
  if (settings.length) reasons.push(`page settings changed: ${settings.map((x) => `${x.key}: ${x.from ?? "(not set)"} -> ${x.to ?? "(not set)"}`).join(", ")}`);
  return { fail: reasons.length > 0, words: { before: before.words, after: after.words, dropPercent: drop }, removed, settings, reworded, reasons };
}

/** Sanity checks for a page with no earlier version. Warnings only: a new page has nothing to lose. */
export function newPageWarnings(f) {
  const w = [];
  if (!f.words) w.push("the page has no text");
  if (!f.headings.some((h) => h.level === 1) && !f.title) w.push("no H1 (and no title in the front matter that a template could use)");
  if (!f.links.length) w.push("no internal link");
  return w;
}

/**
 * Compare every changed file. files: [{ path, before, after, restores? }] where before/after are the file contents (null
 * when the file did not exist on that side). restores: true when the change exactly restores the version before the most
 * recent change to the file (an undo opened by seo-watch); such a file passes, and the string is the note shown. Returns { pages, failed, checked }.
 */
export function guardFiles(files = [], { siteUrl = "", maxWordDropPercent = GUARD_DEFAULTS.maxWordDropPercent } = {}) {
  const pages = [];
  for (const file of files) {
    const b = pagesInFile(file.path, file.before, { siteUrl }), a = pagesInFile(file.path, file.after, { siteUrl });
    if (b === null && a === null) continue; // not a content file
    if (b?.error || a?.error) { pages.push({ file: file.path, id: file.path, status: "fail", reasons: [`${file.path} is ${(a?.error || b?.error)} on one side; a broken content file cannot be compared`], before: null, after: null }); continue; }
    if (file.restores) { pages.push({ file: file.path, id: file.path, status: "restore", reasons: [String(file.restores)], before: null, after: null }); continue; }
    const bl = b || [], al = a || [];
    const byId = new Map(al.map((p) => [p.id, p]));
    for (const p of bl) {
      const q = byId.get(p.id);
      if (!q) { pages.push({ file: file.path, id: p.id, status: "fail", reasons: [file.after == null ? "the page's file was deleted" : "the page was removed from the file"], before: p.facts, after: null }); continue; }
      byId.delete(p.id);
      const c = comparePage(p.facts, q.facts, { maxWordDropPercent });
      pages.push({ file: file.path, id: p.id, status: c.fail ? "fail" : "pass", reasons: c.reasons, warnings: c.reworded.map((r) => `H${r.level} reworded: "${r.from}" -> "${r.to}"`), before: p.facts, after: q.facts, removed: c.removed, settings: c.settings, words: c.words });
    }
    for (const q of byId.values()) pages.push({ file: file.path, id: q.id, status: "new", reasons: [], warnings: newPageWarnings(q.facts), before: null, after: q.facts });
  }
  const failed = pages.filter((p) => p.status === "fail");
  return { pages, failed: failed.length, checked: pages.length };
}

// ------------------------------------------------------------------------------------------------------------- override

/**
 * Was the human-only override applied? The label must be on the pull request now, and the latest time it was added must
 * be by a person: a User account (never a Bot such as github-actions[bot]) that is not the pull request's author (so an
 * agent that opened the pull request with a personal token cannot approve its own change). Fails closed: no events, no
 * override. events: GitHub issue events [{ event, label, actor, type, created_at }] (label and actor as names). headTime: the
 * head commit's time; the label must have been added after it, so a later push cannot ride on an old label.
 */
export function overrideApplied({ labels = [], events = [], author = "", label = OVERRIDE_LABEL, headTime = "" } = {}) {
  if (!labels.includes(label)) return { applied: false, reason: `no "${label}" label` };
  const adds = events.filter((e) => e && e.event === "labeled" && (e.label?.name ?? e.label) === label);
  const last = adds[adds.length - 1];
  if (!last) return { applied: false, reason: `who added "${label}" could not be confirmed (the check could not read the pull request's events)` };
  const actor = last.actor?.login ?? last.actor ?? "", type = last.actor?.type ?? last.type ?? "";
  if (type !== "User" || /\[bot\]$/i.test(actor)) return { applied: false, reason: `"${label}" was added by ${actor || "an unknown account"} (${type || "unknown type"}), not by a person` };
  if (author && actor.toLowerCase() === String(author).toLowerCase()) return { applied: false, reason: `"${label}" was added by the pull request's own author (${actor}); another person must add it` };
  // Tied to the commit it approved: a push after the label needs the label removed and added again.
  if (headTime) {
    const at = Date.parse(last.created_at ?? last.createdAt ?? ""), head = Date.parse(headTime);
    if (!Number.isFinite(at)) return { applied: false, reason: `when "${label}" was added could not be read, so it cannot be tied to the latest commit` };
    if (!(at > head)) return { applied: false, reason: `"${label}" was added before the latest commit (${headTime}); remove it and add it again after the last push` };
  }
  return { applied: true, by: actor, reason: `"${label}" added by ${actor}` };
}

/** The account seo-watch opens its revert pull requests with (the workflow's GITHUB_TOKEN). */
export const WATCH_BOT = "github-actions[bot]";
export const REVERT_LABEL = "seo-revert";

/**
 * Is this pull request an undo opened by seo-watch? Only then may a seo/revert-* branch restore older content without
 * passing the guard: the branch name alone is not enough (anyone who can push can name a branch). It must be authored by
 * the watch's account AND carry the seo-revert label, last added by that same account (read from the pull request's
 * events). Fails closed: no pull request found, no events, another author or another labeller means not trusted.
 * Residual gap: anything else running as the same account (an agent using the workflow token) shares that identity.
 */
export function revertTrusted({ branch = "", author = "", labels = [], events = [], bot = WATCH_BOT, label = REVERT_LABEL } = {}) {
  if (!/^seo\/revert-\d+$/.test(branch)) return { trusted: false, reason: `branch ${branch || "(unknown)"} is not seo/revert-<number>` };
  if (!author) return { trusted: false, reason: "the pull request (and so its author) could not be found" };
  if (author.toLowerCase() !== bot.toLowerCase()) return { trusted: false, reason: `opened by ${author}, not by the seo-watch job (${bot})` };
  if (!labels.includes(label)) return { trusted: false, reason: `no "${label}" label` };
  const adds = events.filter((e) => e && e.event === "labeled" && (e.label?.name ?? e.label) === label);
  const last = adds[adds.length - 1];
  if (!last) return { trusted: false, reason: `who added "${label}" could not be confirmed (the check could not read the pull request's events)` };
  const actor = last.actor?.login ?? last.actor ?? "";
  if (actor.toLowerCase() !== author.toLowerCase()) return { trusted: false, reason: `"${label}" was added by ${actor || "an unknown account"}, not by the account that opened the revert (${author})` };
  return { trusted: true, reason: `opened and labelled "${label}" by ${bot}` };
}

// --------------------------------------------------------------------------------------------------------------- report

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const short = (list, n = 3) => (list.length > n ? `${list.slice(0, n).join(", ")} and ${list.length - n} more` : list.join(", "));

/** A Markdown report: one row per page, before -> after and what was removed. */
export function guardTable(result, { override = null, maxWordDropPercent = GUARD_DEFAULTS.maxWordDropPercent } = {}) {
  const head = result.failed
    ? override?.applied ? `**Content-loss guard: ${result.failed} page(s) lost content; allowed by the human override (${override.reason}).**` : `**Content-loss guard: FAILED. ${result.failed} page(s) lost content.**`
    : `**Content-loss guard: passed** (${result.checked} page(s) checked).`;
  if (!result.pages.length) return `${head}\n\nNo content pages changed.\n`;
  const rows = result.pages.map((p) => {
    const b = p.before, a = p.after;
    const n = (f, k) => (f ? (k === "schema" ? f.schema.types.length || f.schema.blocks : f[k].length) : "-");
    const removed = p.removed ? [
      p.removed.headings.length ? `headings: ${short(p.removed.headings.map((h) => `H${h.level} "${h.text}"`))}` : "",
      p.removed.links.length ? `links: ${short(p.removed.links)}` : "",
      p.removed.images.length ? `images: ${short(p.removed.images)}` : "",
      p.removed.schema.length ? `structured data: ${short(p.removed.schema)}` : "",
      p.settings?.length ? `settings: ${short(p.settings.map((x) => `${x.key} ${x.from ?? "(not set)"} -> ${x.to ?? "(not set)"}`))}` : "",
    ].filter(Boolean).join("; ") : "";
    const note = [...(p.status === "fail" && !p.removed ? p.reasons : []), ...(p.status === "restore" ? p.reasons : []), ...(p.warnings || [])].join("; ");
    const words = p.words ? `${p.words.before} -> ${p.words.after} (${p.words.dropPercent > 0 ? "-" : "+"}${Math.abs(p.words.dropPercent)}%)` : a ? `${a.words}` : b ? `${b.words} -> 0` : "-";
    const status = { fail: "FAIL", pass: "ok", new: "new (warnings only)", restore: "ok (undo)" }[p.status];
    return `| ${cell(status)} | ${cell(p.file)}${p.id !== p.file ? ` (${cell(p.id)})` : ""} | ${cell(words)} | ${n(b, "headings")} -> ${n(a, "headings")} | ${n(b, "links")} -> ${n(a, "links")} | ${n(b, "images")} -> ${n(a, "images")} | ${n(b, "schema")} -> ${n(a, "schema")} | ${cell(removed || note || "")} |`;
  });
  return `${head}\n\nA page may lose at most ${maxWordDropPercent}% of its words and no heading, internal link, image, structured data or page setting (draft, noindex, canonical, permalink...); hidden or commented-out text does not count. Before -> after:\n\n| Result | Page | Words | Headings | Internal links | Images | Structured data | Removed / notes |\n|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n${result.failed && !override?.applied ? `\nIf the loss is intended (pruning, merging pages), a person other than the pull request's author adds the label \`${OVERRIDE_LABEL}\` and re-runs this check. The autopilot and the agents never add it.\n` : ""}`;
}
