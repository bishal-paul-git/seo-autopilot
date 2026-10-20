// The autopilot policy (D17): what the system may publish by itself, and the yes/no a workflow asks before merging.
//   npx seo-autopilot run autopilot                     show the effective policy: level per kind of change, limits, pause
//   npx seo-autopilot run autopilot --decide --files a.md,b.md [--added-files b.md] --labels seo-refresh [--added-file added.txt]
//                                    [--today 2] [--new-this-week 1]
//   npx seo-autopilot run autopilot --pick --issues-file issues.json [--max 1] [--today 0] [--new-this-week 0]
//                                    which open proposal issues to draft without a person (gh issue list --json number,labels)
// --decide exits 1 unless this change may be merged and published without a person. The pause switch is
// "autopilot": { "paused": true } in the config or the environment variable SEO_AUTOPILOT_PAUSED=true (a repository variable).
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { contentGlobs } from "../cli/init.mjs";
import { resolvePolicy, classifyChange, decide, pickWork, LEVELS } from "../analysis/autonomy.mjs";

export const description = "Autopilot policy: which changes publish by themselves (with checks, limits and undo) and which wait for a person";

const list = (v) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

export async function run({ site, flags = {} }) {
  const policy = resolvePolicy({ ...(site.autopilot || {}), paused: Boolean(site.autopilot?.paused) || process.env.SEO_AUTOPILOT_PAUSED === "true" });
  if (flags.pick) {
    let issues = [];
    try { issues = JSON.parse(readFileSync(String(flags["issues-file"]), "utf8")).map((i) => ({ number: i.number, labels: (i.labels || []).map((l) => (typeof l === "string" ? l : l.name)) })); } catch { /* no issues */ }
    const picked = pickWork(issues, policy, { today: Number(flags.today ?? 0), newPagesThisWeek: Number(flags["new-this-week"] ?? 0), max: Number(flags.max ?? 1) });
    console.log(picked.length ? `Autopilot will draft: ${picked.map((p) => `#${p.number} (${p.cls})`).join(", ")}` : `Nothing to draft automatically${policy.paused ? " (paused)" : ""}.`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `issue=${picked[0]?.number ?? ""}\n`);
    return;
  }
  if (!flags.decide) {
    const by = (l) => Object.entries(policy.levels).filter(([, v]) => v === l).map(([k]) => k).join(", ") || "none";
    console.log(`# Autopilot policy for ${site.name}

${policy.enabled ? (policy.paused ? "**Paused**: nothing is merged or published automatically until the pause is lifted." : "On.") : "Off: every change waits for a person."}

- Publishes by itself, then watches and reverts on regression: ${by("undo")}
- Publishes by itself once every check passes: ${by("autopilot")}
- Prepared for a person to merge: ${by("prepare")}
- Reported only: ${by("watch")}

Limits: ${policy.limits.changesPerDay} automatic changes a day, ${policy.limits.newPagesPerWeek} new pages a week.
Checks before anything publishes: build, facts guard, the AI reviewer, and the technical checks for the kind of change.${policy.ignored.length ? `\n\nIgnored settings: ${policy.ignored.join("; ")}.` : ""}`);
    return;
  }
  const addedText = typeof flags["added-file"] === "string" && existsSync(flags["added-file"]) ? readFileSync(flags["added-file"], "utf8") : "";
  const change = classifyChange({ files: list(flags.files), addedFiles: list(flags["added-files"]), labels: list(flags.labels), contentGlobs: contentGlobs(site.content), addedText, review: site.review || {} });
  const d = decide(change, policy, { today: Number(flags.today ?? 0), newPagesThisWeek: Number(flags["new-this-week"] ?? 0) });
  console.log(`${d.merge ? "MERGE" : "HOLD"}: ${d.cls} at "${d.level}" (levels: ${LEVELS.join(" < ")}). ${d.reasons.join("; ")}.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `watch=${d.merge && d.watch ? "true" : "false"}\nclass=${d.cls}\n`);
  if (!d.merge) process.exitCode = 1;
}
