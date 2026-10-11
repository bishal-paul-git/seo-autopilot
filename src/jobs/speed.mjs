// Page speed and Core Web Vitals through Google's public PageSpeed Insights API (no account needed; an optional
// PAGESPEED_API_KEY raises the rate limit). Tests the home page plus your top pages by clicks. Lab data is from Google's
// test machines and field data (real Chrome users) appears only for pages with enough traffic. Writes speed.json and speed.md.
//   npx seo-autopilot run speed [--pages 6] [--strategy mobile|desktop]
import { readJson, writeJson, writeText, today } from "../core/util.mjs";

export const description = "Core Web Vitals and performance for your top pages (PageSpeed Insights, lab and field data)";

const LIMITS = { lcp: [2500, 4000], cls: [0.1, 0.25], inp: [200, 500] };
const grade = (k, v) => (v == null ? "n/a" : v <= LIMITS[k][0] ? "good" : v <= LIMITS[k][1] ? "needs work" : "poor");

export async function run({ site, flags }) {
  const strategy = flags.strategy === "desktop" ? "desktop" : "mobile";
  const n = Number(flags.pages || site.speed?.pages || 6);
  const rows = readJson(`${site.paths.state}/gsc-rows.json`, { rows: [] }).rows || [];
  const clicks = new Map();
  for (const r of rows) clicks.set(r.page, (clicks.get(r.page) || 0) + (r.clicks || 0));
  const top = [...clicks.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
  const urls = [...new Set([site.url, ...top])].slice(0, n);
  const out = [];
  for (const url of urls) {
    const q = new URLSearchParams({ url, strategy, category: "performance" });
    if (process.env.PAGESPEED_API_KEY) q.set("key", process.env.PAGESPEED_API_KEY);
    try {
      const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(90000) });
      const j = await r.json();
      if (!r.ok) { out.push({ url, error: (j.error?.message || `HTTP ${r.status}`) + (r.status === 429 && !process.env.PAGESPEED_API_KEY ? " (the shared anonymous quota is used up: create a free PageSpeed Insights API key in Google Cloud and set PAGESPEED_API_KEY)" : "") }); if (r.status === 429) break; continue; }
      const a = j.lighthouseResult?.audits || {}, f = j.loadingExperience?.metrics || {};
      const lab = { score: Math.round((j.lighthouseResult?.categories?.performance?.score ?? 0) * 100), lcp: a["largest-contentful-paint"]?.numericValue ?? null, cls: a["cumulative-layout-shift"]?.numericValue ?? null, tbt: a["total-blocking-time"]?.numericValue ?? null };
      const field = { lcp: f.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null, cls: f.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? f.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null, inp: f.INTERACTION_TO_NEXT_PAINT?.percentile ?? null };
      const opp = Object.values(a).filter((x) => x.details?.type === "opportunity" && x.details.overallSavingsMs > 300).sort((x, y) => y.details.overallSavingsMs - x.details.overallSavingsMs).slice(0, 3).map((x) => `${x.title} (about ${Math.round(x.details.overallSavingsMs)} ms)`);
      out.push({ url, strategy, lab, field, opportunities: opp });
    } catch (e) { out.push({ url, error: String(e.message || e).slice(0, 120) }); }
  }
  writeJson(`${site.paths.state}/speed.json`, { generatedAt: new Date().toISOString(), strategy, results: out });
  const p = (u) => u.replace(site.url, "/") || "/";
  const nl = String.fromCharCode(10);
  const md = `# ${site.name} speed ${today()} (${strategy})

Lab data is a single test from Google's servers and varies run to run. Field data is real Chrome users over 28 days and only exists for pages with enough traffic.

${out.map((r) => r.error ? `## ${p(r.url)}${nl}Not measured: ${r.error}` : `## ${p(r.url)}: performance ${r.lab.score}/100
- Lab: LCP ${r.lab.lcp == null ? "n/a" : Math.round(r.lab.lcp)} ms (${grade("lcp", r.lab.lcp)}), CLS ${r.lab.cls == null ? "n/a" : r.lab.cls.toFixed(3)} (${grade("cls", r.lab.cls)}), blocking time ${r.lab.tbt == null ? "n/a" : Math.round(r.lab.tbt)} ms
- Real users: LCP ${r.field.lcp ?? "no data"}${r.field.lcp != null ? ` ms (${grade("lcp", r.field.lcp)})` : ""}, INP ${r.field.inp ?? "no data"}${r.field.inp != null ? ` ms (${grade("inp", r.field.inp)})` : ""}, CLS ${r.field.cls ?? "no data"}
${r.opportunities.map((o) => `- Fix: ${o}`).join(nl)}`).join(nl + nl)}
`;
  writeText(`${site.paths.state}/speed.md`, md);
  console.log(md);
}
