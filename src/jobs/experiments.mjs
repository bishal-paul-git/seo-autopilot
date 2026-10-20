// SEO experiment log. Record what you changed and when, and the report compares the 14 days after with the 14 days before.
//   npx seo-autopilot run experiments add <page-url> "<what you changed>" [YYYY-MM-DD]
//   npx seo-autopilot run experiments log-git <ref> (log every title, description or H1 rewrite made since <ref>, JSON content sites)
//   npx seo-autopilot run experiments            (evaluate every logged experiment)
// The log is a plain file you own: <dataDir>/experiments.json. Results are directional (no control group).
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { evaluate, controlGroup, metaChanges } from "../analysis/experiments.mjs";
import { spawnSync } from "node:child_process";
import { contentFiles } from "../adapters/index.mjs";
import { relative } from "node:path";

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
  if (cmd === "log-git") {
    // Closes the gap where the log stayed empty because logging was manual: compare content files at <ref> with now.
    const ref = url;
    if (!ref) throw new Error("usage: run experiments log-git <git-ref>   (for example HEAD~5 or a tag)");
    let added = 0;
    for (const abs of contentFiles(site).filter((f) => f.endsWith(".json"))) {
      const rel = relative(site.paths.root, abs).split("\\").join("/");
      const old = spawnSync("git", ["show", ref + ":" + rel], { cwd: site.paths.root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (old.status !== 0) continue;
      let before, after; try { before = JSON.parse(old.stdout); after = readJson(abs, null); } catch { continue; }
      // The date of the change is the last commit that touched this file, not today: the before/after windows depend on it.
      const last = spawnSync("git", ["log", "-1", "--format=%cs", "--", rel], { cwd: site.paths.root, encoding: "utf8" });
      const changedOn = last.status === 0 && last.stdout.trim() ? last.stdout.trim() : today();
      for (const c of metaChanges(before, after)) {
        const route = (site.content.routes || []).find((r) => rel.includes(r.match));
        const pattern = route?.urlPattern || site.content.urlPattern;
        if (!pattern) continue;
        const full = site.url.replace(/\/$/, "") + pattern.replace("{slug}", c.id);
        if (log.some((e) => e.url === full && e.change === c.change && e.date === changedOn)) continue;
        log.push({ url: full, change: c.change, date: changedOn }); added++;
      }
    }
    writeJson(file, log);
    console.log(`logged ${added} experiment(s) from changes since ${ref}`);
    return;
  }
  const series = readJson(`${site.paths.state}/page-daily.json`, {});
  const excluded = new Set(log.map((e) => e.url));
  const results = log.map((e) => evaluate(e, series, today(), { controls: controlGroup(e, series, excluded) }));
  const pct = (x) => (x == null ? "n/a" : `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`);
  const md = `# ${site.name} experiments ${today()}

Each result compares the 14 days after a change (starting 3 days later, to let reporting settle) with the 14 days before it. When at least 3 untouched pages have enough traffic, the same dates are measured on them and the result is adjusted for what happened to the whole site. It is still directional: those pages are not matched on topic, and one change at a time is the only clean way to learn from this.

${results.map((r) => `## ${r.url.replace(site.url, "/")}: ${r.change} (${r.date})
Status: ${r.status}${r.verdict ? `, ${r.verdict}` : ""}
${r.status === "done" && r.control ? `- Adjusted for the rest of the site: clicks ${pct(r.control.adjustedClicksChange)}, impressions ${pct(r.control.adjustedImpressionsChange)}\n` : ""}${r.status === "done" ? `- Clicks ${r.before.clicks} to ${r.after.clicks} (${pct(r.clicksChange)}), impressions ${r.before.impressions} to ${r.after.impressions} (${pct(r.impressionsChange)}), CTR ${pct(r.ctrChange)}\n` : ""}${r.note}`).join("\n\n") || "No experiments logged. Add one with: run experiments add <page-url> \"what changed\" [date]"}
`;
  writeText(`${site.paths.state}/experiments.md`, md);
  console.log(md);
}
