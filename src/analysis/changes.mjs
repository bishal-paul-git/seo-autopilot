// Page change monitor: what changed on watched pages (yours and competitors') since the last check: titles, descriptions,
// headings, length, structured data, canonical, indexability and the text itself. Pure: snapshot HTML, diff two snapshots.
// Competitors who rewrite a page that outranks you are telling you what they think searchers want; your own pages changing
// unexpectedly (a CMS or deploy accident) is the other half.
import { extractPage, mainScope, blockText, headingOutline } from "../audit/extract.mjs";
import { sentences, jaccard } from "./text.mjs";

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };

/** The facts worth comparing, small enough to keep a history of. */
export function snapshot(html, url, { status = 200, finalUrl = url, date } = {}) {
  const p = extractPage(html, url), text = blockText(mainScope(html));
  const sents = sentences(text).map((s) => s.toLowerCase());
  return {
    url, date, status, finalUrl, title: p.title || "", description: p.description || "", h1: p.h1s[0] || "", canonical: p.canonical || null,
    noindex: /noindex/i.test(p.robots || ""), headings: headingOutline(html).filter((h) => h.level <= 3).map((h) => `${"#".repeat(h.level)} ${h.text}`),
    words: text ? text.split(/\s+/).length : 0, schema: [...new Set(p.jsonld?.types || [])].sort(), textHash: hash(sents.join("\n")),
    // A sample of sentence fingerprints is enough to say how much of the text changed without storing the text.
    sentences: sents.slice(0, 400).map(hash),
  };
}

/** Field-by-field changes from a to b, most important first. Empty when nothing that matters changed. */
export function diff(a, b) {
  if (!a) return [{ field: "new", note: "first snapshot" }];
  const out = [];
  if (a.status !== b.status) out.push({ field: "status", from: a.status, to: b.status, important: true });
  if (a.noindex !== b.noindex) out.push({ field: "noindex", from: a.noindex, to: b.noindex, important: true });
  if ((a.canonical || "") !== (b.canonical || "")) out.push({ field: "canonical", from: a.canonical, to: b.canonical, important: true });
  if (a.finalUrl !== b.finalUrl) out.push({ field: "redirect", from: a.finalUrl, to: b.finalUrl, important: true });
  for (const f of ["title", "h1", "description"]) if (a[f] !== b[f]) out.push({ field: f, from: a[f], to: b[f], important: f !== "description" });
  const added = b.headings.filter((h) => !a.headings.includes(h)), removed = a.headings.filter((h) => !b.headings.includes(h));
  if (added.length || removed.length) out.push({ field: "headings", added, removed });
  const sa = a.schema.filter((x) => !b.schema.includes(x)), sb = b.schema.filter((x) => !a.schema.includes(x));
  if (sa.length || sb.length) out.push({ field: "schema", added: sb, removed: sa });
  if (a.textHash !== b.textHash) {
    const similarity = jaccard(a.sentences, b.sentences);
    const change = a.words ? (b.words - a.words) / a.words : null;
    if (similarity < 0.95 || Math.abs(change ?? 0) >= 0.05) out.push({ field: "text", words: { from: a.words, to: b.words, change: change == null ? null : Number(change.toFixed(2)) }, rewritten: Number((1 - similarity).toFixed(2)), important: similarity < 0.7 });
  }
  return out;
}

const pct = (x) => `${Math.round(x * 100)}%`;
export function describe(c) {
  switch (c.field) {
    case "new": return "first snapshot (nothing to compare yet)";
    case "headings": return `headings: ${c.added.length ? `added ${c.added.map((h) => `"${h}"`).join(", ")}` : ""}${c.added.length && c.removed.length ? "; " : ""}${c.removed.length ? `removed ${c.removed.map((h) => `"${h}"`).join(", ")}` : ""}`;
    case "schema": return `structured data: ${c.added.length ? `added ${c.added.join(", ")}` : ""}${c.added.length && c.removed.length ? "; " : ""}${c.removed.length ? `removed ${c.removed.join(", ")}` : ""}`;
    case "text": return `text: ${pct(c.rewritten)} of sentences changed, ${c.words.from} to ${c.words.to} words`;
    default: return `${c.field}: "${c.from ?? ""}" to "${c.to ?? ""}"`;
  }
}

export function changesMarkdown({ siteName, results, date }) {
  const changed = results.filter((r) => r.changes.length && r.changes[0].field !== "new");
  const L = [`# ${siteName} page changes, ${date}`, "", `${results.length} watched pages checked; ${changed.length} changed since the last check. Text is compared by sentence fingerprints, so a rewrite shows as a share of sentences changed.`, ""];
  for (const group of [["yours", "Your pages"], ["competitor", "Competitor pages"]]) {
    const g = changed.filter((r) => r.kind === group[0]);
    if (!g.length) continue;
    L.push(`## ${group[1]}`);
    for (const r of g) L.push(`- **${r.url}**${r.changes.some((c) => c.important) ? " (important)" : ""}`, ...r.changes.map((c) => `  - ${describe(c)}`));
    L.push("");
  }
  const failed = results.filter((r) => r.error);
  if (failed.length) L.push("## Could not check", ...failed.map((r) => `- ${r.url}: ${r.error}`));
  if (!changed.length) L.push("Nothing changed that matters.");
  return L.join("\n") + "\n";
}
