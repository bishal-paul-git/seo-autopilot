// Content-loss guard for a pull request (run by seo-check before the build, so the pull request's own code has not run yet).
//   npx seo-autopilot run content-guard --base origin/main [--repo <checkout>] [--branch seo/issue-12] [--files a.md,b.json]
//                                       [--labels a,b] [--events events.jsonl] [--author login] [--revert-of pr.json]
// Compares every changed content page (Markdown/MDX, HTML, JSON page lists) between the merge base and HEAD and fails
// (exit 1) when a page lost more than contentGuard.maxWordDropPercent of its words (default 15), or any heading, internal
// link, image, structured data or page setting (draft, noindex, canonical, permalink...), or when a page or its file was
// removed. New pages get warnings only (empty, no H1, no internal link). Writes <state>/<site>/content-guard.json and .md
// and adds the table to the GitHub job summary.
//
// Every input that decides what is checked (the word limit, the site's address for internal links, the data and state
// folders that are skipped, the unpublish field) is read from the BASE version of seo-autopilot.config.json, so a pull
// request cannot loosen its own check. In the workflow the tool runs from a folder outside the checkout (--repo points at
// it), so no file in the pull request (.npmrc, package.json, node_modules) is read before or while the guard runs.
// File names come from git NUL-separated and unquoted: Arabic and other non-ASCII file names are checked like any other.
//
// Human-only override: the label "allow-content-shrink", added by a person who is not the pull request's author, after
// the latest commit (checked from the pull request's events; a Bot never counts). The autopilot and the agents never add it.
// A seo/revert-<n> pull request passes without the content rules only when (1) seo-watch opened it: authored by the
// workflow's bot and labelled seo-revert by that same bot, and (2) it is exactly what seo-watch would have made: the exact
// inverse of pull request #n's merge (every file it touched back to its version before #n, nothing else), or the adapter's
// unpublish of the pages #n added (the draft field and hold set, nothing else). #n must have been merged from a seo/*
// branch. Anything else on such a branch is checked like any change.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { writeJson, writeText, today } from "../core/util.mjs";
import { CONFIG_NAME, DEFAULTS } from "../core/config.mjs";
import { git, gitNames, gitShow as show, revertBase } from "../lib/git-history.mjs";
import { unpublishSetting, unpublishText } from "../adapters/index.mjs";
import { guardFiles, guardTable, overrideApplied, revertTrusted, GUARD_DEFAULTS, OVERRIDE_LABEL } from "../analysis/content-loss.mjs";

export const description = "Content-loss guard: fail a pull request whose changed pages lose words (>15%), headings, internal links, images, structured data or page settings";

const CONTENT_EXT = /\.(md|mdx|markdown|mdoc|html?|json)$/i;
const NEVER = /(^|\/)(node_modules|\.github|\.git|\.claude|dist|build|\.next|vendor)\//i;
const NOT_CONTENT = /(^|\/)(package(-lock)?\.json|composer\.(json|lock)|tsconfig[^/]*\.json|jsconfig\.json|\.?eslintrc[^/]*|renovate\.json|vercel\.json|netlify\.toml|seo-autopilot\.config\.json|CHANGELOG\.md|LICENSE\.md|CODE_OF_CONDUCT\.md|CONTRIBUTING\.md|SECURITY\.md)$/i;

const list = (v) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
const rel = (p) => String(p || "").split("\\").join("/").replace(/^\.\/+/, "").replace(/\/+$/, "");

/** JSON array or one JSON object per line (gh api --jq '.[]' output). */
function readEvents(file) {
  if (!file || file === true || !existsSync(String(file))) return [];
  const raw = readFileSync(String(file), "utf8").trim();
  if (!raw) return [];
  try { const j = JSON.parse(raw); return Array.isArray(j) ? j : [j]; } catch { /* JSON lines */ }
  return raw.split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const readJsonFile = (file) => { if (!file || file === true || !existsSync(String(file))) return null; try { return JSON.parse(readFileSync(String(file), "utf8")); } catch { return null; } };

/**
 * Every guard input from the base branch's config (never from the pull request). Falls back to the loaded config only
 * when the base branch has none (nothing to protect yet), and says so.
 */
export function baseSettings(root, mb, site, cfg) {
  let raw = null;
  try { raw = JSON.parse(show(root, mb, CONFIG_NAME) || "null"); } catch { /* unreadable: treated as missing */ }
  const s = raw ? (raw.sites || []).find((x) => x?.id === site.id) || (raw.sites || [])[0] || {} : site;
  const n = Number(s.contentGuard?.maxWordDropPercent);
  const dirs = raw ? [raw.stateDir ?? DEFAULTS.stateDir, raw.dataDir ?? DEFAULTS.dataDir] : [cfg?.stateDir, cfg?.dataDir].filter(Boolean).map((d) => relative(cfg?.root || root, d));
  return {
    fromBase: Boolean(raw),
    maxWordDropPercent: Number.isFinite(n) && n >= 0 && n <= 100 ? n : GUARD_DEFAULTS.maxWordDropPercent,
    siteUrl: String(s.url || site.url || ""),
    skipDirs: dirs.map(rel).filter((d) => d && d !== "." && !d.startsWith("..")),
    unpublish: unpublishSetting({ content: s.content }),
  };
}

const idOf = (o) => String(o?.slug ?? o?.id ?? o?.h1 ?? o?.title ?? o?.name ?? "");
const jsonIds = (src) => { try { const j = JSON.parse(src); return Array.isArray(j) ? j.filter((x) => x && typeof x === "object").map(idOf) : []; } catch { return []; } };

/**
 * Is this seo/revert-<n> pull request exactly what seo-watch makes? info: { number, merged, mergeCommit, headRefName,
 * commits: [subject] } for pull request #n, read by the workflow. changed: every file this pull request changes.
 * Returns { ok, reason, notes: Map(file -> note) }.
 */
export function exactRevert(root, mb, info, n, changed, settings) {
  const no = (reason) => ({ ok: false, reason, notes: new Map() });
  if (!info || Number(info.number) !== n) return no(`pull request #${n} (the one being reverted) could not be read`);
  if (!info.merged) return no(`pull request #${n} was never merged`);
  if (!/^seo\//.test(info.headRefName || "") || /^seo\/revert-/.test(info.headRefName || "")) return no(`pull request #${n} came from ${info.headRefName || "an unknown branch"}, not from a seo/* branch`);
  const sha = String(info.mergeCommit || "");
  if (!/^[0-9a-f]{7,40}$/i.test(sha) || git(root, ["merge-base", "--is-ancestor", sha, mb]).status !== 0) return no(`the merge of #${n} (${sha.slice(0, 7) || "unknown"}) is not on the base branch`);
  const { base: from, mode } = revertBase(root, sha, info.commits || []);
  if (!from) return no(`the commit before #${n} could not be found`);
  const merged = new Set(gitNames(root, ["diff", "--name-only", "--no-renames", from, sha]));
  if (!changed.length) return no("the pull request changes nothing");
  // 1. An exact undo: the same files, each back to its version before #n.
  const sameSet = changed.length === merged.size && changed.every((f) => merged.has(f));
  if (sameSet && changed.every((f) => show(root, "HEAD", f) === show(root, from, f))) {
    return { ok: true, reason: `the exact inverse of #${n}'s ${mode === "merge" ? "merge" : mode === "rebase" ? "rebase merge" : "commit"} ${sha.slice(0, 7)}`, notes: new Map(changed.map((f) => [f, `exact undo of #${n} (${sha.slice(0, 7)}): the version before it`])) };
  }
  // 2. The adapter's unpublish of the pages #n added, and nothing else.
  const added = new Set(gitNames(root, ["diff", "--name-only", "--diff-filter=A", from, sha]));
  const notes = new Map();
  for (const f of changed) {
    if (!merged.has(f)) return no(`${f} was not part of #${n}`);
    const now = show(root, mb, f), head = show(root, "HEAD", f);
    if (now == null || head == null) return no(`${f} is missing on one side`);
    const ids = f.endsWith(".json") ? jsonIds(show(root, sha, f) || "").filter((id) => !new Set(jsonIds(show(root, from, f) || "")).has(id)) : added.has(f) ? [f] : [];
    if (!ids.length) return no(`${f} has no page that #${n} added, and it is not the exact undo of #${n}`);
    const want = unpublishText(f, now, ids, settings.unpublish);
    if (!want.applied.length || want.out !== head) return no(`${f} is not exactly the unpublish of the page(s) #${n} added (${settings.unpublish.field}: ${JSON.stringify(settings.unpublish.value)} and hold: true, nothing else)`);
    notes.set(f, `unpublishes the page(s) #${n} added (${settings.unpublish.field}: ${JSON.stringify(settings.unpublish.value)}, hold: true); nothing else changed`);
  }
  return { ok: true, reason: `exactly the unpublish of the page(s) #${n} added`, notes };
}

export async function run({ site, cfg, flags = {} }) {
  const root = flags.repo && flags.repo !== true ? resolve(String(flags.repo)) : site.paths.root;
  const base = String(flags.base || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main"));
  const mbr = git(root, ["merge-base", base, "HEAD"]);
  if (mbr.status !== 0) { console.log(`content-guard: cannot find the merge base of ${base} and HEAD (${(mbr.stderr || "").trim()}). Fetch the base branch (actions/checkout with fetch-depth: 0).`); process.exitCode = 1; return; }
  const mb = mbr.stdout.trim();
  const settings = baseSettings(root, mb, site, cfg);
  const branch = String(flags.branch && flags.branch !== true ? flags.branch : process.env.GITHUB_HEAD_REF || "");

  const changed = gitNames(root, ["diff", "--name-only", "--no-renames", mb, "HEAD"]);
  const skip = (f) => {
    const p = rel(f);
    if (!CONTENT_EXT.test(p) || NEVER.test(p) || NOT_CONTENT.test(p)) return true;
    return settings.skipDirs.some((d) => p === d || p.startsWith(d + "/"));
  };
  const files = (list(flags.files).length ? list(flags.files) : changed).filter((f) => !skip(f));

  const labels = list(flags.labels), events = readEvents(flags.events), author = String(flags.author && flags.author !== true ? flags.author : "");
  const headTime = git(root, ["log", "-1", "--format=%cI", "HEAD"]).stdout.trim();
  const m = branch.match(/^seo\/revert-(\d+)$/);
  let revert = /^seo\/revert-/.test(branch) ? revertTrusted({ branch, author, labels, events }) : null;
  let notes = new Map();
  if (revert?.trusted) {
    const x = exactRevert(root, mb, readJsonFile(flags["revert-of"]), Number(m[1]), changed, settings);
    revert = x.ok ? { trusted: true, reason: `${revert.reason}; ${x.reason}` } : { trusted: false, reason: `${revert.reason}, but ${x.reason}` };
    if (x.ok) notes = x.notes;
  }

  const input = files.map((path) => ({ path, before: show(root, mb, path), after: show(root, "HEAD", path), restores: notes.get(path) || false }));
  const result = guardFiles(input, { siteUrl: settings.siteUrl, maxWordDropPercent: settings.maxWordDropPercent });
  const override = result.failed ? overrideApplied({ labels, events, author, headTime }) : null;
  const table = guardTable(result, { override, maxWordDropPercent: settings.maxWordDropPercent });
  const md = `# Content-loss guard (${today()})\n\nCompared with ${base} (merge base ${mb.slice(0, 7)}); settings from ${settings.fromBase ? "the base branch's config" : "the loaded config (the base branch has none)"}.\n\n${revert ? `${revert.trusted ? "Undo opened by seo-watch" : "Revert branch NOT trusted, so its changes are checked like any change"}: ${revert.reason}.\n\n` : ""}${table}${override && !override.applied && labels.includes(OVERRIDE_LABEL) ? `\nOverride not applied: ${override.reason}.\n` : ""}`;
  const strip = (p) => ({ ...p, before: p.before && { words: p.before.words, headings: p.before.headings.length, links: p.before.links.length, images: p.before.images.length, schema: p.before.schema, controls: p.before.controls }, after: p.after && { words: p.after.words, headings: p.after.headings.length, links: p.after.links.length, images: p.after.images.length, schema: p.after.schema, controls: p.after.controls } });
  writeJson(`${site.paths.state}/content-guard.json`, { generatedAt: new Date().toISOString(), base, mergeBase: mb, branch, revert, settings, headTime, failed: result.failed, checked: result.checked, override, pages: result.pages.map(strip) });
  writeText(`${site.paths.state}/content-guard.md`, md);
  if (process.env.GITHUB_STEP_SUMMARY) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n"); } catch { /* no summary file */ } }
  console.log(md);
  if (result.failed && !override?.applied) process.exitCode = 1;
}
