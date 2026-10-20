// Autopilot policy (decision D17): which changes the system may publish by itself, and which still wait for a person.
// Pure: describe a change (its class, the files it touches, the text it adds) and the site's policy, get a decision back.
//
// Levels:  watch     report only, nobody acts
//          prepare   write the change and open a pull request; a person merges
//          autopilot merge and publish once every automated check passes
//          undo      as autopilot, then watch the live result and revert on regression
// Some classes can never be raised above "prepare" (HUMAN_ONLY): one mistake there costs rankings, money or trust.

import { topicList } from "./ymyl.mjs";

export const LEVELS = ["watch", "prepare", "autopilot", "undo"];

/** Default level per kind of change. Sites override in "autopilot": { "levels": { ... } }. */
export const DEFAULT_LEVELS = {
  "technical-fix": "undo",     // broken links, redirects, alt text, schema fixes
  snippet: "undo",             // titles, descriptions, headings
  "internal-links": "undo",
  refresh: "autopilot",        // updating an existing page
  "new-page": "autopilot",     // within the pace limits below
  template: "autopilot",       // speed and template fixes, after the build passes
  sensitive: "prepare",        // health, money, legal, safety, children
  "site-wide-indexing": "prepare", // robots.txt, site-wide noindex, sitemaps
  migration: "prepare",
  delete: "prepare",
  outreach: "prepare",         // drafts only; sending is never automatic
  infrastructure: "prepare",   // workflows, dependencies, the autopilot's own config and agents
};
export const HUMAN_ONLY = new Set(["sensitive", "site-wide-indexing", "migration", "delete", "outreach", "infrastructure"]);
export const DEFAULT_LIMITS = { newPagesPerWeek: 3, changesPerDay: 10 };

const rank = (l) => LEVELS.indexOf(l);
const LABEL_CLASS = { "seo-topic": "new-page", "seo-refresh": "refresh", "seo-snippet": "snippet", "seo-links": "internal-links", "seo-fix": "technical-fix", "seo-template": "template", "seo-outreach": "outreach", "seo-migration": "migration", "seo-delete": "delete" };
const INFRA_FILES = /^(\.github\/|seo-autopilot\/|\.claude\/)|(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|seo-autopilot\.config\.json|\.env[^/]*)$/i;
const INDEXING_FILES = /(^|\/)(robots\.txt|_headers|sitemap[^/]*\.xml|\.htaccess|_redirects|vercel\.json|netlify\.toml)$/i;

/** The effective policy: defaults, the site's overrides (invalid or forbidden ones ignored), limits and the pause switch. */
export function resolvePolicy(autopilot = {}) {
  const levels = { ...DEFAULT_LEVELS }, ignored = [];
  for (const [k, v] of Object.entries(autopilot.levels || {})) {
    if (!(k in DEFAULT_LEVELS) || !LEVELS.includes(v)) { ignored.push(`${k}: ${v}`); continue; }
    if (HUMAN_ONLY.has(k) && rank(v) > rank("prepare")) { ignored.push(`${k}: ${v} (always needs a person)`); continue; }
    levels[k] = v;
  }
  return { enabled: autopilot.enabled !== false, paused: Boolean(autopilot.paused), levels, limits: { ...DEFAULT_LIMITS, ...(autopilot.limits || {}) }, ignored };
}

const globRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$");

/**
 * What kind of change is this? Strictest reading wins: a class label says what was intended, the files say what it touches.
 * files: changed paths; addedFiles: the new ones. labels: issue or pull-request labels. contentGlobs: where pages live.
 * addedText: the lines it adds.
 */
export function classifyChange({ files = [], addedFiles = [], labels = [], contentGlobs = [], addedText = "", review = {} } = {}) {
  const reasons = [];
  let cls = labels.map((l) => LABEL_CLASS[l]).find(Boolean) || null;
  if (cls) reasons.push(`label: ${cls}`);
  if (files.some((f) => INDEXING_FILES.test(f))) { cls = "site-wide-indexing"; reasons.push("touches robots, sitemap, headers or redirect rules"); }
  if (files.some((f) => INFRA_FILES.test(f))) { cls = "infrastructure"; reasons.push("touches workflows, dependencies or the autopilot's own config"); }
  const content = contentGlobs.map(globRe);
  const outside = files.filter((f) => !content.some((r) => r.test(f)));
  if (outside.length && !HUMAN_ONLY.has(cls)) { cls = "template"; reasons.push(`outside content folders: ${outside.slice(0, 3).join(", ")}`); }
  // A new content file is a new page whatever its label says (labels come from the drafting agent's pull request too).
  if (!HUMAN_ONLY.has(cls) && cls !== "template" && addedFiles.some((f) => content.some((r) => r.test(f)))) { if (cls !== "new-page") reasons.push("adds a page file: treated as a new page"); cls = "new-page"; }
  if (!cls) { cls = "refresh"; reasons.push("content files, no class label: treated as a refresh"); }
  const hits = addedText ? topicList(review).filter(({ res }) => res.some(([, r]) => r.test(addedText))).map((t) => t.topic) : [];
  if (hits.length && !HUMAN_ONLY.has(cls)) { reasons.push(`sensitive topics in the added text: ${hits.join(", ")}`); cls = "sensitive"; }
  return { cls, reasons, sensitiveTopics: hits };
}

/**
 * May the system merge and publish this change by itself? counts: { today, newPagesThisWeek } already published.
 * Returns { merge, level, cls, reasons }. merge is true only at "autopilot" or "undo", not paused, within limits.
 */
export function decide(change, policy, counts = {}) {
  const level = policy.levels[change.cls] || "prepare";
  const reasons = [...(change.reasons || [])];
  const no = (why) => ({ merge: false, level, cls: change.cls, watch: level === "undo", reasons: [...reasons, why] });
  if (!policy.enabled) return no("autopilot is switched off in the config");
  if (policy.paused) return no("autopilot is paused (kill switch)");
  if (rank(level) < rank("autopilot")) return no(`${change.cls} changes are set to "${level}": a person merges`);
  if ((counts.today ?? 0) >= policy.limits.changesPerDay) return no(`daily limit reached (${policy.limits.changesPerDay} changes)`);
  if (change.cls === "new-page" && (counts.newPagesThisWeek ?? 0) >= policy.limits.newPagesPerWeek) return no(`weekly new-page limit reached (${policy.limits.newPagesPerWeek}): publishing many new pages at once looks like scaled content`);
  return { merge: true, level, cls: change.cls, watch: level === "undo", reasons: [...reasons, `allowed at "${level}"`] };
}
