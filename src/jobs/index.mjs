// Job registry and runner. Each job module exports `description` and `run({ site, cfg, flags, positional })`.
import { loadConfig, pickSites } from "../core/config.mjs";

export const JOBS = {
  daily: () => import("./daily.mjs"),
  propose: () => import("./propose.mjs"),
  indexnow: () => import("./indexnow.mjs"),
  news: () => import("./news.mjs"),
  research: () => import("./research.mjs"),
  digest: () => import("./digest.mjs"),
  backlinks: () => import("./backlinks-submit.mjs"),
  "backlinks-queue": () => import("./backlinks-queue.mjs"),
  mentions: () => import("./mentions.mjs"),
  mark: () => import("./mark.mjs"),
  schedule: () => import("./schedule.mjs"),
  release: () => import("./release.mjs"),
  "indexing-queue": () => import("./indexing-queue.mjs"),
  dashboard: () => import("./dashboard.mjs"),
  audit: () => import("./audit.mjs"),
  analyze: () => import("./analyze.mjs"),
  refresh: () => import("./refresh.mjs"),
  deepdive: () => import("./deepdive.mjs"),
  agent: () => import("./agent.mjs"),
  geo: () => import("./geo.mjs"),
  speed: () => import("./speed.mjs"),
  priorities: () => import("./priorities.mjs"),
  experiments: () => import("./experiments.mjs"),
  profile: () => import("./profile.mjs"),
  team: () => import("./team.mjs"),
  consent: () => import("./consent.mjs"),
  ymyl: () => import("./ymyl.mjs"),
  pace: () => import("./pace.mjs"),
  citations: () => import("./citations.mjs"),
  quality: () => import("./quality.mjs"),
  redirects: () => import("./redirects.mjs"),
  facts: () => import("./facts.mjs"),
  conversions: () => import("./conversions.mjs"),
  links: () => import("./links.mjs"),
  render: () => import("./render.mjs"),
  work: () => import("./work.mjs"),
  inbound: () => import("./inbound.mjs"),
};

export async function describeJobs() {
  const out = [];
  for (const [name, load] of Object.entries(JOBS)) out.push([name, (await load()).description]);
  return out;
}

export async function runJob(name, { cwd = process.cwd(), site: siteId, flags = {}, positional = [] } = {}) {
  const load = JOBS[name];
  if (!load) throw new Error(`Unknown job "${name}". Jobs: ${Object.keys(JOBS).join(", ")}`);
  const cfg = loadConfig({ cwd });
  const mod = await load();
  for (const site of pickSites(cfg, siteId)) {
    console.log(`\n=== ${name} :: ${site.id} ===`);
    await mod.run({ site, cfg, flags, positional });
  }
}
