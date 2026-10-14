// Content-pace governor: how many pages go live per day and week, and a calmer recommended schedule. Report only: it never
// edits content. Writes <state>/<site>/pace.json and pace.md.   npx seo-autopilot run pace [--json]
import { analysePace, paceMarkdown } from "../analysis/pace.mjs";
import { loadPages } from "../adapters/index.mjs";
import { readJson, writeJson, writeText, today } from "../core/util.mjs";

export const description = "Content-pace governor: pages going live per day and week, and a recommended calmer schedule (report only)";

export async function run({ site, flags = {} }) {
  const s = site.paths.state;
  const pages = await loadPages(site);
  const r = analysePace({
    pages,
    limits: { pagesPerDay: site.limits?.pagesPerDay, pagesPerWeek: site.limits?.pagesPerWeek, perTemplatePerDay: site.limits?.perTemplatePerDay },
    today: today(),
    inspect: readJson(`${s}/inspect-state.json`, { results: {} }).results,
  });
  writeJson(`${s}/pace.json`, { generatedAt: new Date().toISOString(), ...r });
  const md = paceMarkdown(r, site.name);
  writeText(`${s}/pace.md`, md);
  console.log(flags.json ? JSON.stringify(r, null, 2) : md);
}
