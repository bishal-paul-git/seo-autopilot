// Portable Text <-> Markdown, for CMSs that store rich text as Portable Text (EmDash, Sanity and others).
// Pure: no network, no files. Used by the CMS mirror (src/cms/mirror.mjs) to keep posts as reviewable Markdown files.
//
// The rule that keeps this safe: a block is written as plain Markdown only when converting it back gives the same
// block (ignoring _key values, which are random). Anything else (a table, an embed, an unknown mark, an empty
// paragraph, an image with extra data) is written as an opaque fence, `<!--ec:block {json} -->`, the same fence the
// EmDash CLI uses. Fences come back unchanged, so a round trip never loses content; they are counted as "opaque"
// so a reviewer knows that part of the post can only be edited as JSON.
//
// Markdown dialect (deliberately small, so a person or an agent can edit it in a pull request):
//   paragraphs separated by a blank line; "\" at the end of a line is a line break inside the same block
//   # .. ###### headings, "> " quote, "- " bullet and "1. " numbered list items (two spaces per nesting level)
//   **strong**, _em_, `code`, ~~strike~~, [text](href); "\" escapes a literal * _ ` [ ] ~ \ character
//   ![alt](url) images, ```lang code fences

const FENCE = /^<!--ec:block (.+) -->$/;
const DELIMS = { strong: "**", em: "_", "strike-through": "~~" };
const DELIM_MARK = { "**": "strong", _: "em", "~~": "strike-through" };
const MARK_ALIASES = { strikethrough: "strike-through" };
const ESCAPABLE = /[\\*_`[\]~]/g;

// ------------------------------------------------------------------------------------------------ normalised form

/**
 * The comparable shape of a block list: no _key, link marks named by their href, marks sorted, neighbouring spans
 * with the same marks merged. Two lists that normalise to the same JSON render the same.
 */
export function normalizeBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map(normalizeBlock);
}

const normalizeBlock = (b) => sortKeys(normalizeBlockShape(b));

function normalizeBlockShape(b) {
  if (!b || typeof b !== "object") return b;
  if (b._type !== "block") return stripKeys(b);
  const defs = new Map((b.markDefs || []).map((d) => [d._key, d]));
  const out = {};
  for (const [k, v] of Object.entries(b)) if (!["_key", "markDefs", "children"].includes(k)) out[k] = v;
  out.style = b.style || "normal";
  if (out.listItem && out.level == null) out.level = 1;
  const spans = [];
  for (const s of b.children || []) {
    if (!s || s._type !== "span") { spans.push(stripKeys(s)); continue; }
    const marks = (s.marks || []).map((m) => {
      const d = defs.get(m);
      if (!d) return MARK_ALIASES[m] || m;
      if (d._type === "link" && Object.keys(d).every((k) => ["_key", "_type", "href"].includes(k))) return `link:${d.href ?? ""}`;
      return `def:${JSON.stringify(stripKeys(d))}`;
    }).sort();
    const extra = {};
    for (const [k, v] of Object.entries(s)) if (!["_key", "_type", "text", "marks"].includes(k)) extra[k] = v;
    const span = { _type: "span", text: s.text ?? "", marks: [...new Set(marks)], ...extra };
    const prev = spans[spans.length - 1];
    if (prev && prev._type === "span" && Object.keys(extra).length === 0 && Object.keys(prev).length === 3 && prev.marks.join("\u0000") === span.marks.join("\u0000")) prev.text += span.text;
    else spans.push(span);
  }
  // Empty spans next to real text carry nothing; a block made only of an empty span keeps it.
  const kept = spans.filter((s) => s._type !== "span" || s.text !== "" || spans.length === 1);
  out.children = kept.length ? kept : [{ _type: "span", text: "", marks: [] }];
  return out;
}

function stripKeys(v) {
  if (Array.isArray(v)) return v.map(stripKeys);
  if (!v || typeof v !== "object") return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) if (k !== "_key") o[k] = stripKeys(x);
  return o;
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!v || typeof v !== "object") return v;
  const o = {};
  for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = sortKeys(v[k]);
  return o;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------------------------------------ PT -> Markdown

/**
 * Portable Text blocks to Markdown. Returns { markdown, opaque, problems }: opaque is how many blocks went into
 * fences (with the reason for each in problems).
 */
export function toMarkdown(blocks) {
  const out = [];
  const problems = [];
  let opaque = 0;
  let prevList = false;
  (Array.isArray(blocks) ? blocks : []).forEach((b, i) => {
    let md = renderBlock(b);
    let why = md == null ? unsupportedReason(b) : null;
    if (md != null) {
      // Self-check: the block must come back as itself, otherwise fence it.
      const back = fromMarkdown(md);
      if (back.length !== 1 || !same(normalizeBlock(back[0]), normalizeBlock(b))) { why = "would change in Markdown"; md = null; }
    }
    if (md == null) {
      opaque++;
      problems.push({ index: i, type: b?._type ?? typeof b, reason: why || "unsupported" });
      md = fence(b);
    }
    const isList = b?._type === "block" && !!b.listItem && !md.startsWith("<!--");
    if (out.length && !(isList && prevList)) out.push("");
    out.push(md);
    prevList = isList;
  });
  return { markdown: out.length ? out.join("\n") + "\n" : "", opaque, problems };
}

function fence(b) {
  // ">" is escaped so a "-->" inside a string can never end the comment early.
  return `<!--ec:block ${JSON.stringify(b).replace(/>/g, "\\u003e")} -->`;
}

function unsupportedReason(b) {
  if (!b || typeof b !== "object") return "not an object";
  if (b._type === "block") return "block shape not representable";
  if (b._type === "image") return "image with data beyond alt and url";
  return `block type "${b._type}"`;
}

function renderBlock(b) {
  if (!b || typeof b !== "object") return null;
  if (b._type === "code") return renderCode(b);
  if (b._type === "image") return renderImage(b);
  if (b._type !== "block") return null;
  const known = new Set(["_type", "_key", "style", "listItem", "level", "markDefs", "children"]);
  if (Object.keys(b).some((k) => !known.has(k))) return null;
  const style = b.style || "normal";
  const text = renderSpans(b.children || [], b.markDefs || []);
  if (text == null || text === "") return null;
  if (b.listItem) {
    if (!["bullet", "number"].includes(b.listItem) || style !== "normal") return null;
    const indent = "  ".repeat(Math.max(0, (b.level ?? 1) - 1));
    const marker = b.listItem === "number" ? "1. " : "- ";
    return indent + marker + text.split("\n").join("\n" + indent + " ".repeat(marker.length));
  }
  const h = style.match(/^h([1-6])$/);
  if (h) return text.includes("\n") ? null : `${"#".repeat(Number(h[1]))} ${text}`;
  if (style === "blockquote") return text.includes("\n") ? null : `> ${text}`;
  if (style !== "normal") return null;
  return escapeLineStart(text);
}

function renderCode(b) {
  const known = new Set(["_type", "_key", "code", "language"]);
  if (Object.keys(b).some((k) => !known.has(k)) || typeof (b.code ?? "") !== "string") return null;
  const code = b.code ?? "";
  let ticks = "```";
  while (code.includes(ticks)) ticks += "`";
  const lang = b.language || "";
  if (/[\s`]/.test(lang)) return null;
  return `${ticks}${lang}\n${code}\n${ticks}`;
}

function renderImage(b) {
  const known = new Set(["_type", "_key", "alt", "asset"]);
  if (Object.keys(b).some((k) => !known.has(k))) return null;
  const a = b.asset;
  if (!a || typeof a !== "object" || Object.keys(a).some((k) => k !== "url") || typeof a.url !== "string" || !a.url) return null;
  if (/[\s()<>]/.test(a.url)) return null;
  return `![${escapeText(b.alt ?? "")}](${a.url})`;
}

const escapeText = (s) => String(s).replace(ESCAPABLE, (c) => "\\" + c);

// A paragraph line must not look like another block. Escape the first character when it would.
function escapeLineStart(text) {
  return text.split("\n").map((line) => (/^(#{1,6}\s|>|[-+]\s|\d+\.\s|```|!\[|<!--|\s)/.test(line) ? "\\" + line : line)).join("\n");
}

// Marks are opened longest-run first, so a mark shared by several spans is written once around all of them.
function renderSpans(spans, markDefs) {
  const defs = new Map(markDefs.map((d) => [d._key, d]));
  for (const s of spans) {
    if (!s || s._type !== "span" || typeof (s.text ?? "") !== "string") return null;
    if (Object.keys(s).some((k) => !["_type", "_key", "text", "marks"].includes(k))) return null;
    for (const m of s.marks || []) {
      const d = defs.get(m);
      if (d) { if (d._type !== "link" || typeof d.href !== "string" || Object.keys(d).some((k) => !["_key", "_type", "href"].includes(k))) return null; }
      else if (!DELIMS[MARK_ALIASES[m] || m] && m !== "code") return null;
    }
  }
  const keyOf = (m) => (defs.get(m) ? `link:${defs.get(m).href}` : MARK_ALIASES[m] || m);
  const markSets = spans.map((s) => [...new Set((s.marks || []).map(keyOf))]);
  let out = "";
  const stack = [];
  const close = (m) => (m.startsWith("link:") ? `](${escapeHref(m.slice(5))})` : DELIMS[m]);
  const open = (m) => (m.startsWith("link:") ? "[" : DELIMS[m]);
  for (let i = 0; i < spans.length; i++) {
    const marks = markSets[i];
    const text = spans[i].text ?? "";
    // Code is always innermost; the rest by how long they keep going.
    const run = (m) => { let n = 0; for (let j = i; j < spans.length && markSets[j].includes(m); j++) n++; return n; };
    const order = marks.filter((m) => m !== "code").sort((a, b) => run(b) - run(a) || (a < b ? -1 : 1));
    let keep = 0;
    while (keep < stack.length && marks.includes(stack[keep]) && stack[keep] !== "code") keep++;
    while (stack.length > keep) out += close(stack.pop());
    for (const m of order) if (!stack.includes(m)) { out += open(m); stack.push(m); }
    if (marks.includes("code")) {
      if (text === "" || /^\s|\s$/.test(text) || text.includes("\n")) return null;
      let ticks = "`";
      while (text.includes(ticks)) ticks += "`";
      out += text.includes("`") ? `${ticks} ${text} ${ticks}` : `${ticks}${text}${ticks}`;
    } else out += escapeText(text).replace(/\n/g, "\\\n");
  }
  while (stack.length) out += close(stack.pop());
  return out;
}

const escapeHref = (h) => String(h).replace(/[\\()]/g, (c) => "\\" + c);

// ------------------------------------------------------------------------------------------------ Markdown -> PT

/** Markdown (the dialect above) to Portable Text blocks, with fresh deterministic keys. */
export function fromMarkdown(markdown) {
  const keys = keyMaker();
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  // A line ending in an odd number of backslashes continues on the next line (a line break inside the block).
  const continues = (l) => { const m = l.match(/\\+$/); return !!m && m[0].length % 2 === 1; };
  const gather = (first, indent) => {
    let text = first;
    while (continues(text) && i + 1 < lines.length) {
      i++;
      text = text.slice(0, -1) + "\n" + lines[i].slice(Math.min(indent, lines[i].match(/^ */)[0].length));
    }
    return text;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    const f = line.match(FENCE);
    if (f) {
      try { blocks.push(JSON.parse(f[1])); } catch { blocks.push(textBlock(line, "normal", keys)); }
      i++; continue;
    }
    const code = line.match(/^(`{3,})([^`\s]*)\s*$/);
    if (code) {
      const body = [];
      i++;
      while (i < lines.length && lines[i] !== code[1]) body.push(lines[i++]);
      i++;
      const b = { _type: "code", _key: keys(), code: body.join("\n") };
      if (code[2]) b.language = code[2];
      blocks.push(b);
      continue;
    }
    const img = line.match(/^!\[((?:\\.|[^\]\\])*)\]\(([^\s()<>]+)\)$/);
    if (img) {
      blocks.push({ _type: "image", _key: keys(), alt: unescape(img[1]), asset: { url: img[2] } });
      i++; continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push(textBlock(h[2], `h${h[1].length}`, keys)); i++; continue; }
    if (line.startsWith("> ")) { blocks.push(textBlock(line.slice(2), "blockquote", keys)); i++; continue; }
    const li = line.match(/^( *)([-*+]|\d+\.)\s+(.*)$/);
    if (li) {
      const indent = li[1].length + li[2].length + 1;
      const text = gather(line, indent).slice(indent);
      const b = textBlock(text, "normal", keys);
      blocks.push({ ...b, listItem: /\d/.test(li[2]) ? "number" : "bullet", level: Math.floor(li[1].length / 2) + 1 });
      i++; continue;
    }
    let text = gather(line, 0);
    // A leading backslash only stopped the line from being read as another block type.
    text = text.split("\n").map((l) => (/^\\[^\\*_`[\]~]/.test(l) ? l.slice(1) : l)).join("\n");
    blocks.push(textBlock(text, "normal", keys));
    i++;
  }
  return blocks;
}

function keyMaker() {
  let n = 0;
  return () => `k${(n++).toString(36)}`;
}

const unescape = (s) => String(s).replace(/\\([\\*_`[\]~()])/g, "$1");

function textBlock(text, style, keys) {
  const markDefs = [];
  const children = parseInline(text, markDefs, keys);
  return { _type: "block", _key: keys(), style, markDefs, children: children.length ? children : [{ _type: "span", _key: keys(), text: "", marks: [] }] };
}

// Inline: tokenise, then match openers with closers. An opener with no closer is plain text.
function tokenize(s) {
  const t = [];
  let i = 0;
  let text = "";
  const flush = () => { if (text) { t.push({ k: "text", v: text }); text = ""; } };
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length && /[\\*_`[\]~()\n]/.test(s[i + 1])) { text += s[i + 1]; i += 2; continue; }
    if (c === "`") {
      const run = s.slice(i).match(/^`+/)[0];
      const end = s.indexOf(run, i + run.length);
      if (end > -1 && s[end + run.length] !== "`") {
        let v = s.slice(i + run.length, end);
        if (run.length > 1 && v.startsWith(" ") && v.endsWith(" ") && v.length > 1) v = v.slice(1, -1);
        flush(); t.push({ k: "code", v }); i = end + run.length; continue;
      }
      text += run; i += run.length; continue;
    }
    if (s.startsWith("**", i) || s.startsWith("~~", i)) { flush(); t.push({ k: "d", v: s.slice(i, i + 2) }); i += 2; continue; }
    if (c === "_") { flush(); t.push({ k: "d", v: "_" }); i++; continue; }
    if (c === "[") { flush(); t.push({ k: "lo" }); i++; continue; }
    if (c === "]" && s[i + 1] === "(") {
      // href up to the matching unescaped ")"; "\(" and "\)" are literal parentheses.
      let j = i + 2, href = "", ok = false;
      while (j < s.length) {
        if (s[j] === "\\" && /[\\()]/.test(s[j + 1] || "")) { href += s[j + 1]; j += 2; continue; }
        if (s[j] === ")") { ok = true; break; }
        if (s[j] === "\n") break;
        href += s[j++];
      }
      if (ok) { flush(); t.push({ k: "lc", v: href }); i = j + 1; continue; }
    }
    text += c; i++;
  }
  flush();
  return t;
}

function parseInline(s, markDefs, keys) {
  const tokens = tokenize(s);
  const spans = [];
  const push = (text, marks) => {
    const prev = spans[spans.length - 1];
    if (prev && prev.marks.join() === marks.join()) prev.text += text;
    else spans.push({ _type: "span", _key: keys(), text, marks: [...marks] });
  };
  // Pair each opener with its closer (properly nested); unpaired ones are plain text.
  const mate = matchPairs(tokens);
  const marks = [];
  const linkKey = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.k === "text") push(tk.v, marks);
    else if (tk.k === "code") push(tk.v, [...marks, "code"]);
    else if (tk.k === "d") {
      if (mate[i] == null) { push(tk.v, marks); continue; }
      const m = DELIM_MARK[tk.v];
      if (mate[i] > i) marks.push(m); else marks.splice(marks.lastIndexOf(m), 1);
    } else if (tk.k === "lo") {
      if (mate[i] == null) { push("[", marks); continue; }
      const key = keys();
      markDefs.push({ _key: key, _type: "link", href: tokens[mate[i]].v });
      linkKey.set(i, key);
      marks.push(key);
    } else if (tk.k === "lc") {
      if (mate[i] == null) { push(`](${tk.v})`, marks); continue; }
      marks.splice(marks.lastIndexOf(linkKey.get(mate[i])), 1);
    }
  }
  for (const s of spans) s.marks = [...new Set(s.marks)];
  return spans.filter((x) => x.text !== "" || spans.length === 1);
}

// Proper nesting: walk left to right with a stack of open tokens; a closer matches only the top of the stack, or
// pops unmatched openers above a matching one (those become text).
function matchPairs(tokens) {
  const mate = new Array(tokens.length).fill(null);
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.k === "d") {
      const at = findLast(stack, (x) => tokens[x].k === "d" && tokens[x].v === tk.v);
      if (at > -1) { const o = stack[at]; stack.length = at; mate[o] = i; mate[i] = o; }
      else stack.push(i);
    } else if (tk.k === "lo") stack.push(i);
    else if (tk.k === "lc") {
      const at = findLast(stack, (x) => tokens[x].k === "lo");
      if (at > -1) { const o = stack[at]; stack.length = at; mate[o] = i; mate[i] = o; }
    }
  }
  // An opener inside a link that closes outside it would cross; the stack truncation above leaves those unmatched.
  return mate;
}

function findLast(a, fn) { for (let i = a.length - 1; i >= 0; i--) if (fn(a[i])) return i; return -1; }

// ------------------------------------------------------------------------------------------------ checks and facts

/** Convert to Markdown and back. ok means nothing changed (opaque fences included); differences lists block indexes. */
export function roundTrip(blocks) {
  const { markdown, opaque, problems } = toMarkdown(blocks);
  const back = fromMarkdown(markdown);
  const a = normalizeBlocks(blocks), b = normalizeBlocks(back);
  const differences = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (!same(a[i], b[i])) differences.push(i);
  return { ok: differences.length === 0, markdown, opaque, problems, differences };
}

const CJK = /([\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}])/gu;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}‌‍'’_-]*/gu;
/** Words in any script (same rule as the content-loss guard). */
export function countWords(text) { return (String(text || "").replace(CJK, " $1 ").match(WORD) || []).length; }

/** What a post body holds: words, headings, links, images, opaque blocks. For reports and the content-loss guard. */
export function blockFacts(blocks) {
  const facts = { words: 0, headings: [], links: [], images: [], blocks: 0, opaque: 0 };
  for (const b of Array.isArray(blocks) ? blocks : []) {
    facts.blocks++;
    if (b?._type === "block") {
      const text = (b.children || []).map((s) => s?.text ?? "").join("");
      facts.words += countWords(text);
      const h = (b.style || "").match(/^h([1-6])$/);
      if (h) facts.headings.push({ level: Number(h[1]), text: text.replace(/\s+/g, " ").trim() });
      for (const d of b.markDefs || []) if (d?._type === "link" && d.href) facts.links.push(d.href);
    } else if (b?._type === "image") {
      const u = b.asset?.url || b.asset?._ref || b.url;
      if (u) facts.images.push(String(u));
      if (b.alt) facts.words += countWords(b.alt);
    } else if (b?._type === "code") facts.words += countWords(b.code);
    else facts.opaque++;
  }
  facts.links = [...new Set(facts.links)];
  return facts;
}
