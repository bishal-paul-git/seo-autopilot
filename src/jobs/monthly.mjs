// Monthly report (D17): what the autopilot published, what the watch rolled back, search traffic over 28 days vs the
// 28 before, audit findings vs last month, experiment results and next month's top priorities.
//   npx seo-autopilot run monthly [--prs prs.json] [--dry]
// prs.json: last month's merged pull requests, from
//   gh pr list --state merged --search "merged:>=YYYY-MM-DD" --json number,title,mergedAt,labels
// Reads the saved reports (page-daily.json, audit.json, priorities.json, <data>/experiments.json) and writes monthly.md,
// monthly.json and monthly-snapshot.json (next month's baseline). Opens one "Monthly SEO report YYYY-MM" issue.
import { readFileSync } from "node:fs";
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { ghAvailable, ensureLabel, existingTitles, openIssue } from "../lib/gh.mjs";
import { evaluate, controlGroup } from "../analysis/experiments.mjs";
import { trafficChange, autopilotLedger, auditChange, experimentSummary, monthlyMarkdown, snapshot } from "../analysis/monthly.mjs";

export const description = "Monthly report: autopilot changes and rollbacks, 28-day traffic, audit findings vs last month, experiments";

export async function run({ site, flags = {} }) {
  const s = site.paths.state, day = flags.today || today(), month = day.slice(0, 7);
  let prs = [];
  try { prs = JSON.parse(readFileSync(String(flags.prs), "utf8")); } catch { /* no pull request list: the ledger shows zeros */ }
  const series = readJson(`${s}/page-daily.json`, {});
  const summary = readJson(`${s}/audit.json`, null)?.summary;
  // A second run in the same month keeps comparing with the month before, not with itself.
  const saved = readJson(`${s}/monthly-snapshot.json`, null);
  const baseline = saved && saved.month !== month ? saved : saved?.previous || null;
  const log = readJson(`${site.paths.data}/experiments.json`, []);
  const excluded = new Set(log.map((e) => e.url));
  const traffic = trafficChange(series, day);
  const report = {
    month, traffic, ledger: autopilotLedger(prs),
    audit: auditChange(summary, baseline),
    experiments: experimentSummary(log.map((e) => evaluate(e, series, day, { controls: controlGroup(e, series, excluded) }))),
    priorities: readJson(`${s}/priorities.json`, { items: [] }).items.slice(0, 5),
  };
  const md = monthlyMarkdown({ siteName: site.name, ...report });
  writeJson(`${s}/monthly.json`, { generatedAt: new Date().toISOString(), ...report });
  writeText(`${s}/monthly.md`, md);
  writeJson(`${s}/monthly-snapshot.json`, { ...snapshot(month, summary, traffic), previous: baseline ? { ...baseline, previous: null } : null });
  console.log(md);
  if (!ghAvailable() || flags.dry) return;
  const L = "seo-monthly";
  await ensureLabel(L, "1D76DB", "Monthly SEO report");
  const title = `Monthly SEO report ${month}`;
  if ((await existingTitles(L)).has(title)) return;
  await openIssue(title, md, [L]);
}
