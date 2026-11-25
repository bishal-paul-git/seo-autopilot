// CMS mirror: each CMS post kept as one Markdown file with flat front matter, so changes go through a pull request
// (the approval record), the content-loss guard and git revert, while the CMS stays the place the site reads from.
// Pure: no network, no files. The client is src/cms/emdash.mjs; the commands are src/cms/commands.mjs.
//
//   ---
//   id: "01J..."                 CMS id; empty for a post that does not exist yet
//   slug: "my-post"              never changed for an existing post (a URL change needs a person)
//   title: "..."                 editable
//   excerpt: "..."               editable
//   seoTitle / seoDescription / seoImage / canonical / noIndex     editable, sent to the CMS only at publish
//   status, publishedAt, categories, tags, image, imageAlt, byline, locale     read-only copies of the CMS
//   baseRev: "..."               the CMS revision token when the file was last exported or published
//   ---
//   Markdown body (src/cms/portable-text.mjs)
//
// Values are JSON (strings in double quotes, null, true/false, ["a", "b"] lists), one key per line, so the project's
// tiny front-matter reader (src/adapters/index.mjs) and the content-loss guard can read the same files.

import { fromMarkdown, toMarkdown, normalizeBlocks, blockFacts } from "./portable-text.mjs";

export const DEFAULT_FIELDS = { title: "title", excerpt: "excerpt", body: "content", image: "featured_image" };
export const SEO_KEYS = { seoTitle: "title", seoDescription: "description", seoImage: "image", canonical: "canonical", noIndex: "noIndex" };
const KEY_ORDER = ["id", "slug", "title", "excerpt", "status", "publishedAt", "seoTitle", "seoDescription", "seoImage", "canonical", "noIndex", "categories", "tags", "image", "imageAlt", "byline", "locale", "baseRev"];
export const EDITABLE = ["title", "excerpt", "seoTitle", "seoDescription", "seoImage", "canonical", "noIndex"];
export const READ_ONLY = ["id", "slug", "status", "publishedAt", "categories", "tags", "image", "imageAlt", "byline", "locale"];
const LIMITS = { title: 200, seoTitle: 200, seoDescription: 500 };
export const LATIN_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// --------------------------------------------------------------------------------------------- file format

export function stringifyMirror(meta, body) {
  const lines = ["---"];
  const keys = [...KEY_ORDER.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !KEY_ORDER.includes(k)).sort()];
  for (const k of keys) {
    const v = meta[k];
    lines.push(`${k}: ${v === undefined ? "null" : JSON.stringify(v)}`);
  }
  lines.push("---", "");
  return lines.join("\n") + String(body ?? "");
}

/** Parse a mirror file. Returns { meta, body, errors }. Values are JSON; a bare word is read as a string. */
export function parseMirror(src) {
  const s = String(src ?? "").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = s.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { meta: {}, body: s, errors: ["no front matter (the file must start with ---)"] };
  const meta = {};
  const errors = [];
  m[1].split("\n").forEach((line, n) => {
    if (!line.trim() || line.trim().startsWith("#")) return;
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) { errors.push(`front matter line ${n + 2} is not "key: value"`); return; }
    if (kv[1] in meta) errors.push(`front matter key "${kv[1]}" appears twice`);
    const raw = kv[2].trim();
    try { meta[kv[1]] = raw === "" ? null : JSON.parse(raw); }
    catch { if (/^["[{]/.test(raw)) errors.push(`front matter "${kv[1]}" is not valid JSON: ${raw.slice(0, 60)}`); meta[kv[1]] = raw; }
  });
  return { meta, body: s.slice(m[0].length).replace(/^\n/, ""), errors };
}

// --------------------------------------------------------------------------------------------- CMS item <-> file

const blank = (v) => v === undefined || v === null || v === "";
const orNull = (v) => (blank(v) ? null : v);

function imageOf(img) {
  if (!img || typeof img !== "object") return { src: null, alt: null };
  const src = img.src || img.url || img.$media?.url || img.meta?.storageKey || img.id || null;
  return { src: src ? String(src) : null, alt: orNull(img.alt ?? img.$media?.alt) };
}

/**
 * A CMS item (EmDash content API shape) to a mirror file. extra: { categories, tags, rev }.
 * Returns { text, slug, roundTrip: { ok, opaque, problems, differences } }.
 */
export function itemToMirror(item, { fields = DEFAULT_FIELDS, categories = [], tags = [], rev = null } = {}) {
  const data = item.data || {};
  const seo = item.seo || {};
  const img = imageOf(data[fields.image]);
  const blocks = Array.isArray(data[fields.body]) ? data[fields.body] : [];
  const { markdown, opaque, problems } = toMarkdown(blocks);
  const back = fromMarkdown(markdown);
  const a = normalizeBlocks(blocks), b = normalizeBlocks(back);
  const differences = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) differences.push(i);
  const meta = {
    id: item.id, slug: item.slug, title: data[fields.title] ?? "", excerpt: orNull(data[fields.excerpt]),
    status: item.status, publishedAt: orNull(item.publishedAt),
    seoTitle: orNull(seo.title), seoDescription: orNull(seo.description), seoImage: orNull(seo.image), canonical: orNull(seo.canonical), noIndex: seo.noIndex === true,
    categories, tags, image: img.src, imageAlt: img.alt, byline: orNull(item.byline?.displayName), locale: orNull(item.locale), baseRev: rev,
  };
  if (!item.seo) for (const k of Object.keys(SEO_KEYS)) delete meta[k];
  return { text: stringifyMirror(meta, markdown), slug: item.slug, roundTrip: { ok: differences.length === 0, opaque, problems, differences } };
}

/** The comparable state of a post: what a publish changes. From a CMS item or from a mirror file. */
export function stateOfItem(item, fields = DEFAULT_FIELDS, data = item.data || {}) {
  const seo = item.seo;
  return {
    slug: item.slug ?? null,
    title: data[fields.title] ?? "",
    excerpt: orNull(data[fields.excerpt]),
    body: normalizeBlocks(Array.isArray(data[fields.body]) ? data[fields.body] : []),
    seo: seo ? { title: orNull(seo.title), description: orNull(seo.description), image: orNull(seo.image), canonical: orNull(seo.canonical), noIndex: seo.noIndex === true } : null,
  };
}

export function stateOfFile(parsed) {
  const { meta, body } = parsed;
  const hasSeo = Object.keys(SEO_KEYS).some((k) => k in meta);
  return {
    slug: meta.slug ?? null,
    title: meta.title ?? "",
    excerpt: orNull(meta.excerpt),
    body: normalizeBlocks(fromMarkdown(body)),
    seo: hasSeo ? { title: orNull(meta.seoTitle), description: orNull(meta.seoDescription), image: orNull(meta.seoImage), canonical: orNull(meta.canonical), noIndex: meta.noIndex === true } : null,
  };
}

/** Which parts differ between two states: ["title", "body", "seo", ...]. */
export function diffState(a, b, parts = ["slug", "title", "excerpt", "body", "seo"]) {
  return parts.filter((p) => JSON.stringify(a?.[p] ?? null) !== JSON.stringify(b?.[p] ?? null));
}

// --------------------------------------------------------------------------------------------- validation

/** Body facts plus the SEO keys present, for reports and the content-loss guard. */
export function fileFacts(parsed) {
  const f = blockFacts(fromMarkdown(parsed.body));
  const m = parsed.meta;
  return { ...f, title: m.title ?? "", seo: Object.fromEntries(Object.keys(SEO_KEYS).filter((k) => !blank(m[k]) && m[k] !== false).map((k) => [k, m[k]])), image: m.image ?? null };
}

/**
 * Check one mirror file, alone or against its previous version (base). Returns { errors, warnings, highRisk, facts }.
 * opts: { file, base (parsed or null), slugPattern (RegExp for new posts), siteUrl }.
 */
export function validateFile(parsed, { file = "", base = null, slugPattern = LATIN_SLUG } = {}) {
  const errors = [...(parsed.errors || [])];
  const warnings = [];
  const highRisk = [];
  const m = parsed.meta;
  if (blank(m.slug) || typeof m.slug !== "string") errors.push("slug is missing");
  else {
    if (/[\s/?#]/.test(m.slug)) errors.push(`slug "${m.slug}" has a space, / ? or #`);
    if (blank(m.id) && !slugPattern.test(m.slug)) errors.push(`new post slug "${m.slug}" must match ${slugPattern} (the CMS keeps explicit slugs as given)`);
    const name = file.split(/[\\/]/).pop();
    if (name && name !== `${m.slug}.md`) errors.push(`file name ${name} does not match the slug (expected ${m.slug}.md)`);
  }
  if (blank(m.title) || typeof m.title !== "string") errors.push("title is missing");
  for (const [k, max] of Object.entries(LIMITS)) if (typeof m[k] === "string" && m[k].length > max) errors.push(`${k} is ${m[k].length} characters (the CMS allows ${max})`);
  for (const k of ["title", "excerpt", "seoTitle", "seoDescription", "seoImage", "canonical"]) if (!blank(m[k]) && typeof m[k] !== "string") errors.push(`${k} must be a quoted string or null`);
  if (!blank(m.canonical) && !/^https?:\/\/[^\s]+$/.test(String(m.canonical))) errors.push(`canonical must be an http(s) URL`);
  if ("noIndex" in m && typeof m.noIndex !== "boolean") errors.push("noIndex must be true or false");
  if (m.noIndex === true) highRisk.push("noIndex is true: the page will ask search engines to drop it");
  // Opaque fences that no longer parse are read as plain text: that would publish JSON as words.
  parsed.body.split("\n").forEach((line, n) => {
    if (/^<!--ec:block /.test(line)) {
      const f = line.match(/^<!--ec:block (.+) -->$/);
      try { if (!f) throw new Error(); JSON.parse(f[1]); } catch { errors.push(`body line ${n + 1}: a <!--ec:block --> line is broken (it must stay one line of valid JSON)`); }
    }
  });
  const facts = fileFacts(parsed);
  if (facts.opaque) warnings.push(`${facts.opaque} block(s) kept as <!--ec:block --> JSON (not editable as Markdown)`);
  if (!facts.words) errors.push("the body has no words");
  if (base) {
    const b = base.meta;
    for (const k of READ_ONLY) {
      if (JSON.stringify(b[k] ?? null) === JSON.stringify(m[k] ?? null)) continue;
      if (k === "slug" && !blank(b.id)) errors.push(`slug changed from "${b.slug}" to "${m.slug}": changing a live URL needs a person and a redirect, not a mirror edit`);
      else if (k === "id") errors.push(`id changed: a file must stay tied to one CMS post`);
      else if (k !== "slug") errors.push(`${k} is a read-only copy of the CMS and cannot be changed here`);
    }
    if (JSON.stringify(b.canonical ?? null) !== JSON.stringify(m.canonical ?? null)) highRisk.push(`canonical changes from ${JSON.stringify(b.canonical ?? null)} to ${JSON.stringify(m.canonical ?? null)}`);
    if (b.noIndex !== true && m.noIndex === true) highRisk.push("noIndex turned on");
  }
  return { errors: [...new Set(errors)], warnings, highRisk, facts };
}

/** Check a set of mirror files together: each file, plus slugs and ids unique across the set. */
export function validateSet(entries, opts = {}) {
  const results = entries.map((e) => ({ file: e.file, ...validateFile(e.parsed, { ...opts, file: e.file, base: e.base || null }) }));
  const seen = new Map();
  for (const [i, e] of entries.entries()) {
    for (const k of ["slug", "id"]) {
      const v = e.parsed.meta[k];
      if (blank(v)) continue;
      const key = `${k}:${v}`;
      if (seen.has(key)) results[i].errors.push(`${k} "${v}" is also used by ${entries[seen.get(key)].file}`);
      else seen.set(key, i);
    }
  }
  return { ok: results.every((r) => !r.errors.length), results };
}

// --------------------------------------------------------------------------------------------- write plans

/** The data object to save as a draft: only the fields the file edits. */
export function draftData(parsed, fields = DEFAULT_FIELDS) {
  return { [fields.title]: parsed.meta.title, [fields.excerpt]: orNull(parsed.meta.excerpt), [fields.body]: fromMarkdown(parsed.body) };
}

/** The SEO object to send at publish (all five keys, so the CMS ends up exactly as the file says). */
export function seoPayload(parsed) {
  const m = parsed.meta;
  return { title: orNull(m.seoTitle), description: orNull(m.seoDescription), image: orNull(m.seoImage), canonical: orNull(m.canonical), noIndex: m.noIndex === true };
}

/**
 * Is it safe to write this file to the CMS? Compares the live item with the file's previous version (base) and looks at
 * any pending CMS draft. Returns { ok, reason, changes } where changes lists what the write will change.
 * live: state of the live item (or null for a new post); base: state of the previous file (or null);
 * pendingDraft: state of an unpublished CMS draft (or null); head: state of this file.
 */
export function writePlan({ live, base, pendingDraft, head }) {
  if (!live) return { ok: true, reason: "new post", changes: diffState(null, head) };
  // A re-run after a publish that already landed (a retried job): the CMS matches the new file, nothing to do.
  if (!diffState(live, head).length) return { ok: true, reason: "the CMS already matches the file", changes: [] };
  if (base) {
    const drift = diffState(live, base);
    if (drift.length) return { ok: false, reason: `the CMS changed outside the mirror (${drift.join(", ")} differ from the previous file); export again before editing`, changes: [] };
  }
  if (pendingDraft) {
    const ours = !diffState(pendingDraft, head, ["title", "excerpt", "body"]).length;
    const same = !diffState(pendingDraft, live, ["title", "excerpt", "body"]).length;
    if (!ours && !same) return { ok: false, reason: "the CMS has an unpublished draft that is not this file's; publish or discard it in the CMS first", changes: [] };
  }
  return { ok: true, reason: base ? "live matches the previous file" : "no previous file given", changes: diffState(live, head) };
}
