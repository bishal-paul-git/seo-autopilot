// `seo-autopilot doctor`: checks the setup and says exactly what to fix. Read-only.
import { loadConfig } from "../core/config.mjs";
import { readJson } from "../core/util.mjs";
import { googleKeyAvailable, getToken, SCOPES, searchAnalytics } from "../lib/google-auth.mjs";
import { loadPages } from "../adapters/index.mjs";
import { llmAvailable } from "../lib/llm.mjs";
import { ingestEnabled } from "../lib/ingest.mjs";
import { ghAvailable } from "../lib/gh.mjs";
import { plan } from "./upgrade.mjs";
import { findPython } from "../lib/python.mjs";
import { findGoEngine } from "../audit/engines.mjs";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Names of repository secrets and the values of variables, through the GitHub CLI when it is installed and signed in. */
export function githubSetup(cwd) {
  const run = (args) => { const r = spawnSync("gh", args, { cwd, encoding: "utf8", timeout: 20000 }); return r.error || r.status !== 0 ? null : JSON.parse(r.stdout || "[]"); };
  const secrets = run(["secret", "list", "--json", "name"]), vars = run(["variable", "list", "--json", "name,value"]);
  if (!secrets && !vars) return null;
  return { secrets: new Set((secrets || []).map((s) => s.name)), vars: new Map((vars || []).map((v) => [v.name, v.value])) };
}

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

  console.log("\nWorkflows and agents");
  try {
    const { items, cfg: c2 } = plan({ cwd });
    const missing = items.filter((i) => i.status === "missing"), differs = items.filter((i) => i.status === "differs");
    missing.length ? warn(`${missing.length} workflow(s) missing (${missing.map((i) => i.file).join(", ")}): run \`seo-autopilot upgrade --apply\``) : ok("all workflows present");
    if (differs.length) warn(`${differs.length} workflow(s) differ from this version's templates (${differs.map((i) => i.file).join(", ")}): run \`seo-autopilot upgrade --diff\` to see what is new`);
    existsSync(join(c2.dataDir, "agents")) && existsSync(join(c2.dataDir, "knowledge")) ? ok("playbooks and agents are in the project") : warn("playbooks or agents missing: run `seo-autopilot upgrade --apply`");
  } catch (e) { warn(`could not compare workflows: ${e.message}`); }

  console.log("\nOptional engines");
  const py = findPython();
  py ? ok(`Python ${py.version} found (deepdive and the agents can run)`) : warn("Python 3.10+ not found: the deepdive job and the agents are skipped (optional)");
  if (py) {
    const sdk = spawnSync(py.cmd, [...py.args, "-c", "import claude_agent_sdk"], { encoding: "utf8", timeout: 20000 });
    sdk.status === 0 ? ok("claude-agent-sdk installed") : warn("claude-agent-sdk not installed: pip install claude-agent-sdk (only needed to run agents)");
  }
  const goEng = findGoEngine();
  goEng ? ok(`Go crawler available (${goEng.how}); use it with audit --engine go`) : warn("Go not found: the built-in Node crawler is used (the Go engine is optional and faster on big sites)");

  console.log("\nGitHub secrets and variables");
  const gh = githubSetup(cwd);
  if (!gh) warn("GitHub CLI not available or not signed in: cannot check secrets. Check Settings > Secrets and variables > Actions yourself.");
  else {
    gh.secrets.has("GOOGLE_KEY_JSON") ? ok("GOOGLE_KEY_JSON secret set") : bad("GOOGLE_KEY_JSON secret is missing (the daily job cannot read Search Console)");
    gh.secrets.has("CLAUDE_CODE_OAUTH_TOKEN") || gh.secrets.has("ANTHROPIC_API_KEY") ? ok("drafting login secret set (pages can be drafted)") : warn("no drafting secret (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY): everything works except AI drafting, which is optional");
    gh.secrets.has("PAGESPEED_API_KEY") ? ok("PAGESPEED_API_KEY set") : warn("no PAGESPEED_API_KEY: the speed job may hit Google's shared quota (free key, optional)");
    for (const [name, what] of [["SEO_AUTOMERGE", "auto-merge of passing drafts"], ["SEO_REVIEW", "reviewer agent"], ["SEO_REQUIRE_REVIEW", "auto-merge waits for the reviewer"], ["BACKLINKS_LIVE", "real backlink submissions"]]) {
      console.log(`  info  ${name} = ${gh.vars.get(name) ?? "not set"} (${what})`);
    }
  }

  console.log("");
  ghAvailable() ? ok("GitHub token present (issues can be opened)") : warn("No GITHUB_TOKEN/GITHUB_REPOSITORY here: issues are skipped locally, fine in GitHub Actions");
  llmAvailable() ? ok("AI provider configured") : warn("No AI key: everything runs rule-based (optional)");
  console.log(failed ? `\n${failed} problem(s) to fix.` : "\nAll required checks passed.");
  return failed ? 1 : 0;
}
