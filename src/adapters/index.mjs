// Content adapters: how the autopilot learns what pages a site already has, and (for scheduling) where they live.
// It needs this to avoid proposing pages that exist, to count scheduled and live pages, to schedule approved pages,
// and to tell the build when something is due.
//
//   content: { "type": "sitemap" }                                     zero-config: uses the live sitemap (read-only)
//   content: { "type": "json", "include": ["src/content/**/*.json"],   arrays of page objects in JSON files
//              "routes": [{ "match": "guides.json", "urlPattern": "/blog/{slug}" }] }
//   content: { "type": "markdown", "dir": "content/blog", "urlPattern": "/blog/{slug}" }   front-matter files
//
// Pages are plain data: { id, title, keyword, questions[], text, file, url?, publishAt?, queued?, hold?, author?, reviewedBy?, template? }.
// Drip publishing convention (all optional): a page with  "queued": true  is approved but not yet scheduled;
// "publishAt": "YYYY-MM-DD"  is the day it should go live; "hold": true  keeps a finished page out of the schedule.
import { readFileSync, writeFileSync } from "node:fs";
import { relative, extname } from "node:path";
import { findFiles, addDays } from "../core/util.mjs";

const first = (o, keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== "") return o[k]; return undefined; };
const TITLE_KEYS = ["h1", "title", "name", "term", "metaTitle", "headline"];
const KEYWORD_KEYS = ["primaryKeyword", "keyword", "focusKeyword"];
const fwd = (p) => p.split("\\").join("/");

function urlFor(site, file, slug, own) {
  // An entry that states its own path ("path": "/partners/agencies") wins over the pattern: hubs and nested pages cannot be built from a slug.
  if (typeof own === "string" && own.startsWith("/")) return site.url.replace(/\/$/, "") + own;
  const c = site.content || {};
  const route = (c.routes || []).find((r) => file.includes(r.match));
  const pattern = route?.urlPattern || c.urlPattern;
  return pattern ? site.url.replace(/\/$/, "") + pattern.replace("{slug}", slug) : undefined;
}

// author / reviewedBy may be a string, a {name} object or a list; keep a plain string (or undefined when empty).
const personOf = (v) => { const x = Array.isArray(v) ? v[0] : v; const n = typeof x === "object" && x ? x.name : x; return n == null || String(n).trim() === "" ? undefined : String(n).trim(); };

function fromObject(it, file, site) {
  const title = String(first(it, TITLE_KEYS) ?? "");
  const questions = (it.faqs || it.faq || []).map((q) => q?.q ?? q?.question).filter(Boolean);
  const keyword = String(first(it, KEYWORD_KEYS) ?? "");
  const text = [title, it.metaTitle, keyword, ...questions].filter(Boolean).join(" ").toLowerCase();
  const slug = String(it.slug ?? it.id ?? title);
  return {
    id: slug, title, keyword, questions, text, file, url: urlFor(site, file, slug, it.path),
    publishAt: it.publishAt ?? undefined, queued: it.queued === true, hold: it.hold === true,
    author: personOf(it.author), reviewedBy: personOf(it.reviewedBy ?? it.reviewed_by),
    template: it.template ?? it.type ?? undefined,
  };
}

function jsonFiles(site) { return findFiles(site.paths.root, site.content.include); }

function jsonAdapter(site) {
  const pages = [];
  for (const file of jsonFiles(site)) {
    let data; try { data = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    if (!Array.isArray(data)) continue;
    for (const it of data) if (it && typeof it === "object") pages.push(fromObject(it, fwd(relative(site.paths.root, file)), site));
  }
  return pages;
}

/** Tiny front-matter reader: key: value, quoted strings, [a, b] lists. Enough for titles, keywords and dates. */
export function parseFrontMatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, "");
    if (v === "true") v = true; else if (v === "false") v = false;
    out[kv[1]] = v;
  }
  return out;
}

function markdownFiles(site) {
  const c = site.content;
  const ext = c.ext || [".md", ".mdx"];
  return findFiles(site.paths.root, ext.map((e) => `${c.dir.replace(/\/$/, "")}/**/*${e}`));
}

function markdownAdapter(site) {
  const pages = [];
  for (const file of markdownFiles(site)) {
    const fm = parseFrontMatter(readFileSync(file, "utf8"));
    const slug = String(fm.slug || file.split(/[\\/]/).pop().replace(extname(file), ""));
    pages.push(fromObject({ slug, ...fm, queued: fm.queued === true }, fwd(relative(site.paths.root, file)), site));
  }
  return pages;
}

async function sitemapAdapter(site) {
  try {
    const xml = await (await fetch(site.sitemap)).text();
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => {
      const slug = m[1].replace(site.url, "").replace(/[/_-]+/g, " ").trim();
      return { id: m[1], title: slug, keyword: "", questions: [], text: slug.toLowerCase(), file: undefined, url: m[1] };
    });
  } catch { return []; }
}

/** The content files themselves (json or markdown sites); [] for sitemap sites, whose source is not in the repository. */
export function contentFiles(site) {
  const t = site.content?.type ?? "sitemap";
  return t === "json" ? jsonFiles(site) : t === "markdown" ? markdownFiles(site) : [];
}

export async function loadPages(site) {
  const t = site.content?.type ?? "sitemap";
  if (t === "json") return jsonAdapter(site);
  if (t === "markdown") return markdownAdapter(site);
  return sitemapAdapter(site);
}

// "Is this topic already covered by an existing page?" Fuzzy: most meaningful words must appear in one page's text.
const STOP = new Set(["ai", "for", "to", "the", "and", "of", "a", "in", "with", "how", "what", "is", "do", "does", "can", "vs", "best", "your", "my", "on", "an", "are", "why"]);
export const tokens = (q) => String(q).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
const stem = (w) => w.replace(/(ing|ers|er|es|s)$/, "");

export function makeCovered(pages, extraTexts = []) {
  const texts = [...pages.map((p) => p.text), ...extraTexts.map((t) => t.toLowerCase())];
  return (q) => {
    const t = tokens(q).map(stem);
    if (!t.length) return false;
    return texts.some((txt) => t.filter((w) => txt.includes(w)).length / t.length >= 0.75);
  };
}

/** Pipeline numbers for the digest and dashboard, when pages carry publishAt / queued / hold fields. */
export function pipeline(pages, day) {
  const dated = pages.filter((p) => p.publishAt);
  const d = (p) => String(p.publishAt).slice(0, 10);
  const weekAgo = addDays(day, -7);
  return {
    tracked: dated.length > 0 || pages.some((p) => p.queued || p.hold),
    liveThisWeek: dated.filter((p) => d(p) <= day && d(p) > weekAgo).length,
    upcoming: dated.filter((p) => d(p) > day).length,
    queued: pages.filter((p) => p.queued && !p.hold).length,
    held: pages.filter((p) => p.hold).length,
    schedule: dated.filter((p) => d(p) > day).map((p) => ({ date: d(p), title: p.title, url: p.url })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Give queued pages release dates, `perDay` a day, starting `start`. Queued = approved by a human (the pull request was
 * merged) but not yet dated. Pages marked hold:true are skipped. JSON files get "publishAt" and lose "queued";
 * Markdown files get a publishAt line and lose "queued: true". Returns [{ date, id, file }].
 */
export function scheduleQueued(site, { perDay = 3, start, dry = false } = {}) {
  const per = Math.max(1, Math.min(4, perDay));
  const used = {};
  const touched = [];
  const t = site.content?.type;
  if (t !== "json" && t !== "markdown") throw new Error('Scheduling needs content.type "json" or "markdown" (a sitemap cannot be edited).');
  const files = t === "json" ? jsonFiles(site) : markdownFiles(site);

  const data = files.map((file) => ({ file, src: readFileSync(file, "utf8"), list: t === "json" ? (() => { try { const j = JSON.parse(readFileSync(file, "utf8")); return Array.isArray(j) ? j : null; } catch { return null; } })() : null }));
  const dateOf = (x) => (t === "json" ? x.publishAt : parseFrontMatter(x).publishAt);
  for (const d of data) {
    if (t === "json" && d.list) for (const it of d.list) { if (it?.publishAt) used[String(it.publishAt).slice(0, 10)] = (used[String(it.publishAt).slice(0, 10)] || 0) + 1; }
    if (t === "markdown") { const p = dateOf(d.src); if (p) used[String(p).slice(0, 10)] = (used[String(p).slice(0, 10)] || 0) + 1; }
  }
  let day = start || new Date().toISOString().slice(0, 10);
  const nextSlot = () => { while ((used[day] || 0) >= per) day = addDays(day, 1); used[day] = (used[day] || 0) + 1; return day; };

  for (const d of data) {
    if (t === "json") {
      if (!d.list) continue;
      let changed = false;
      for (const it of d.list) {
        if (it?.queued !== true || it.hold === true) continue;
        const date = nextSlot();
        touched.push({ date, id: String(it.slug ?? it.id ?? it.title), file: fwd(relative(site.paths.root, d.file)) });
        if (!dry) { delete it.queued; it.publishAt = date; changed = true; }
      }
      if (changed && !dry) writeFileSync(d.file, JSON.stringify(d.list, null, 2) + "\n");
    } else {
      const fm = parseFrontMatter(d.src);
      if (fm.queued !== true || fm.hold === true) continue;
      const date = nextSlot();
      touched.push({ date, id: String(fm.slug || fwd(d.file).split("/").pop()), file: fwd(relative(site.paths.root, d.file)) });
      if (!dry) {
        let out = d.src.replace(/^queued:\s*true\s*\r?\n/m, "");
        out = /^publishAt:/m.test(out) ? out.replace(/^publishAt:.*$/m, `publishAt: ${date}`) : out.replace(/^---\r?\n/, `---\npublishAt: ${date}\n`);
        writeFileSync(d.file, out);
      }
    }
  }
  return touched;
}

/**
 * Set new publishAt dates on existing pages (used by `pace --apply`). `moves` = [{ id, file, to }] from analysePace().
 * Safe by design: a JSON file is rewritten only when it is exactly what JSON.stringify(list, null, 2) would write (so no
 * formatting is lost), line endings are kept, and a page that is not found or whose file cannot be rewritten safely is
 * reported in `skipped` rather than guessed at. With dry: true nothing is written.
 */
export function applyDates(site, moves, { dry = false } = {}) {
  const applied = [];
  const skipped = [];
  const byFile = new Map();
  for (const m of moves) { if (!m.file) { skipped.push({ ...m, reason: "no source file" }); continue; } (byFile.get(m.file) || byFile.set(m.file, []).get(m.file)).push(m); }
  for (const [rel, list] of byFile) {
    const abs = site.paths.root + "/" + rel;
    let raw;
    try { raw = readFileSync(abs, "utf8"); } catch { for (const m of list) skipped.push({ ...m, reason: "file not readable" }); continue; }
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const norm = raw.replace(/\r\n/g, "\n");
    if (rel.endsWith(".json")) {
      let data; try { data = JSON.parse(norm); } catch { data = null; }
      const same = Array.isArray(data) && [JSON.stringify(data, null, 2) + "\n", JSON.stringify(data, null, 2)].includes(norm);
      if (!same) { for (const m of list) skipped.push({ ...m, reason: "JSON formatting would change; edit publishAt by hand" }); continue; }
      let changed = false;
      for (const m of list) {
        const it = data.find((x) => x && String(x.slug ?? x.id ?? x.h1 ?? x.title ?? x.name) === String(m.id));
        if (!it) { skipped.push({ ...m, reason: "page not found in file" }); continue; }
        if (String(it.publishAt || "").slice(0, 10) === m.to) continue;
        it.publishAt = m.to; changed = true; applied.push({ id: m.id, file: rel, from: m.from, to: m.to });
      }
      if (changed && !dry) writeFileSync(abs, (JSON.stringify(data, null, 2) + (norm.endsWith("\n") ? "\n" : "")).replace(/\n/g, eol));
    } else {
      // Markdown: replace the publishAt line in the front matter (one page per file).
      const m = list[0];
      if (!/^publishAt:.*$/m.test(norm)) { skipped.push({ ...m, reason: "no publishAt line in front matter" }); continue; }
      applied.push({ id: m.id, file: rel, from: m.from, to: m.to });
      if (!dry) writeFileSync(abs, norm.replace(/^publishAt:.*$/m, `publishAt: ${m.to}`).replace(/\n/g, eol));
    }
  }
  return { applied, skipped };
}

/**
 * Take pages off the site without deleting anything (seo-watch, when a new page harms the pages around it). Sets the
 * site's draft field (content.unpublish, default { "field": "draft", "value": true }) and hold: true (so the scheduler
 * never dates it again) on each target [{ file, id }]. The file stays, the slug and URL stay, the text stays: undoing it is
 * one line. The site's build must leave drafts out (docs/content-automation.md). JSON files are rewritten only when that
 * keeps their formatting (as applyDates); anything that cannot be changed safely is reported in `skipped`.
 */
/** The site's unpublish field and value (content.unpublish; default draft: true). */
export function unpublishSetting(site) {
  const u = site?.content?.unpublish || {};
  return { field: typeof u.field === "string" && /^[A-Za-z_][\w-]*$/.test(u.field) ? u.field : "draft", value: u.value === undefined ? true : u.value };
}

/**
 * Pure: the text of one content file with the given pages unpublished (field + hold: true). rel decides the format.
 * Returns { out, applied: [id], skipped: [{ id, reason }] }; out === the input when nothing changed. Used by the
 * adapter below and by the content-loss guard to confirm that a seo-watch unpublish changed nothing else.
 */
export function unpublishText(rel, raw, ids = [], { field = "draft", value = true } = {}) {
  const applied = [], skipped = [];
  const eol = String(raw).includes("\r\n") ? "\r\n" : "\n";
  const norm = String(raw).replace(/\r\n/g, "\n");
  if (String(rel).endsWith(".json")) {
    let data; try { data = JSON.parse(norm); } catch { data = null; }
    const same = Array.isArray(data) && [JSON.stringify(data, null, 2) + "\n", JSON.stringify(data, null, 2)].includes(norm);
    if (!same) { for (const id of ids) skipped.push({ id, reason: `JSON formatting would change; set "${field}": ${JSON.stringify(value)} by hand` }); return { out: raw, applied, skipped }; }
    let changed = false;
    for (const id of ids) {
      const it = data.find((x) => x && String(x.slug ?? x.id ?? x.h1 ?? x.title ?? x.name) === String(id));
      if (!it) { skipped.push({ id, reason: "page not found in file" }); continue; }
      if (it[field] === value && it.hold === true) continue;
      it[field] = value; it.hold = true; changed = true; applied.push(id);
    }
    return { out: changed ? (JSON.stringify(data, null, 2) + (norm.endsWith("\n") ? "\n" : "")).replace(/\n/g, eol) : raw, applied, skipped };
  }
  // Markdown/MDX: one page per file; set the field and hold in the front matter (adding a front matter block if none).
  const id = ids[0];
  const line = `${field}: ${typeof value === "string" ? JSON.stringify(value) : String(value)}`;
  const set = (fm, re, l) => (re.test(fm) ? fm.replace(re, l) : `${fm}\n${l}`);
  let out;
  const m = norm.match(/^---\n([\s\S]*?)\n---[ \t]*(\n|$)/);
  if (m) {
    let fm = set(m[1], new RegExp(`^${field}:.*$`, "m"), line);
    fm = set(fm, /^hold:.*$/m, "hold: true");
    out = `---\n${fm}\n---${m[2]}` + norm.slice(m[0].length);
  } else if (/^\+\+\+\n/.test(norm)) { skipped.push({ id, reason: `TOML front matter: set ${field} by hand` }); return { out: raw, applied, skipped }; }
  else out = `---\n${line}\nhold: true\n---\n` + norm;
  if (out === norm) return { out: raw, applied, skipped };
  applied.push(id);
  return { out: out.replace(/\n/g, eol), applied, skipped };
}

export function unpublishPages(site, targets = [], { dry = false } = {}) {
  const { field, value } = unpublishSetting(site);
  const applied = [], skipped = [];
  const byFile = new Map();
  for (const t of targets) { if (!t.file) { skipped.push({ ...t, reason: "no source file" }); continue; } (byFile.get(t.file) || byFile.set(t.file, []).get(t.file)).push(t); }
  for (const [rel, list] of byFile) {
    const abs = site.paths.root + "/" + rel;
    let raw;
    try { raw = readFileSync(abs, "utf8"); } catch { for (const t of list) skipped.push({ ...t, reason: "file not readable" }); continue; }
    const ids = rel.endsWith(".json") ? list.map((t) => t.id) : [list[0].id];
    const r = unpublishText(rel, raw, ids, { field, value });
    for (const k of r.skipped) skipped.push({ ...list.find((t) => String(t.id) === String(k.id)), file: rel, reason: k.reason });
    for (const id of r.applied) applied.push({ file: rel, id, field, value });
    if (r.out !== raw && !dry) writeFileSync(abs, r.out);
  }
  return { applied, skipped, field, value };
}
