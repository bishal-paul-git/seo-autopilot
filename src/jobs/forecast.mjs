// Is traffic normal? Fits a Holt-Winters baseline (level, trend, weekly pattern) to your own Search Console history, leaves
// out the last 28 days, and says whether clicks and impressions, and which pages, fell outside their normal range.
// Needs Python 3.10+ (no packages) and about 12 weeks of history from the daily job. Writes forecast.json and forecast.md.
//   npx seo-autopilot run forecast
import { runEngine } from "../lib/python.mjs";

export const description = "Python forecast: were the last 28 days within the normal range for clicks, impressions and each page?";

export async function run({ site, cfg }) {
  const r = await runEngine(["forecast", "--state-dir", site.paths.state, "--data-dir", site.paths.data], { cwd: cfg.root });
  if (r.code === 127) { console.log(`forecast: skipped. ${r.stderr}`); return; }
  if (r.code !== 0) throw new Error(`forecast failed: ${r.stderr.trim().slice(-400) || r.stdout.trim().slice(-400)}`);
  console.log(r.stdout.trim());
}
