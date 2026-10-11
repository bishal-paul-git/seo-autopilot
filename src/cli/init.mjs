// `seo-autopilot init`: scaffold the config, editable data files and GitHub workflows into the current repository.
//   npx seo-autopilot init --url https://example.com/ [--id example] [--name "Example"] [--content sitemap|json|markdown]
//                         [--include "src/content/**/*.json"] [--dir content] [--property sc-domain:example.com]
//                         [--spec github:bishal-paul-git/seo-autopilot#v2] [--no-workflows] [--force]
// Existing files are never overwritten unless --force is given.
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { CONFIG_NAME } from "../core/config.mjs";

const TEMPLATES = fileURLToPath(new URL("../../templates/", import.meta.url));
const KNOWLEDGE = fileURLToPath(new URL("../../knowledge/", import.meta.url));
export const DEFAULT_SPEC = "github:bishal-paul-git/seo-autopilot#v2";

/** The content paths drafts may touch, as globs. */
export function contentGlobs(content = {}) {
  return content.type === "json" ? content.include
    : content.type === "markdown" ? [`${String(content.dir).replace(/\/$/, "")}/**`]
      : ["content/**"];
}

/** The only paths the drafting agent may edit, as Claude Code tool rules: Edit(glob),Write(glob). */
export function editTools(content = {}) {
  const globs = contentGlobs(content);
  return globs.flatMap((g) => [`Edit(${g})`, `Write(${g})`]).join(",");
}

/** Copy the SEO playbooks into <dataDir>/knowledge so the drafting agent (and you) can read them. Existing files are refreshed. */
export function exportKnowledge({ cwd = process.cwd(), dataDir = "seo-autopilot" } = {}) {
  const report = [];
  copyTree(KNOWLEDGE, join(cwd, dataDir, "knowledge"), { force: true, report });
  return report;
}

export const slugId = (url) => new URL(url).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

function copyTree(srcDir, dstDir, { force, report, transform }) {
  mkdirSync(dstDir, { recursive: true });
  for (const e of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, e.name), dst = join(dstDir, e.name);
    if (e.isDirectory()) { copyTree(src, dst, { force, report, transform }); continue; }
    if (existsSync(dst) && !force) { report.push(`kept     ${dst}`); continue; }
    let text = readFileSync(src, "utf8");
    if (transform) text = transform(text);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, text);
    report.push(`created  ${dst}`);
  }
}

export async function init({ cwd = process.cwd(), flags = {}, interactive = process.stdin.isTTY } = {}) {
  let url = flags.url;
  if (!url && interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    url = (await rl.question("Your site's URL (for example https://example.com/): ")).trim();
    rl.close();
  }
  if (!url) throw new Error("Missing --url. Example: npx seo-autopilot init --url https://example.com/");
  if (!/^https:\/\//.test(url)) throw new Error("The URL must start with https://");
  if (!url.endsWith("/")) url += "/";
  const id = flags.id || slugId(url);
  const content = flags.content || (flags.include ? "json" : flags.dir ? "markdown" : "sitemap");
  const site = {
    id,
    name: flags.name || id,
    url,
    searchConsoleProperty: flags.property || url,
    sitemap: flags.sitemap || `${url}sitemap.xml`,
    indexNow: { keyEnv: "INDEXNOW_KEY" },
    inspectPerDay: 60,
    indexNowPerDay: 10,
    ga4PropertyId: null,
    ignoreQueries: [],
    brandTerms: [flags.name || id],
    content: content === "json" ? { type: "json", include: String(flags.include || "content/**/*.json").split(",") }
      : content === "markdown" ? { type: "markdown", dir: flags.dir || "content" }
        : { type: "sitemap" },
  };
  const config = { stateDir: ".seo-autopilot", dataDir: "seo-autopilot", sites: [site] };

  const report = [];
  const cfgPath = join(cwd, CONFIG_NAME);
  if (existsSync(cfgPath) && !flags.force) report.push(`kept     ${cfgPath} (use --force to replace)`);
  else { writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n"); report.push(`created  ${cfgPath}`); }

  copyTree(join(TEMPLATES, "data"), join(cwd, "seo-autopilot"), { force: flags.force, report });
  report.push(...exportKnowledge({ cwd }));

  if (!flags["no-workflows"]) {
    const spec = flags.spec || process.env.SEO_AUTOPILOT_SPEC || DEFAULT_SPEC;
    copyTree(join(TEMPLATES, "workflows"), join(cwd, ".github", "workflows"), { force: flags.force, report, transform: (t) => t.replaceAll("{{SPEC}}", spec).replaceAll("{{EDIT_TOOLS}}", editTools(site.content)).replaceAll("{{CONTENT_GLOBS}}", contentGlobs(site.content).join("|")) });
  }

  const ignore = join(cwd, ".gitignore");
  const line = ".seo-autopilot/";
  const current = existsSync(ignore) ? readFileSync(ignore, "utf8") : "";
  if (!current.split(/\r?\n/).includes(line)) { appendFileSync(ignore, (current && !current.endsWith("\n") ? "\n" : "") + `${line}\n*service-account*.json\n.env\n`); report.push(`updated  ${ignore}`); }

  console.log(report.join("\n"));
  console.log(`
Next steps
1. Google access (needed for reports and research): create a service account, add it as a user on
   ${site.searchConsoleProperty} in Search Console, and save its JSON as the repo secret GOOGLE_KEY_JSON.
   Step by step: docs/google-setup.md
2. Check everything:  GOOGLE_KEY_FILE=/path/outside/repo/key.json npx seo-autopilot doctor
3. Edit seo-autopilot/topics.json (your industry's keywords), feeds.json and backlinks/profile.json (true, public facts only).
4. Commit and push, then run Actions > seo-daily > Run workflow.
5. Optional: IndexNow key (docs/indexnow.md), an AI key (ANTHROPIC_API_KEY or OPENAI_API_KEY), the implementer
   (install the Claude GitHub app + CLAUDE_CODE_OAUTH_TOKEN).`);
  return { config, cwd: resolve(cwd) };
}
