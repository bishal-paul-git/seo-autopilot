// SEO experiment log. Record what you changed and when, and the report compares the 14 days after with the 14 days before.
//   npx seo-autopilot run experiments add <page-url> "<what you changed>" [YYYY-MM-DD]
//   npx seo-autopilot run experiments            (evaluate every logged experiment)
// The log is a plain file you own: <dataDir>/experiments.json. Results are directional (no control group).
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { evaluate } from "../analysis/experiments.mjs";

export const description = "Log an SEO change and measure the 14 days before vs after (directional, no control group)";

export async function run({ site, positional }) {
  const file = `${site.paths.data}/experiments.json`;
  const log = readJson(file, []);
  const [cmd, url, change, date] = positional;
  if (cmd === "add") {
    if (!url || !change) throw new Error('usage: run experiments add <page-url> "<what changed>" [YYYY-MM-DD]');
    const full = /^https?:/.test(url) ? url : site.url.replace(/\/$/, "") + (url.startsWith("/") ? url : "/" + url);
    log.push({ url: full, change, date: date || today() });
    writeJson(file, log);
    console.log(`logged: ${full} on ${date || today()}: ${change}`);
    return;
  }
  const series = readJson(`${site.paths.state}/page-daily.json`, {});
  const results = log.map((e) => evaluate(e, series, today()));
  const pct = (x) => (x == null ? "n/a" : `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`);
  const md = `# ${site.name} experiments ${today()}

Each result compares the 14 days after a change (starting 3 days later, to let reporting settle) with the 14 days before it. It is directional only: there is no control group.

${results.map((r) => `## ${r.url.replace(site.url, "/")}: ${r.change} (${r.date})
Status: ${r.status}${r.verdict ? `, ${r.verdict}` : ""}
${r.status === "done" ? `- Clicks ${r.before.clicks} to ${r.after.clicks} (${pct(r.clicksChange)}), impressions ${r.before.impressions} to ${r.after.impressions} (${pct(r.impressionsChange)}), CTR ${pct(r.ctrChange)}\n` : ""}${r.note}`).join("\n\n") || "No experiments logged. Add one with: run experiments add <page-url> \"what changed\" [date]"}
`;
  writeText(`${site.paths.state}/experiments.md`, md);
  console.log(md);
}
