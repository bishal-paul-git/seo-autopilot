// Redirect map tooling (ported from Erudience). The map is a file you keep: <dataDir>/redirects.json by default
// (see src/analysis/redirects.mjs for its shape). Three modes:
//   npx seo-autopilot run redirects                     check the map against the site's pages; exits 1 on errors
//   npx seo-autopilot run redirects generate [--format apache|nginx|netlify|vercel] [--write <file>]
//                                                       print server rules; --write puts them between markers in that file
//   npx seo-autopilot run redirects smoke [--origin https://staging.example]
//                                                       ask the live site (read-only GETs) whether every rule works
// Nothing is committed or deployed. --write edits one file in your working copy; you review and commit it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { loadPages } from "../adapters/index.mjs";
import { parseMap, checkRedirects, generate, waiting, replaceBlock, smokePlan, judge, normPath } from "../analysis/redirects.mjs";

export const description = "Redirect map: check it (targets live, no chains or loops), generate server rules, smoke-test the live site";

async function sitePaths(site, offline) {
  const live = new Set(), scheduled = new Set(), day = today();
  let pages = [];
  try { pages = await loadPages(site); } catch { /* content adapter unavailable */ }
  for (const p of pages) {
    const path = p.url && normPath(p.url, site.url);
    if (!path) continue;
    const later = p.queued || p.hold || (p.publishAt && String(p.publishAt).slice(0, 10) > day);
    (later ? scheduled : live).add(path);
  }
  if (!offline && site.content?.type && site.content.type !== "sitemap") {
    try {
      const xml = await (await fetch(site.sitemap, { signal: AbortSignal.timeout(20000) })).text();
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) { const p = normPath(m[1].trim(), site.url); if (p) live.add(p); }
    } catch { /* sitemap unreachable: the content files decide */ }
  }
  live.add("/");
  for (const p of live) scheduled.delete(p);
  return { live, scheduled };
}

async function fetchStatus(url) {
  try {
    const r = await fetch(url, { redirect: "manual", headers: { "user-agent": "seo-autopilot-redirects/1.0" }, signal: AbortSignal.timeout(15000) });
    const loc = r.headers.get("location");
    return { status: r.status, location: loc ? new URL(loc, url).toString() : null };
  } catch (e) { return { status: 0, location: null, error: e.name }; }
}

export async function run({ site, flags, positional = [] }) {
  const mode = positional[0] || "check";
  const file = site.paths.redirects;
  if (!existsSync(file)) { console.log(`redirects: no redirect map at ${file}. Create it with {"redirects": {"/old": "/new"}, "gone": ["/retired"]}. Skipped.`); return; }
  const map = parseMap(readJson(file, {}), site.url);

  if (mode === "generate") {
    const format = String(flags.format || site.redirects?.format || "apache");
    const { live } = await sitePaths(site, Boolean(flags.offline));
    const block = generate(map, format, { live });
    const held = waiting(map, live);
    const gone = map.gone.filter((g) => !map.redirects.has(g));
    const target = typeof flags.write === "string" ? flags.write : flags.write ? site.redirects?.output : null;
    if (target) {
      const path = resolve(site.paths.root, target);
      if (format === "vercel") throw new Error("vercel.json holds other settings: print the rules (no --write) and merge the redirects array by hand");
      const before = existsSync(path) ? readFileSync(path, "utf8") : "";
      writeFileSync(path, replaceBlock(before, block));
      console.log(`redirects: wrote ${map.redirects.size} redirect(s)${["apache", "nginx"].includes(format) ? ` and ${gone.length} gone page(s)` : ""} into ${target}. Review the diff and commit it yourself.`);
    } else console.log(block);
    if (held.length) console.log(`\n${held.length} redirect(s) held back until the target is live: ${held.slice(0, 10).map(([f, t]) => `${f} -> ${t}`).join(", ")}${held.length > 10 ? " ..." : ""}`);
    if (gone.length && ["netlify", "vercel"].includes(format)) console.log(`\n${gone.length} gone page(s) are not in these rules; make them answer 404 or 410 on the platform: ${gone.slice(0, 10).join(", ")}${gone.length > 10 ? " ..." : ""}`);
    return;
  }

  if (mode === "smoke") {
    const origin = String(flags.origin || site.url).replace(/\/$/, "");
    const plan = smokePlan(map, { max: Number(flags.max ?? 200) });
    const results = [];
    for (const c of plan) {
      const res = await fetchStatus(origin + c.path);
      // Judge Location against the origin being tested, so a staging host compares like for like.
      results.push({ ...c, ...res, ...judge(c, res, [origin + "/", site.url]) });
    }
    const failed = results.filter((r) => !r.ok), warned = results.filter((r) => r.ok && r.warn);
    writeJson(`${site.paths.state}/redirects-smoke.json`, { generatedAt: new Date().toISOString(), origin, checked: results.length, failed: failed.length, results });
    const md = `# ${site.name} redirect smoke test ${today()}

Asked ${origin} for ${results.length} URL(s): ${results.length - failed.length} answered as expected, ${failed.length} did not.${plan.length - 1 < map.redirects.size + map.gone.length ? ` (Checked the first ${Number(flags.max ?? 200)} of each kind; raise --max to check more.)` : ""}

${failed.map((r) => `- FAIL ${r.path}: ${r.detail}`).join("\n") || "- No failures."}
${warned.length ? `\n${warned.map((r) => `- note ${r.path}: ${r.warn}`).join("\n")}\n` : ""}`;
    writeText(`${site.paths.state}/redirects-smoke.md`, md);
    console.log(md);
    if (failed.length) process.exitCode = 1;
    return;
  }

  if (mode !== "check") throw new Error(`unknown mode "${mode}": use check, generate or smoke`);
  const { live, scheduled } = await sitePaths(site, Boolean(flags.offline));
  const r = checkRedirects(map, live, scheduled);
  writeJson(`${site.paths.state}/redirects-check.json`, { generatedAt: new Date().toISOString(), file, livePages: live.size, ...r });
  const md = `# ${site.name} redirect map check ${today()}

${r.redirects} redirect(s), ${r.gone} gone page(s) and ${r.goneSections} retired section(s) checked against ${live.size} live page(s) (content files${site.content?.type && site.content.type !== "sitemap" ? " and the live sitemap" : ", from the live sitemap"}).

${r.errors.length ? `## Errors (fix before release)\n${r.errors.map((e) => `- ${e}`).join("\n")}` : "No errors."}
${r.warnings.length ? `\n## Waiting or not checked\n${r.warnings.map((e) => `- ${e}`).join("\n")}\n` : ""}`;
  writeText(`${site.paths.state}/redirects-check.md`, md);
  console.log(md);
  if (r.errors.length) process.exitCode = 1;
}
