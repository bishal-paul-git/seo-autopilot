// `seo-autopilot doctor`: checks the setup and says exactly what to fix. Read-only.
import { loadConfig } from "../core/config.mjs";
import { readJson } from "../core/util.mjs";
import { googleKeyAvailable, getToken, SCOPES, searchAnalytics } from "../lib/google-auth.mjs";
import { loadPages } from "../adapters/index.mjs";
import { llmAvailable } from "../lib/llm.mjs";
import { ingestEnabled } from "../lib/ingest.mjs";
import { ghAvailable } from "../lib/gh.mjs";

export async function doctor({ cwd = process.cwd() } = {}) {
  let failed = 0;
  const ok = (m) => console.log(`  ok    ${m}`);
  const warn = (m) => console.log(`  warn  ${m}`);
  const bad = (m) => { failed++; console.log(`  FAIL  ${m}`); };

  let cfg;
  try { cfg = loadConfig({ cwd }); } catch (e) { console.log(e.message); return 1; }
  console.log(`Config: ${cfg.path}`);

  let token = null;
  if (!googleKeyAvailable()) warn("No Google key in this shell (set GOOGLE_KEY_FILE locally; in GitHub use the secret GOOGLE_KEY_JSON). Skipping Google checks.");
  else {
    try { ({ token } = await getToken([SCOPES.searchConsole])); ok("Google service account signs in"); } catch (e) { bad(`Google sign-in failed: ${e.message}`); }
  }

  for (const site of cfg.sites) {
    console.log(`\nSite: ${site.id} (${site.url})`);
    try {
      const r = await fetch(site.sitemap);
      const n = r.ok ? [...(await r.text()).matchAll(/<loc>/g)].length : 0;
      r.ok && n ? ok(`sitemap reachable, ${n} URLs`) : bad(`sitemap ${site.sitemap} returned HTTP ${r.status} or has no URLs`);
    } catch (e) { bad(`sitemap not reachable: ${e.message}`); }

    try {
      const pages = await loadPages(site);
      pages.length ? ok(`content adapter "${site.content.type}" found ${pages.length} pages`) : warn(`content adapter "${site.content.type}" found no pages: check content.include / content.dir`);
    } catch (e) { bad(`content adapter failed: ${e.message}`); }

    if (token) {
      try {
        const q = searchAnalytics(site, token);
        const end = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
        await q(end, end, [], 1);
        ok(`Search Console access to ${site.searchConsoleProperty}`);
      } catch (e) { bad(`Search Console: ${e.message}. Add the service account's email as a user on this property (docs/google-setup.md).`); }
    }

    const key = process.env[site.indexNow.keyEnv];
    if (!key) warn(`IndexNow off: set ${site.indexNow.keyEnv} (optional, Bing/Yandex only)`);
    else {
      const t = await fetch(`${site.url}${key}.txt`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
      t.trim() === key ? ok("IndexNow key file is live") : bad(`IndexNow key file not live at ${site.url}${key}.txt`);
    }

    readJson(site.paths.feeds, []).length ? ok("feeds.json has feeds") : warn(`no feeds in ${site.paths.feeds} (news watcher idle)`);
    const profile = readJson(`${site.paths.backlinks}/profile.json`, null);
    !profile || /^YOUR_/i.test(profile.name || "") ? warn("backlinks/profile.json still has placeholders (backlink submitter stays idle)") : ok("backlink profile filled in");
    ingestEnabled(site) ? ok("dashboard ingest configured") : warn("no dashboard ingest (optional)");
  }

  console.log("");
  ghAvailable() ? ok("GitHub token present (issues can be opened)") : warn("No GITHUB_TOKEN/GITHUB_REPOSITORY here: issues are skipped locally, fine in GitHub Actions");
  llmAvailable() ? ok("AI provider configured") : warn("No AI key: everything runs rule-based (optional)");
  console.log(failed ? `\n${failed} problem(s) to fix.` : "\nAll required checks passed.");
  return failed ? 1 : 0;
}
