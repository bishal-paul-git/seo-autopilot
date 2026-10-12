// Deeper analysis in Python: groups your queries into topics (TF-IDF), flags unusual days and pages losing visibility with robust
// statistics (median and MAD, Theil-Sen trend). Needs Python 3.10+; no packages. Writes deepdive.json and deepdive.md.
//   npx seo-autopilot run deepdive
import { runEngine } from "../lib/python.mjs";

export const description = "Python analysis: query topics, unusual days, trends and pages losing visibility";

export async function run({ site, cfg }) {
  const r = await runEngine(["deepdive", "--state-dir", site.paths.state, "--data-dir", site.paths.data], { cwd: cfg.root });
  if (r.code === 127) { console.log(`deepdive: skipped. ${r.stderr}`); return; }
  if (r.code !== 0) throw new Error(`deepdive failed: ${r.stderr.trim().slice(-400) || r.stdout.trim().slice(-400)}`);
  console.log(r.stdout.trim());
}
