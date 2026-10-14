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

function urlFor(site, file, slug) {
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
    id: slug, title, keyword, questions, text, file, url: urlFor(site, file, slug),
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
