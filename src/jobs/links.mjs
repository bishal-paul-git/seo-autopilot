// Internal links to add, for the pages with the fewest inbound links first: a reviewable list, never an edit. Reads the
// saved audit (audit.json: the link graph and the audit's own mention opportunities); fetches nothing.
// Writes <state>/<site>/links.json and links.md.   npx seo-autopilot run links [--max-inbound 2]
// Based on the idea of related-guides blocks (pages link back to the guides that are about them).
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { relatedLinks } from "../audit/links.mjs";

export const description = "Internal links to add for weakly linked pages: mentions, missing link-backs and same-section siblings";

export async function run({ site, flags }) {
  const audit = readJson(`${site.paths.state}/audit.json`, null);
  if (!audit) { console.log("links: no audit.json yet (run the audit job first). Skipped."); return; }
  if (!(audit.pages || []).some((p) => Array.isArray(p.links))) { console.log("links: this audit.json has no link graph (re-run the audit job with this version). Skipped."); return; }
  const maxInbound = Number(flags["max-inbound"] ?? 2);
  const items = relatedLinks(audit.pages, audit.opportunities || [], { maxInbound });
  writeJson(`${site.paths.state}/links.json`, { generatedAt: new Date().toISOString(), auditGeneratedAt: audit.generatedAt, maxInbound, items });
  const p = (u) => u.replace(site.url, "/");
  const weak = new Set(items.map((i) => i.to)).size;
  const md = `# ${site.name} internal links to add ${today()}

${weak} page(s) with ${maxInbound} or fewer internal links pointing at them have suggestions below, weakest first. Each line is a link to consider adding, not a change that was made: add it only where it helps a reader, with words that describe the target.

${items.map((i) => `- On ${p(i.from)}, link to ${p(i.to)} (${i.inbound} inbound) as "${i.anchor}". Why: ${i.reason}, ${i.evidence}`).join("\n") || "- No suggestions: every weakly linked page either has no related page or is already linked from them."}
`;
  writeText(`${site.paths.state}/links.md`, md);
  console.log(md);
}
