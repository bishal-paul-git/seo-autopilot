// Search Console beyond web search, with the same read-only service account as the daily job: sitemap status (errors,
// warnings, last read), clicks from Discover, News, image and video results, search appearance, country and device splits,
// and the last days as preliminary data. Free; no new key.
//   npx seo-autopilot run gsc
// Writes gsc.json and gsc.md. Edits nothing.
import { writeJson, writeText, today as todayFn, addDays } from "../core/util.mjs";
import { getToken, SCOPES } from "../lib/google-auth.mjs";
import { TYPES, sitemapFindings, typeTotals, typeFindings, shares, deviceFindings, gscMarkdown } from "../analysis/gsc.mjs";

export const description = "Search Console beyond web search: sitemaps, Discover/News/image/video clicks, search appearance, countries, devices, fresh days";

/** A small Search Console client: query(body) and sitemaps(). Errors name the call, never the token. */
export function consoleApi(site, token, f = globalThis.fetch) {
  const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.searchConsoleProperty)}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const call = async (path, init = {}) => {
    const r = await f(`${base}${path}`, { headers, ...init });
    const j = await r.json().catch(() => ({}));
    if (j.error) throw new Error(`Search Console ${path.split("?")[0]}: ${j.error.message}`);
    return j;
  };
  return {
    query: async (body) => (await call("/searchAnalytics/query", { method: "POST", body: JSON.stringify(body) })).rows || [],
    sitemaps: async () => (await call("/sitemaps")).sitemap || [],
  };
}

/** `deps`: api ({ query, sitemaps }), today. For tests. */
export async function run({ site }, deps = {}) {
  const day = deps.today || todayFn();
  const api = deps.api || consoleApi(site, (await getToken([SCOPES.searchConsole])).token);
  // Final data lags about 3 days; compare two full 28-day windows that end there.
  const to = addDays(day, -3), from = addDays(to, -27), pTo = addDays(from, -1), pFrom = addDays(pTo, -27);
  const warnings = [];
  const q = (type, start, end, dimensions = [], extra = {}) => api.query({ startDate: start, endDate: end, type, dimensions, rowLimit: 250, ...extra }).catch((e) => { warnings.push(`${type}: ${e.message}`); return []; });
  const sitemaps = await api.sitemaps().catch((e) => { warnings.push(e.message); return null; });
  const cur = {}, prev = {};
  for (const t of ["web", ...TYPES]) { cur[t] = await q(t, from, to); prev[t] = await q(t, pFrom, pTo); }
  const types = typeTotals(cur, prev);
  const appearance = shares(await q("web", from, to, ["searchAppearance"]), 20);
  const devices = shares(await q("web", from, to, ["device"]), 5);
  const countries = shares(await q("web", from, to, ["country"]), 10);
  // The newest days, which final data does not include yet. Preliminary: Google may still revise them.
  const fresh = (await q("web", addDays(day, -4), addDays(day, -1), ["date"], { dataState: "all" })).map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions }));
  const findings = [
    ...(sitemaps ? sitemapFindings(sitemaps, { configured: site.sitemap, today: day }) : []),
    ...typeFindings(types),
    ...deviceFindings(devices),
  ];
  const r = { generatedAt: new Date().toISOString(), period: { from, to }, sitemaps: sitemaps || [], types, appearance, devices, countries, fresh, findings, warnings };
  writeJson(`${site.paths.state}/gsc.json`, r);
  writeText(`${site.paths.state}/gsc.md`, gscMarkdown({ siteName: site.name, r }));
  const extra = types.filter((t) => t.type !== "web" && t.clicks).map((t) => `${t.label} ${t.clicks}`).join(", ");
  console.log(`gsc: ${site.id}: ${sitemaps ? `${sitemaps.length} sitemap(s)` : "sitemaps unavailable"}, ${findings.length} finding(s)${extra ? `; clicks outside web search: ${extra}` : ""}.${warnings.length ? ` ${warnings.length} call(s) failed; see gsc.json.` : ""}`);
}
