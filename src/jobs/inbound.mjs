// Inbound links audit from an export you download (no API key needed):
//   Search Console > Links > "Export external links" (latest links, top linking sites or top linked pages), or a CSV from a
//   backlink tool. Put the files in <dataDir>/inbound-links/ (or "inbound": { "dir": "..." }), or pass --file a.csv,b.csv.
//   npx seo-autopilot run inbound [--file export.csv]
// Writes <state>/<site>/inbound.json and inbound.md, and keeps inbound-snapshot.json to report new and lost linking sites.
// Matches the links to your latest crawl (audit.json): links into pages that now error are the easiest wins to reclaim.
// It never contacts anyone and never writes a disavow file.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { readExport, analyseInbound } from "../analysis/inbound.mjs";

export const description = "Inbound links audit from a Search Console or backlink-tool export: links to reclaim, new and lost linking sites, patterns to review";

export async function run({ site, flags = {} }) {
  const s = site.paths.state;
  const dir = resolve(site.paths.root, site.inbound?.dir ?? join(site.paths.data, "inbound-links"));
  const files = typeof flags.file === "string" ? flags.file.split(",").map((f) => resolve(site.paths.root, f.trim()))
    : existsSync(dir) ? readdirSync(dir).filter((f) => /\.(csv|tsv|txt)$/i.test(f)).sort().map((f) => join(dir, f)) : [];
  if (!files.length) {
    console.log(`No inbound-links export found. In Search Console open Links, choose "Export external links", and save the CSV files in ${dir} (or pass --file).`);
    return;
  }
  const siteHost = new URL(site.url).hostname.replace(/^www\./, "").toLowerCase();
  const exports = files.map((f) => ({ file: f, ...readExport(readFileSync(f, "utf8"), siteHost) }));
  const unknown = exports.filter((e) => e.kind === "unknown");
  const audit = readJson(`${s}/audit.json`, null);
  const previous = readJson(`${s}/inbound-snapshot.json`, null);
  const r = analyseInbound(exports, { siteHost, pages: audit?.pages || [], previous });
  const report = { generatedAt: new Date().toISOString(), files: exports.map((e) => ({ file: e.file.replace(site.paths.root, "."), kind: e.kind, rows: e.rows.length })), auditGeneratedAt: audit?.generatedAt || null, ...r };
  writeJson(`${s}/inbound.json`, report);
  writeJson(`${s}/inbound-snapshot.json`, { date: today(), domains: r.domains });

  const list = (xs, f, none) => (xs.length ? xs.map(f).join("\n") : `- ${none}`);
  const md = `# Inbound links (${today()})

From ${exports.length} export file(s): ${r.totals.links} linking page(s) from ${r.totals.domains} site(s), pointing at ${r.totals.targets} of your page(s). An export is a sample of what the tool knows, not every link on the web.${unknown.length ? `\n\nNot recognised (no linking-page, site or target column): ${unknown.map((e) => e.file).join(", ")}.` : ""}${audit ? "" : "\n\nNo audit.json yet, so links could not be matched to your pages' status. Run `seo-autopilot run audit` first."}

## Links to reclaim (they point at pages that now error)
${list(r.reclaim, (x) => `- ${x.target} answers ${x.status}, with ${x.links} inbound link(s), e.g. ${x.sources.join(", ") || "(sources not in this export)"}. Redirect it to the closest live page (seo-redirect-guardian), or ask the linker to update the link.`, "None found.")}

## Links through a redirect
${list(r.redirected, (x) => `- ${x.target}${x.to ? ` -> ${x.to}` : ""}: ${x.links} link(s). Working; for the most valuable ones, the linker could point at the final URL.`, "None found.")}

## Linking sites
${list(r.topDomains, (x) => `- ${x.domain}: ${x.links}`, "None.")}${previous ? `\n\nNew since ${previous.date}: ${r.newDomains.slice(0, 20).join(", ") || "none"}.\nNot in this export (lost, or just not sampled): ${r.lostDomains.slice(0, 20).join(", ") || "none"}.` : ""}

## For a person to review
${list(r.review, (x) => `- ${x.note}`, "Nothing unusual.")}

Most sites never need to disavow links: Google mostly ignores links it judges spammy. Consider it only with a manual action for unnatural links, or clear evidence of links you arranged or bought. Ask the seo-backlink-auditor agent before acting.
`;
  writeText(`${s}/inbound.md`, md);
  console.log(md);
}
