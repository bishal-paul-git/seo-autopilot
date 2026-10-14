// Tells you which agents to run next and in what order, from the audit, priorities, indexing, speed and AI search reports.
// Writes <state>/<site>/agent-plan.json and agent-plan.md. Run `profile` first so the plan fits the site's platform.
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { routeAgents, planMarkdown } from "../analysis/agent-router.mjs";
import { loadPages, pipeline } from "../adapters/index.mjs";

export const description = "Decide which of the agents to run next, in order, with a ready-to-paste instruction for each";

export async function run({ site }) {
  const s = site.paths.state;
  const profile = readJson(`${s}/site-profile.json`, null);
  let pipe = null;
  try { pipe = pipeline(await loadPages(site), today()); } catch { /* content adapter unavailable: skip the pipeline */ }
  const plan = routeAgents({
    profile,
    audit: readJson(`${s}/audit.json`, null),
    priorities: readJson(`${s}/priorities.json`, null),
    inspect: readJson(`${s}/inspect-state.json`, { results: {} }).results,
    speed: readJson(`${s}/speed.json`, null),
    geo: readJson(`${s}/geo.json`, null),
    pipeline: pipe,
    site,
    today: today(),
  });
  writeJson(`${s}/agent-plan.json`, plan);
  const md = planMarkdown(plan, site.name);
  writeText(`${s}/agent-plan.md`, md);
  console.log(md);
}
