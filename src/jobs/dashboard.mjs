// Builds a self-contained dashboard (one HTML file, no server, no database, no tracking) from the saved state:
// <state>/<site>/dashboard/index.html. Open it in a browser, or let the workflow attach it to each run as an artifact.
// The page is marked noindex. It lists real queries and URLs, so publish it only somewhere private.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readJson, writeText, today } from "../core/util.mjs";
import { loadPages, pipeline } from "../adapters/index.mjs";

export const description = "Build a single-file HTML dashboard from the saved data (open it in a browser)";

const TEMPLATE = fileURLToPath(new URL("../dashboard/template.html", import.meta.url));

export function renderDashboard(data) {
  const json = JSON.stringify(data).replace(/</g, String.fromCharCode(92) + "u003c").replace(new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]", "g"), " ");
  return readFileSync(TEMPLATE, "utf8").replace("/*__DATA__*/null", json);
}

const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");

export async function run({ site }) {
  const s = site.paths.state;
  const targets = readJson(`${site.paths.backlinks}/targets.json`, []);
  const bstate = readJson(`${s}/backlinks-state.json`, { targets: {} }).targets;
  const backlinks = targets.map((t) => {
    const r = bstate[t.id] || {};
    return { target_id: t.id, name: t.name, submit_url: t.submitUrl, mode: t.mode, status: r.status || (t.mode === "auto" ? "pending" : t.mode), attempts: r.attempts || 0, note: (r.history?.at(-1)?.reason || t.notes || "").slice(0, 200) };
  });
  const data = {
    site: { id: site.id, name: site.name, url: site.url, property: site.searchConsoleProperty },
    generated: today(),
    history: readJson(`${s}/history.json`, []),
    inspect: readJson(`${s}/inspect-state.json`, { results: {} }).results,
    backlog: readJson(`${s}/keyword-backlog.json`, {}),
    backlinks,
    digest: read(`${s}/weekly-digest.md`),
    news: read(`${s}/news-digest.md`),
    pipeline: pipeline(await loadPages(site), today()),
  };
  const out = `${s}/dashboard/index.html`;
  writeText(out, renderDashboard(data));
  console.log(`dashboard: wrote ${out} (${data.history.length} days of history, ${Object.keys(data.inspect).length} inspected pages)`);
}
