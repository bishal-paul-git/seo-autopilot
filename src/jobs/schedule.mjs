// Drip scheduling: gives pages that a human has APPROVED (queued) their release dates, a few per day, so they appear
// gradually instead of all at once. The job only edits your content files (adds "publishAt", removes "queued") and
// commits nothing itself: the workflow (templates/workflows/seo-release.yml) commits and pushes the change.
//
// Nothing is ever created here. A page becomes "queued" only when you merge a pull request that adds it with
// queued: true (or you add it yourself). Pages marked hold: true are never scheduled.
//   npx seo-autopilot run schedule [--per-day 3] [--start YYYY-MM-DD] [--dry]
import { scheduleQueued } from "../adapters/index.mjs";

export const description = "Give approved (queued) pages release dates, N per day; --dry shows the plan without editing";

export async function run({ site, flags }) {
  const perDay = Number(flags["per-day"] ?? site.schedule?.perDay ?? 3);
  const touched = scheduleQueued(site, { perDay, start: flags.start, dry: Boolean(flags.dry) });
  for (const t of touched) console.log(`${t.date}  ${t.id}  (${t.file})`);
  console.log(`${touched.length} page(s) ${flags.dry ? "would be " : ""}scheduled, up to ${Math.min(4, perDay)} per day.`);
  if (process.env.GITHUB_OUTPUT && !flags.dry) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, `scheduled=${touched.length}\n`);
  }
}
