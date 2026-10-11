// Gathers everything the dashboards show for one site, from the saved state and the content adapter.
// Shared by the single-file dashboard (`run dashboard`) and the local management app (`seo-autopilot ui`).
import { readFileSync, existsSync, statSync } from "node:fs";
import { readJson, today } from "./util.mjs";
import { loadPages, pipeline } from "../adapters/index.mjs";

const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");

export async function collectSiteData(site) {
  const s = site.paths.state;
  const targets = readJson(`${site.paths.backlinks}/targets.json`, []);
  const bstate = readJson(`${s}/backlinks-state.json`, { targets: {} }).targets;
  const backlinks = targets.map((t) => {
    const r = bstate[t.id] || {};
    return { target_id: t.id, name: t.name, submit_url: t.submitUrl, mode: t.mode, status: r.status || (t.mode === "auto" ? "pending" : t.mode), attempts: r.attempts || 0, note: (r.history?.at(-1)?.reason || t.notes || "").slice(0, 200) };
  });
  const inspectFile = `${s}/inspect-state.json`;
  return {
    site: { id: site.id, name: site.name, url: site.url, property: site.searchConsoleProperty },
    generated: today(),
    lastSynced: existsSync(inspectFile) ? statSync(inspectFile).mtime.toISOString() : null,
    history: readJson(`${s}/history.json`, []),
    inspect: readJson(inspectFile, { results: {} }).results,
    backlog: readJson(`${s}/keyword-backlog.json`, {}),
    backlinks,
    digest: read(`${s}/weekly-digest.md`),
    news: read(`${s}/news-digest.md`),
    requestIndexing: read(`${s}/request-indexing.md`),
    pipeline: pipeline(await loadPages(site), today()),
  };
}
