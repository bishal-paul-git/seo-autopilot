// Playbook metadata (Phase 5, D49): when a playbook was last reviewed, its version and owner, and the sources its
// methods rest on. Format, under the playbook's title:
//   Last reviewed: 2026-11-12 · Version: 2 · Owner: SEO Autopilot maintainers
// and a "## Sources" section of Markdown links with the publisher and the date the link was checked:
//   - [Title](https://example.com/page) (Publisher, checked 2026-11-12): what it supports.
// Claims about AI search are labelled "documented", "observed" or "hypothesis" in the text. Pure functions, no I/O.

export const STALE_DAYS = 90;

/** { reviewed, version, owner, sources: [{ title, url, publisher, checked }] } from a playbook's Markdown. */
export function playbookMeta(text) {
  const t = String(text || "").replace(/\r\n/g, "\n");
  const line = (t.match(/^Last reviewed:\s*(\d{4}-\d{2}-\d{2})(.*)$/m) || []);
  const version = (line[2] || "").match(/Version:\s*([\w.]+)/i)?.[1] || null;
  const owner = (line[2] || "").match(/Owner:\s*([^·\n]+)/i)?.[1]?.trim() || null;
  const sec = (t.match(/\n## Sources[ \t]*\n([\s\S]*?)(\n## |$)/) || [])[1] || "";
  const sources = [...sec.matchAll(/^- \[([^\]]+)\]\((https?:\/\/[^)\s]+)\)(?:\s*\(([^,)]+)(?:,\s*checked\s*(\d{4}-\d{2}-\d{2}))?\))?/gm)]
    .map((m) => ({ title: m[1], url: m[2], publisher: m[3]?.trim() || null, checked: m[4] || null }));
  return { reviewed: line[1] || null, version, owner, sources };
}

/** Whether a playbook needs attention: no review date, older than STALE_DAYS, or no sources. */
export function reviewState(meta, now = new Date().toISOString(), staleDays = STALE_DAYS) {
  if (!meta.reviewed) return { state: "undated", ageDays: null };
  const ageDays = Math.floor((Date.parse(now) - Date.parse(`${meta.reviewed}T00:00:00Z`)) / 864e5);
  if (!meta.sources.length) return { state: "unsourced", ageDays };
  return { state: ageDays > staleDays ? "stale" : "current", ageDays };
}

/** Problems with a playbook that has metadata: malformed source lines, sources never checked, dates in the future. */
export function metaProblems(text, now = new Date().toISOString()) {
  const t = String(text || "").replace(/\r\n/g, "\n"), m = playbookMeta(t), out = [];
  const sec = (t.match(/\n## Sources[ \t]*\n([\s\S]*?)(\n## |$)/) || [])[1];
  if (sec !== undefined) {
    const bullets = sec.split("\n").filter((l) => /^- /.test(l));
    if (bullets.length !== m.sources.length) out.push("a Sources line is not in the form - [Title](https://...) (Publisher, checked YYYY-MM-DD): ...");
    for (const s of m.sources) if (!s.checked) out.push(`source not marked as checked: ${s.url}`);
  }
  if (m.reviewed && Date.parse(`${m.reviewed}T00:00:00Z`) > Date.parse(now)) out.push(`review date ${m.reviewed} is in the future`);
  if (m.sources.length && !m.reviewed) out.push("sources but no Last reviewed line");
  return out;
}
