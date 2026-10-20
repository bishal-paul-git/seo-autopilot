// Real-user Core Web Vitals (Chrome UX Report): the whole site and your top pages by clicks, current 28 days plus the
// 25-period history, graded with Google's thresholds, with regressions flagged.
//   npx seo-autopilot run vitals [--pages 10] [--form-factor PHONE|DESKTOP]
// Needs a Google API key with the Chrome UX Report API enabled (free): CRUX_API_KEY, or PAGESPEED_API_KEY when the same key
// has both APIs enabled. Writes vitals.json and vitals.md in the state folder.
import { readJson, writeJson, writeText } from "../core/util.mjs";
import { parseRecord, parseHistory, regressions, vitalsMarkdown, METRICS } from "../analysis/vitals.mjs";

export const description = "Real-user Core Web Vitals from the Chrome UX Report: site and top pages, 25-week history, regressions (free Google key)";

const BASE = "https://chromeuxreport.googleapis.com/v1/records";

async function query(f, key, kind, body) {
  const r = await f(`${BASE}:${kind}?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, metrics: Object.values(METRICS) }), signal: AbortSignal.timeout(30000) });
  if (r.status === 404) return { error: "not enough Chrome traffic for field data" };
  if (!r.ok) return { error: `HTTP ${r.status}${r.status === 403 ? " (enable the Chrome UX Report API for this key)" : r.status === 429 ? " (rate limited)" : ""}` };
  return { json: await r.json() };
}

async function measure(f, key, target, formFactor) {
  const [cur, hist] = await Promise.all([query(f, key, "queryRecord", { ...target, formFactor }), query(f, key, "queryHistoryRecord", { ...target, formFactor })]);
  const current = cur.error ? { error: cur.error } : parseRecord(cur.json);
  const history = hist.error ? null : parseHistory(hist.json);
  return { current, history, regressions: history ? regressions(history) : [] };
}

export async function run({ site, flags = {} }, deps = {}) {
  const env = deps.env || process.env, f = deps.fetch || globalThis.fetch;
  const key = env.CRUX_API_KEY || env.PAGESPEED_API_KEY;
  if (!key) { console.log("vitals: set CRUX_API_KEY (a free Google Cloud API key with the Chrome UX Report API enabled). PAGESPEED_API_KEY works too if that key has the API enabled."); return; }
  const formFactor = String(flags["form-factor"] || "PHONE").toUpperCase() === "DESKTOP" ? "DESKTOP" : "PHONE";
  const n = Number(flags.pages || 10);
  const clicks = new Map();
  for (const r of readJson(`${site.paths.state}/gsc-rows.json`, { rows: [] }).rows || []) clicks.set(r.page, (clicks.get(r.page) || 0) + (r.clicks || 0));
  const urls = [...clicks].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, n);
  const origin = await measure(f, key, { origin: new URL(site.url).origin }, formFactor);
  const pages = [];
  for (const url of urls) pages.push({ url, ...(await measure(f, key, { url }, formFactor)) });
  writeJson(`${site.paths.state}/vitals.json`, { generatedAt: new Date().toISOString(), formFactor, origin, pages });
  const md = vitalsMarkdown({ siteName: site.name, origin, pages, formFactor });
  writeText(`${site.paths.state}/vitals.md`, md);
  console.log(md);
}
