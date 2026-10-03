// Daily SEO run for every site in sites.json. Read-only against Google; writes reports/<id>/.
//   GOOGLE_KEY_FILE=<path outside repo> node daily.mjs [siteId]
// Per site: inspects the next batch of sitemap URLs (URL Inspection API), then writes
// reports/<id>/daily-summary.md with proposals. It changes nothing on any website.
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { getToken } from "./lib/google-auth.mjs";

const cfg = JSON.parse(readFileSync(new URL("./sites.json", import.meta.url), "utf8"));
const only = process.argv[2];
const day = (x) => x.toISOString().slice(0, 10);
const { token } = await getToken(["https://www.googleapis.com/auth/webmasters.readonly"]);
const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

for (const site of cfg.sites.filter((s) => !only || s.id === only)) {
  const dir = fileURLToPath(new URL(`./reports/${site.id}`, import.meta.url));
  mkdirSync(dir, { recursive: true });
  const stateFile = `${dir}/inspect-state.json`;
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { results: {} };

  const sm = await (await fetch(site.sitemap)).text();
  const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const order = [...urls].sort((a, b) => (state.results[a]?.checkedAt || "").localeCompare(state.results[b]?.checkedAt || ""));

  let done = 0;
  for (const url of order.slice(0, site.inspectPerDay ?? cfg.defaults.inspectPerDay)) {
    const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      method: "POST", headers: auth, body: JSON.stringify({ inspectionUrl: url, siteUrl: site.searchConsoleProperty }),
    });
    const j = await r.json();
    if (j.error) { console.log(site.id, "error", url, j.error.message); if ([429, 403].includes(j.error.code)) break; continue; }
    const x = j.inspectionResult?.indexStatusResult || {};
    state.results[url] = { checkedAt: new Date().toISOString(), coverage: x.coverageState, fetch: x.pageFetchState, googleCanonical: x.googleCanonical, lastCrawl: x.lastCrawlTime };
    done++;
  }
  writeFileSync(stateFile, JSON.stringify(state, null, 2));

  const end = new Date(Date.now() - 2 * 864e5), start = new Date(end - 27 * 864e5);
  const q = async (dimensions, rowLimit) => (await (await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.searchConsoleProperty)}/searchAnalytics/query`, {
    method: "POST", headers: auth, body: JSON.stringify({ startDate: day(start), endDate: day(end), dimensions, rowLimit }) })).json()).rows || [];
  const [tot, queries, pages] = await Promise.all([q([], 1), q(["query"], 100), q(["page"], 100)]);
  const T = tot[0] || {};
  const p = (u) => u.replace(site.url, "/");
  const notIndexed = Object.entries(state.results).filter(([, v]) => v.coverage !== "Submitted and indexed");
  const near = queries.filter((r) => r.position > 5 && r.position < 20 && r.impressions >= 3).slice(0, 10).map((r) => `- "${r.keys[0]}": pos ${r.position.toFixed(1)}, ${r.impressions} impr`);
  const lowCtr = pages.filter((r) => r.impressions >= 10 && r.clicks === 0).slice(0, 8).map((r) => `- ${p(r.keys[0])}: ${r.impressions} impr, 0 clicks`);
  const md = `# ${site.name} SEO daily summary ${day(new Date())}

Search Console ${day(start)} to ${day(end)}: ${T.clicks ?? 0} clicks, ${T.impressions ?? 0} impressions, avg position ${(T.position ?? 0).toFixed(1)}.
Inspected ${done} pages today. ${notIndexed.length} of ${Object.keys(state.results).length} known pages are not indexed.

## Not indexed
${notIndexed.slice(0, 30).map(([u, v]) => `- ${p(u)} (${v.coverage})`).join("\n") || "- none"}

## Near-miss queries (positions 5-20): candidates for a new page or a better title
${near.join("\n") || "- none yet"}

## Pages with impressions but no clicks: rewrite title and description
${lowCtr.join("\n") || "- none yet"}
`;
  writeFileSync(`${dir}/daily-summary.md`, md);
  console.log(md);
}
