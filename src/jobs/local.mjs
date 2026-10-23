// Local business checks for the local pack: name, address and phone consistency across the site, LocalBusiness markup, and
// location pages that are thin or near-identical (doorway risk). Needs no key.
//   npx seo-autopilot run local [--pages 40] [--force]
// Pages: the home page, contact and about pages, and every location-like page from the audit, up to --pages. Each is fetched
// once from your own site (robots.txt respected). Runs only for sites the local pack applies to (detected from the site
// profile, or `verticals` in the config); --force runs it anyway. Writes local.json and local.md. It never edits a file.
import { readJson, writeJson, writeText, sleep } from "../core/util.mjs";
import { politeFetch } from "./optimize.mjs";
import { extractPage, mainScope, blockText } from "../audit/extract.mjs";
import { jsonldNodes } from "../analysis/schema.mjs";
import { pageFacts, analyseLocal, localMarkdown, LOCATION_PATH } from "../analysis/local.mjs";
import { detectVerticals } from "../analysis/verticals.mjs";

export const description = "Local business: name, address and phone consistency, LocalBusiness markup, thin or duplicate location pages";

export async function run({ site, flags = {} }, deps = {}) {
  const f = deps.fetch || globalThis.fetch, s = site.paths.state, n = Number(flags.pages || 40);
  const profile = readJson(`${s}/site-profile.json`, null);
  if (!flags.force && !detectVerticals({ profile, site }).some((p) => p.pack === "local")) {
    writeJson(`${s}/local.json`, { generatedAt: new Date().toISOString(), skipped: "not a local business (local pack not detected or not set)" });
    console.log(`local: skipped for ${site.id}: the local pack does not apply. Set "verticals": ["local"] in the config, or run with --force.`);
    return;
  }
  const audit = readJson(`${s}/audit.json`, { pages: [] });
  const live = (audit.pages || []).filter((p) => p.status === 200 && !p.noindex).map((p) => p.url);
  const path = (u) => { try { return new URL(u).pathname; } catch { return ""; } };
  const urls = [...new Set([site.url, ...live.filter((u) => /\/(contact|about|find-us|visit|locations?)(\/|$|-)/i.test(path(u))), ...live.filter((u) => LOCATION_PATH.test(path(u)))])].slice(0, n);
  const pages = [], skipped = [];
  for (const [i, url] of urls.entries()) {
    if (i) await sleep(deps.delayMs ?? 300);
    const got = await politeFetch(url, f);
    if (got.error) { skipped.push({ url, error: got.error }); continue; }
    const p = extractPage(got.html, url);
    pages.push(pageFacts({ url, html: got.html, text: blockText(mainScope(got.html)), nodes: jsonldNodes(got.html).nodes, words: p.words }));
  }
  const result = analyseLocal(pages, { owner: site.business || {} });
  writeJson(`${s}/local.json`, { generatedAt: new Date().toISOString(), ...result, pages: pages.map(({ text, ...rest }) => rest), skipped });
  writeText(`${s}/local.md`, localMarkdown({ siteName: site.name, result, skipped }));
  const high = result.findings.filter((x) => x.severity === "high").length;
  console.log(`local: ${site.id}: checked ${pages.length} page(s) (${result.locationPages} location), ${result.findings.length} finding(s), ${high} high.${skipped.length ? ` ${skipped.length} could not be fetched.` : ""}${audit.pages?.length ? "" : " Run the audit first so location pages are found."}`);
}
