// seo-autopilot cms <export|validate|draft|publish|preview-check|schema>: keep CMS posts as Markdown files in git.
//
//   export          read every published post, write <dir>/<slug>.md (only posts that convert back unchanged)
//   validate        check mirror files (and, with --base-ref, what a pull request changed); no network
//   draft           save one file as a CMS draft (live page unchanged) and ask for a preview link
//   publish         save one file as a draft, publish it, then set its SEO fields; also used to revert (publish the old file)
//   preview-check   create one throwaway draft and prove it is invisible to the public and has a preview link
//   schema          can the token read the collection settings; are revisions and SEO on
//
// Connection: EMDASH_URL (or --url) and EMDASH_TOKEN (environment only, never a flag). Writes refuse to run on a live
// post unless the collection is known to keep drafts apart from the live post (see writeGuard below).
// Output: a JSON report on stdout. Exit codes: 0 ok, 1 error or invalid files, 2 published but the CMS does not match
// the file afterwards, 3 refused for safety (conflict, unknown revisions setting, slug taken).

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createClient, revisionsSupported, EmDashError } from "./emdash.mjs";
import { parseMirror, stringifyMirror, itemToMirror, stateOfItem, stateOfFile, diffState, validateFile, validateSet, draftData, seoPayload, writePlan, DEFAULT_FIELDS, LATIN_SLUG } from "./mirror.mjs";
import { fromMarkdown, countWords } from "./portable-text.mjs";
import { mainScope, visibleText } from "../audit/extract.mjs";

class Refused extends Error { constructor(msg) { super(msg); this.exit = 3; } }

function options(flags) {
  const collection = String(flags.collection || "posts");
  const fields = { ...DEFAULT_FIELDS };
  for (const pair of String(flags.fields || "").split(",").filter(Boolean)) { const [k, v] = pair.split("="); if (k && v) fields[k.trim()] = v.trim(); }
  return {
    collection, fields,
    urlPattern: String(flags["url-pattern"] || `/${collection}/{slug}`),
    taxonomies: String(flags.taxonomies ?? "category,tag").split(",").map((s) => s.trim()).filter(Boolean),
    slugPattern: flags["slug-pattern"] ? new RegExp(String(flags["slug-pattern"])) : LATIN_SLUG,
    revisionsProven: flags["revisions-proven"] === true || flags["revisions-proven"] === "true" || process.env.EMDASH_REVISIONS_PROVEN === "true",
  };
}

function client(flags, fetchImpl) {
  return createClient({ url: flags.url || process.env.EMDASH_URL, token: process.env.EMDASH_TOKEN, fetch: fetchImpl });
}

const out = (report) => { console.log(JSON.stringify(report, null, 2)); return report; };
const pageUrl = (base, pattern, slug) => base + pattern.replace("{slug}", encodeURIComponent(slug));

/** The previous version of a file from git (a ref such as origin/main or a merge commit's first parent), or null. */
export function gitVersion(file, ref) {
  try { return execFileSync("git", ["show", `${ref}:./${basename(file)}`], { cwd: dirname(resolve(file)), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
}

function baseOf(file, flags) {
  if (flags.base) return existsSync(String(flags.base)) ? parseMirror(readFileSync(String(flags.base), "utf8")) : null;
  if (flags["base-ref"]) { const t = gitVersion(file, String(flags["base-ref"])); return t == null ? null : parseMirror(t); }
  return null;
}

// ------------------------------------------------------------------------------------------------ export

export async function exportCmd(flags, { fetch: f = globalThis.fetch } = {}) {
  const o = options(flags);
  const dir = String(flags.dir || "");
  if (!dir) throw new Error("--dir is required (the mirror folder)");
  const api = client(flags, f);
  const status = flags.status === "all" ? undefined : String(flags.status || "published");
  const listed = await api.list(o.collection, { status });
  const report = { collection: o.collection, status: status || "all", listed: listed.length, written: [], skipped: [], opaque: [], pendingDrafts: [], noPublishedAt: [], noSlug: [], seoEnabled: null, liveRevision: 0, taxonomies: {} };
  if (!flags.dry) mkdirSync(dir, { recursive: true });
  for (const row of listed) {
    if (!row.slug) { report.noSlug.push(row.id); continue; }
    const got = await api.get(o.collection, row.id);
    const item = got?.item || row;
    const terms = {};
    for (const t of o.taxonomies) {
      try { terms[t] = (await api.terms(o.collection, item.id, t)).map((x) => x.slug); report.taxonomies[t] = "ok"; }
      catch (e) { report.taxonomies[t] = e.code || "error"; terms[t] = []; }
    }
    const m = itemToMirror(item, { fields: o.fields, categories: terms.category || [], tags: terms.tag || [], rev: got?._rev ?? null });
    if (report.seoEnabled == null) report.seoEnabled = "seo" in item;
    if (item.liveRevisionId) report.liveRevision++;
    if (!item.publishedAt) report.noPublishedAt.push(item.slug);
    if (item.draftRevisionId && item.draftRevisionId !== item.liveRevisionId) report.pendingDrafts.push(item.slug);
    if (!m.roundTrip.ok) { report.skipped.push({ slug: item.slug, reason: "does not convert back unchanged", blocks: m.roundTrip.differences }); continue; }
    if (m.roundTrip.opaque) report.opaque.push({ slug: item.slug, blocks: m.roundTrip.opaque, why: [...new Set(m.roundTrip.problems.map((p) => p.reason))] });
    if (!flags.dry) writeFileSync(join(dir, `${item.slug}.md`), m.text);
    report.written.push(item.slug);
  }
  // Files for posts the CMS no longer lists are reported, never deleted.
  if (existsSync(dir)) {
    const have = new Set(listed.map((x) => x.slug));
    report.notInCms = readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3)).filter((s) => !have.has(s));
  }
  if (flags.sitemap) {
    const xml = await (await f(new URL(String(flags.sitemap), api.base).toString())).text();
    const prefix = api.base + o.urlPattern.split("{slug}")[0];
    const inMap = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1].replace(/&amp;/g, "&")).filter((u) => u.startsWith(prefix)).map((u) => decodeURIComponent(u.slice(prefix.length).replace(/\/$/, "")));
    const listedSlugs = new Set(listed.map((x) => x.slug));
    report.sitemap = { posts: inMap.length, notListedByCms: inMap.filter((s) => !listedSlugs.has(s)), listedNotInSitemap: [...listedSlugs].filter((s) => !inMap.includes(s)) };
  }
  report.calls = api.calls.length;
  out(report);
  return report.skipped.length ? 1 : 0;
}

// ------------------------------------------------------------------------------------------------ validate

export function validateCmd(flags) {
  const dir = flags.dir ? String(flags.dir) : null;
  let files = flags.files ? String(flags.files).split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (!files.length && dir) files = readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => join(dir, n));
  if (!files.length) throw new Error("give --dir <mirror folder> or --files a.md,b.md");
  const o = options(flags);
  const entries = files.filter((file) => existsSync(file)).map((file) => ({ file, parsed: parseMirror(readFileSync(file, "utf8")), base: baseOf(file, flags) }));
  // Slugs and ids must be unique across the whole folder, not only the changed files.
  const others = dir ? readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => join(dir, n)).filter((p) => !files.some((x) => resolve(x) === resolve(p))) : [];
  const all = [...entries, ...others.map((file) => ({ file, parsed: parseMirror(readFileSync(file, "utf8")), skip: true }))];
  const v = validateSet(all, { slugPattern: o.slugPattern });
  const results = v.results.filter((_, i) => !all[i].skip).map((r, i) => ({ ...r, before: entries[i].base ? { words: validateFile(entries[i].base).facts.words } : null }));
  const report = { ok: results.every((r) => !r.errors.length), files: results.length, results };
  out(report);
  return report.ok ? 0 : 1;
}

// ------------------------------------------------------------------------------------------------ draft and publish

// A PUT with data on a collection without revisions overwrites the live post, so a write needs proof first: the
// schema says so (schema:read scope), or the operator ran preview-check and set --revisions-proven.
async function writeGuard(api, o, liveItem) {
  if (!liveItem || liveItem.status !== "published") return "not live";
  const r = await revisionsSupported(api, o.collection);
  if (r === true) return "schema";
  if (r === false) throw new Refused(`collection "${o.collection}" does not keep revisions: a draft save would change the live post`);
  if (o.revisionsProven) return "proven by preview-check";
  throw new Refused(`cannot read collection settings with this token; run "cms preview-check" and pass --revisions-proven (or EMDASH_REVISIONS_PROVEN=true) once it shows revisions: true`);
}

async function loadTarget(api, o, parsed) {
  const m = parsed.meta;
  if (m.id) {
    const got = await api.get(o.collection, m.id);
    if (!got) throw new Refused(`post ${m.id} (${m.slug}) is not in the CMS any more`);
    return got;
  }
  // A new post: reuse an unpublished draft with this slug (a re-run of the check), never a live post.
  const got = await api.get(o.collection, m.slug);
  if (got && got.item.status !== "draft") throw new Refused(`slug "${m.slug}" is already used by a ${got.item.status} post`);
  return got;
}

async function pendingDraftState(api, o, item) {
  if (!item.draftRevisionId || item.draftRevisionId === item.liveRevisionId) return null;
  const cmp = await api.compare(o.collection, item.id);
  return cmp?.draft ? stateOfItem(item, o.fields, cmp.draft) : null;
}

async function saveDraft(api, o, parsed, report) {
  const head = stateOfFile(parsed);
  let got = await loadTarget(api, o, parsed);
  if (!got) {
    const created = await api.createDraft(o.collection, { slug: parsed.meta.slug, data: draftData(parsed, o.fields) });
    report.created = created.item.id;
    report.draftSaved = true;
    return { item: created.item, head, changes: diffState(null, head) };
  }
  const item = got.item;
  const live = stateOfItem(item, o.fields);
  const base = report.base ? stateOfFile(report.base) : null;
  const pending = await pendingDraftState(api, o, item);
  const plan = writePlan({ live, base, pendingDraft: pending, head });
  report.plan = { ok: plan.ok, reason: plan.reason, changes: plan.changes };
  if (!plan.ok) throw new Refused(plan.reason);
  const content = plan.changes.filter((c) => ["title", "excerpt", "body"].includes(c));
  const alreadyDrafted = pending && !diffState(pending, head, ["title", "excerpt", "body"]).length;
  if (!content.length || alreadyDrafted) { report.draftSaved = false; report.draftReason = alreadyDrafted ? "the CMS draft already matches the file" : "no content change"; return { item, head, changes: plan.changes }; }
  report.guard = await writeGuard(api, o, item);
  if (report.dry) { report.draftSaved = false; return { item, head, changes: plan.changes }; }
  await api.saveDraft(o.collection, item.id, { data: draftData(parsed, o.fields), _rev: got._rev });
  // The live post must not have moved; the draft must exist.
  const after = (await api.get(o.collection, item.id)).item;
  if (item.status === "published") {
    const moved = diffState(live, stateOfItem(after, o.fields), ["slug", "title", "excerpt", "body"]);
    if (moved.length) { const e = new Error(`DANGER: saving a draft changed the live post (${moved.join(", ")}); restore it from the previous mirror file`); e.exit = 2; throw e; }
    if (!after.draftRevisionId) { const e = new Error("the draft save left no draft revision"); e.exit = 2; throw e; }
  }
  report.draftSaved = true;
  return { item: after, head, changes: plan.changes };
}

function readFile(flags) {
  const file = String(flags.file || "");
  if (!file || !existsSync(file)) throw new Error("--file <mirror file> is required");
  const parsed = parseMirror(readFileSync(file, "utf8"));
  return { file, parsed };
}

function checkFile(file, parsed, base, o) {
  const v = validateFile(parsed, { file, base, slugPattern: o.slugPattern });
  if (v.errors.length) { const e = new Error(`invalid mirror file: ${v.errors.join("; ")}`); e.report = v; throw e; }
  return v;
}

export async function draftCmd(flags, { fetch: f = globalThis.fetch } = {}) {
  const o = options(flags);
  const { file, parsed } = readFile(flags);
  const base = baseOf(file, flags);
  const v = checkFile(file, parsed, base, o);
  const api = client(flags, f);
  const report = { action: "draft", file, slug: parsed.meta.slug, dry: !!flags.dry, base, highRisk: v.highRisk, warnings: v.warnings };
  const { item } = await saveDraft(api, o, parsed, report);
  delete report.base;
  report.id = item.id;
  report.liveUrl = item.status === "published" ? pageUrl(api.base, o.urlPattern, item.slug) : null;
  if (!flags.dry && flags.preview !== "false") {
    try {
      const p = await api.previewUrl(o.collection, item.slug || item.id, { pathPattern: o.urlPattern.replace("{slug}", "{id}"), expiresIn: String(flags["preview-expires"] || "1d") });
      report.previewUrl = new URL(p.url, api.base).toString();
      report.previewExpiresAt = p.expiresAt;
    } catch (e) { report.previewUrl = null; report.previewError = e.code || e.message; }
  }
  report.calls = api.calls;
  out(report);
  return 0;
}

export async function publishCmd(flags, { fetch: f = globalThis.fetch } = {}) {
  const o = options(flags);
  const { file, parsed } = readFile(flags);
  const base = baseOf(file, flags);
  const v = checkFile(file, parsed, base, o);
  const api = client(flags, f);
  const report = { action: "publish", file, slug: parsed.meta.slug, dry: !!flags.dry, base, highRisk: v.highRisk, warnings: v.warnings };
  const { item, head, changes } = await saveDraft(api, o, parsed, report);
  delete report.base;
  report.id = item.id;
  report.changes = changes;
  if (flags.dry) { report.calls = api.calls; out(report); return 0; }
  if (!changes.length && item.status === "published") { report.published = false; report.reason = "the CMS already matches the file"; }
  else {
    const needsPublish = item.status !== "published" || report.draftSaved || (item.draftRevisionId && item.draftRevisionId !== item.liveRevisionId);
    if (needsPublish) { await api.publish(o.collection, item.id); report.published = true; }
    if (head.seo && "seo" in item) {
      const now = await api.get(o.collection, item.id);
      if (JSON.stringify(stateOfItem(now.item, o.fields).seo) !== JSON.stringify(head.seo)) {
        await api.setSeo(o.collection, item.id, { seo: seoPayload(parsed), _rev: now._rev });
        report.seoSet = true;
      }
    }
  }
  const final = await api.get(o.collection, item.id);
  const left = diffState(stateOfItem(final.item, o.fields), head, head.seo && "seo" in final.item ? undefined : ["slug", "title", "excerpt", "body"]);
  report.verified = left.length === 0;
  if (left.length) report.mismatch = left;
  report.status = final.item.status;
  report.liveUrl = pageUrl(api.base, o.urlPattern, final.item.slug);
  if (flags["write-back"] && report.verified) {
    const meta = { ...parsed.meta, id: final.item.id, status: final.item.status, publishedAt: final.item.publishedAt ?? null, baseRev: final._rev ?? null };
    writeFileSync(file, stringifyMirror(meta, parsed.body));
    report.wroteBack = ["id", "status", "publishedAt", "baseRev"];
  }
  report.calls = api.calls;
  out(report);
  return report.verified ? 0 : 2;
}

// ------------------------------------------------------------------------------------------------ preview-check

async function pageFacts(f, url) {
  try {
    const res = await f(url, { headers: { "user-agent": "seo-autopilot-cms-mirror" }, redirect: "manual" });
    const html = await res.text();
    return { status: res.status, words: countWords(visibleText(mainScope(html))) };
  } catch (e) { return { status: 0, error: e.message }; }
}

export async function previewCheckCmd(flags, { fetch: f = globalThis.fetch } = {}) {
  const o = options(flags);
  const title = String(flags.title || "");
  const slug = String(flags.slug || "");
  if (!title || !slug) throw new Error("--title and --slug are required (the throwaway draft)");
  if (!o.slugPattern.test(slug)) throw new Error(`--slug must match ${o.slugPattern}`);
  const api = client(flags, f);
  const report = { action: "preview-check", slug, checks: {} };
  const n = Number(flags.check ?? 3);

  // 1. What the token can see about the collection.
  report.schema = await revisionsSupported(api, o.collection);
  const published = await api.list(o.collection, { status: "published", all: false, limit: Math.max(n, 1) });
  report.seoEnabled = published.length ? "seo" in published[0] : null;

  // 2. Existing pages before.
  const sample = published.filter((p) => p.slug !== slug).slice(0, n).map((p) => pageUrl(api.base, o.urlPattern, p.slug));
  const before = {};
  for (const u of sample) before[u] = await pageFacts(f, u);

  // 3. The throwaway draft: reuse it on a re-run, never touch a live post.
  let got = await api.get(o.collection, slug);
  if (got && got.item.status !== "draft") throw new Refused(`slug "${slug}" belongs to a ${got.item.status} post; pick another throwaway slug`);
  const body = String(flags.body || `${title}. This draft checks that drafts stay private and that preview links work. It must never be published.`);
  const data = { [o.fields.title]: title, [o.fields.body]: fromMarkdown(body) };
  if (!got) { const c = await api.createDraft(o.collection, { slug, data }); got = await api.get(o.collection, c.item.id); report.created = true; }
  else report.created = false;
  const id = got.item.id;
  report.id = id;

  // 4. Revisions probe on the draft only: a data save must create a draft revision and leave the row's data alone.
  const beforeRow = stateOfItem(got.item, o.fields);
  await api.saveDraft(o.collection, id, { data: { ...data, [o.fields.body]: fromMarkdown(body + " (revision probe)") }, _rev: got._rev });
  const probed = (await api.get(o.collection, id)).item;
  report.revisionsProbe = { draftRevisionCreated: !!probed.draftRevisionId, rowDataUnchanged: diffState(beforeRow, stateOfItem(probed, o.fields), ["title", "body"]).length === 0 };
  report.revisions = report.revisionsProbe.draftRevisionCreated && report.revisionsProbe.rowDataUnchanged;
  report.checks.statusStillDraft = probed.status === "draft";

  // 5. Preview link.
  try {
    const p = await api.previewUrl(o.collection, slug, { pathPattern: o.urlPattern.replace("{slug}", "{id}"), expiresIn: "1h" });
    const purl = new URL(p.url, api.base).toString();
    const r = await f(purl, { headers: { "user-agent": "seo-autopilot-cms-mirror" } });
    const html = await r.text();
    report.preview = { ok: r.status === 200 && html.includes(title), status: r.status, showsTitle: html.includes(title), showsProbe: html.includes("revision probe") };
  } catch (e) { report.preview = { ok: false, error: e.code || e.message }; }

  // 6. The public cannot see it.
  const publicUrl = pageUrl(api.base, o.urlPattern, slug);
  const pub = await pageFacts(f, publicUrl);
  report.checks.publicUrlHidden = pub.status === 404 || pub.status === 410;
  report.publicStatus = pub.status;
  for (const [name, path] of [["sitemap", flags.sitemap || "/sitemap.xml"], ["rss", flags.rss || "/rss.xml"]]) {
    if (path === "false") continue;
    try {
      const r = await f(new URL(String(path), api.base).toString(), { headers: { "user-agent": "seo-autopilot-cms-mirror" } });
      const xml = await r.text();
      report.checks[`notIn_${name}`] = r.ok && !xml.includes(slug) && !xml.includes(encodeURIComponent(slug));
    } catch { report.checks[`notIn_${name}`] = false; }
  }

  // 7. Existing pages after: same status and word count.
  report.existingPages = [];
  for (const u of sample) {
    const a = await pageFacts(f, u);
    report.existingPages.push({ url: u, before: before[u], after: a, unchanged: a.status === before[u].status && a.words === before[u].words });
  }
  report.checks.existingPagesUnchanged = report.existingPages.every((p) => p.unchanged);
  report.ok = Object.values(report.checks).every(Boolean);
  report.calls = api.calls;
  out(report);
  return report.ok ? 0 : 1;
}

export async function schemaCmd(flags, { fetch: f = globalThis.fetch } = {}) {
  const o = options(flags);
  const api = client(flags, f);
  const report = { collection: o.collection };
  try { const s = await api.schema(o.collection); const col = s?.item || s?.collection || s; report.schemaReadable = true; report.supports = col?.supports ?? null; }
  catch (e) { report.schemaReadable = false; report.schemaError = `${e.status || ""} ${e.code || e.message}`.trim(); }
  const one = await api.list(o.collection, { status: "published", all: false, limit: 1 });
  report.seoEnabled = one.length ? "seo" in one[0] : null;
  report.revisions = report.supports ? report.supports.includes("revisions") : null;
  report.calls = api.calls;
  out(report);
  return 0;
}

export async function cms({ flags = {}, positional = [] } = {}, deps = {}) {
  const sub = positional[0];
  const run = { export: exportCmd, validate: validateCmd, draft: draftCmd, publish: publishCmd, "preview-check": previewCheckCmd, schema: schemaCmd }[sub];
  if (!run) throw new Error("usage: cms export|validate|draft|publish|preview-check|schema (see docs/cms-mirror.md)");
  try { return await run(flags, deps); }
  catch (e) {
    if (e instanceof Refused || e.exit) { out({ action: sub, refused: e instanceof Refused, error: e.message }); return e.exit || 3; }
    if (e.report) { out({ action: sub, error: e.message, ...e.report }); return 1; }
    if (e instanceof EmDashError) { out({ action: sub, error: e.message, status: e.status, code: e.code }); return 1; }
    throw e;
  }
}
