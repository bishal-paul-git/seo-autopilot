// Works out what platform and structure the site has, so the agents adapt to it. Reads the repository's file list and
// package.json (when run inside the site's repository) and fetches the home page, robots.txt, sitemap and llms.txt.
// Writes <state>/<site>/site-profile.json and site-profile.md. Re-run after a redesign or a platform change.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { detectProfile, profileMarkdown } from "../analysis/site-profile.mjs";
import { writeJson, writeText } from "../core/util.mjs";

export const description = "Detect the site's platform, rendering and where content, redirects and robots live, so agents adapt to it";

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", ".output", ".cache", ".seo-autopilot", "vendor", "coverage"]);

export function listFiles(root, { max = 4000, depth = 4 } = {}) {
  const out = [];
  const walk = (dir, d) => {
    if (out.length >= max || d > depth) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, d + 1); else out.push(relative(root, p).split(sep).join("/"));
      if (out.length >= max) return;
    }
  };
  walk(root, 0);
  return out;
}

async function get(url) {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "seo-autopilot-profile/1.0" }, signal: AbortSignal.timeout(15000) });
    return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers), text: r.ok ? (await r.text()).slice(0, 600000) : "" };
  } catch { return { ok: false, status: 0, headers: {}, text: "" }; }
}

export async function run({ site, cfg }) {
  const root = cfg.root;
  const files = existsSync(root) ? listFiles(root) : [];
  let pkg = null;
  try { pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); } catch { /* not a Node project */ }
  const [home, robots, sitemap, llms] = await Promise.all([get(site.url), get(new URL("/robots.txt", site.url).href), get(site.sitemap), get(new URL("/llms.txt", site.url).href)]);
  if (!home.ok) console.log(`profile: could not fetch ${site.url} (status ${home.status}); using repository files only.`);
  const profile = detectProfile({ files, pkg, html: home.text, headers: home.headers, robotsTxt: robots.text, sitemapXml: sitemap.text, hasLlms: llms.ok && llms.text.length > 20, url: site.url });
  writeJson(`${site.paths.state}/site-profile.json`, profile);
  const md = profileMarkdown(profile, site.name);
  writeText(`${site.paths.state}/site-profile.md`, md);
  console.log(md);
}
