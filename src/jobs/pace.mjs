// Content-pace governor: how many pages go live per day and week, and a calmer recommended schedule. Report only: it never
// edits content unless you ask:  run pace --apply  writes the recommended publishAt dates (JSON and Markdown content only,
// never earlier than today, never reformatting a file it cannot rewrite exactly; review the diff and commit it yourself).
// Writes <state>/<site>/pace.json and pace.md.   npx seo-autopilot run pace [--json] [--apply]
import { analysePace, paceMarkdown } from "../analysis/pace.mjs";
import { loadPages, applyDates } from "../adapters/index.mjs";
import { readJson, writeJson, writeText, today } from "../core/util.mjs";

export const description = "Content-pace governor: pages going live per day and week, and a recommended calmer schedule (report only; --apply writes the new dates)";

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
  if (flags.apply) {
    if (!r.moves.length) { console.log("pace: nothing to apply, the schedule is within the limits."); return; }
    const { applied, skipped } = applyDates(site, r.moves);
    console.log(`pace: updated ${applied.length} publishAt date(s). Review with git diff, then commit.`);
    for (const a of applied) console.log(`  ${a.id}: ${a.from} -> ${a.to} (${a.file})`);
    for (const k of skipped) console.log(`  skipped ${k.id}: ${k.reason}`);
  }
}
