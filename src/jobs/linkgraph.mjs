// Internal link graph: internal PageRank, click depth, orphans, weight leaked to redirects, errors and noindex pages, and the
// pages that earn search demand but receive little internal weight (with strong, related pages to link from).
// Reads the saved audit (audit.json) and Search Console rows (gsc-rows.json); fetches nothing.
//   npx seo-autopilot run linkgraph
// Writes linkgraph.json and linkgraph.md in the state folder.
import { readJson, writeJson, writeText } from "../core/util.mjs";
import { analyseGraph, graphMarkdown } from "../analysis/linkgraph.mjs";

export const description = "Internal link graph: internal PageRank, click depth, orphans, leaked links, and under-linked pages with search demand";

export async function run({ site }) {
  const s = site.paths.state;
  const audit = readJson(`${s}/audit.json`, null);
  if (!audit?.pages?.length) { console.log("linkgraph: no audit.json yet (run the audit job first). Skipped."); return; }
  const r = analyseGraph(audit.pages, { home: site.url, rows: readJson(`${s}/gsc-rows.json`, { rows: [] }).rows || [] });
  writeJson(`${s}/linkgraph.json`, { generatedAt: new Date().toISOString(), auditedAt: audit.generatedAt, ...r });
  const md = graphMarkdown(r, { siteName: site.name, site: site.url });
  writeText(`${s}/linkgraph.md`, md);
  console.log(md);
}
