// One ranked to-do list from everything the autopilot knows: audit findings, search insights, indexing and the content
// pipeline. score = impact x confidence / effort, and every item shows its evidence. Writes <state>/<site>/priorities.json
// and priorities.md, and (in GitHub Actions) opens one weekly issue with the top ten.
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { buildPriorities } from "../analysis/priorities.mjs";
import { RULES } from "../audit/rules.mjs";
import { loadPages, pipeline } from "../adapters/index.mjs";
import { ghAvailable, ensureLabel, existingTitles, openIssue } from "../lib/gh.mjs";

export const description = "Rank every finding and opportunity by impact x confidence / effort into one to-do list";

export async function run({ site, flags }) {
  const s = site.paths.state;
  const audit = readJson(`${s}/audit.json`, null), insights = readJson(`${s}/insights.json`, null);
  if (!audit && !insights) { console.log("priorities: nothing to rank yet. Run `audit` and the daily job (then `analyze`) first."); return; }
  const inspect = readJson(`${s}/inspect-state.json`, { results: {} }).results;
  const indexing = Object.entries(inspect).filter(([, v]) => v.coverage && v.coverage !== "Submitted and indexed" && !/redirect|alternate|duplicate/i.test(v.coverage)).map(([u, v]) => `${u.replace(site.url, "/")} (${v.coverage})`);
  const items = buildPriorities({ audit, insights, rules: RULES, pipeline: pipeline(await loadPages(site), today()), indexing, speed: readJson(`${s}/speed.json`, null), geo: readJson(`${s}/geo.json`, null) });
  writeJson(`${s}/priorities.json`, { generatedAt: new Date().toISOString(), items });

  const md = `# ${site.name} priorities ${today()}

Ranked by impact x confidence / effort. "est. clicks" values are estimates from this site's own click-through data; "points" are a rough severity scale. Confidence says how far to trust the estimate.

${items.slice(0, 25).map((i) => `## ${i.rank}. ${i.title}
Type: ${i.type} · effort ${i.effort} · confidence ${i.confidence} · score ${i.score} (impact ${Math.round(i.impact)} ${i.impactUnit})
**Why:** ${i.why}
**What to do:** ${i.how}
${i.evidence.map((e) => `- ${e}`).join("\n")}`).join("\n\n") || "Nothing to do right now."}
`;
  writeText(`${s}/priorities.md`, md);
  console.log(md.slice(0, 6000));

  if (!ghAvailable() || flags.dry || !items.length) return;
  const L = site.labels.priorities || "seo-priorities";
  await ensureLabel(L, "0EA5E9", "Ranked SEO priorities");
  const title = `Top SEO priorities, week of ${today()}`;
  if ((await existingTitles(L)).has(title)) return;
  await openIssue(title, items.slice(0, 10).map((i) => `${i.rank}. **${i.title}** (score ${i.score}, effort ${i.effort}, confidence ${i.confidence})\n   - ${i.how}\n${i.evidence.slice(0, 2).map((e) => `   - ${e}`).join("\n")}`).join("\n\n") + "\n\nFull list: the `priorities.md` report or the Priorities tab in the app.", [L]);
}
