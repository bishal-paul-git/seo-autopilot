// `seo-autopilot upgrade`: bring an existing project up to date with this version.
//   upgrade            report what is missing or different (changes nothing)
//   upgrade --apply    add missing workflows, refresh the playbooks and agents
//   upgrade --force    also overwrite workflow files that differ from the current template (your edits are replaced;
//                      commit first so git shows exactly what changed)
//   upgrade --diff     show the lines that differ for each changed workflow
// Workflow files are generated from templates when you run `init`, so without this command new features (new jobs,
// safer prompts) would never reach a project that was set up earlier.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../core/config.mjs";
import { editTools, contentGlobs, exportKnowledge, DEFAULT_SPEC } from "./init.mjs";

const TEMPLATES = fileURLToPath(new URL("../../templates/workflows/", import.meta.url));
const norm = (t) => String(t).replace(/\r\n/g, "\n").replace(/\s+$/, "");

/** Render each workflow template for this project, exactly as `init` would. */
export function renderTemplates({ site, spec }) {
  return readdirSync(TEMPLATES).filter((f) => f.endsWith(".yml")).map((f) => ({
    file: f,
    text: readFileSync(join(TEMPLATES, f), "utf8")
      .replaceAll("{{SPEC}}", spec).replaceAll("{{EDIT_TOOLS}}", editTools(site.content)).replaceAll("{{CONTENT_GLOBS}}", contentGlobs(site.content).join("|")),
  }));
}

/** Lines present in one text and not the other (order-insensitive, enough to see what a template change is). */
export function lineDiff(current, wanted) {
  const a = new Set(norm(current).split("\n")), b = new Set(norm(wanted).split("\n"));
  return { removed: [...a].filter((l) => !b.has(l) && l.trim()), added: [...b].filter((l) => !a.has(l) && l.trim()) };
}

/** The pinned spec the project already uses, so an upgrade does not silently change the version it follows. */
export function currentSpec(workflowsDir) {
  for (const f of ["seo-daily.yml", "seo-weekly.yml"]) {
    const p = join(workflowsDir, f);
    if (existsSync(p)) { const m = readFileSync(p, "utf8").match(/^\s*SEO:\s*"([^"]+)"/m); if (m) return m[1]; }
  }
  return DEFAULT_SPEC;
}

export function plan({ cwd = process.cwd() } = {}) {
  const cfg = loadConfig({ cwd });
  const site = cfg.sites[0];
  const dir = join(cfg.root, ".github", "workflows");
  const spec = currentSpec(dir);
  const items = renderTemplates({ site, spec }).map((t) => {
    const path = join(dir, t.file);
    if (!existsSync(path)) return { ...t, path, status: "missing" };
    const current = readFileSync(path, "utf8");
    return norm(current) === norm(t.text) ? { ...t, path, status: "current" } : { ...t, path, status: "differs", diff: lineDiff(current, t.text) };
  });
  return { cfg, site, spec, dir, items };
}

export function upgrade({ cwd = process.cwd(), flags = {} } = {}) {
  const { cfg, spec, dir, items } = plan({ cwd });
  const log = [];
  const rel = (p) => relative(cfg.root, p).replaceAll("\\", "/");
  log.push(`Following ${spec}${spec === DEFAULT_SPEC ? "" : " (kept from your workflows)"}`);
  for (const it of items) {
    if (it.status === "current") { log.push(`  current   ${rel(it.path)}`); continue; }
    if (it.status === "missing") {
      if (flags.apply || flags.force) { mkdirSync(dir, { recursive: true }); writeFileSync(it.path, it.text); log.push(`  added     ${rel(it.path)}`); }
      else log.push(`  missing   ${rel(it.path)}  (run with --apply to add it)`);
      continue;
    }
    if (flags.force) { writeFileSync(it.path, it.text); log.push(`  replaced  ${rel(it.path)}  (${it.diff.added.length} lines added, ${it.diff.removed.length} removed)`); }
    else {
      log.push(`  differs   ${rel(it.path)}  (+${it.diff.added.length} / -${it.diff.removed.length} lines vs the current template; yours may be customised, run with --diff to see, --force to replace)`);
      if (flags.diff) {
        for (const l of it.diff.removed.slice(0, 40)) log.push(`      - ${l.trim().slice(0, 140)}`);
        for (const l of it.diff.added.slice(0, 40)) log.push(`      + ${l.trim().slice(0, 140)}`);
      }
    }
  }
  if (flags.apply || flags.force) {
    const rel2 = relative(cfg.root, cfg.dataDir).replaceAll("\\", "/") || "seo-autopilot";
    for (const l of exportKnowledge({ cwd: cfg.root, dataDir: rel2 })) log.push(`  ${l}`);
    log.push("", "Review with `git diff`, then commit.");
  } else if (items.some((i) => i.status !== "current")) log.push("", "Nothing was changed. Add --apply to add missing files and refresh the playbooks and agents.");
  else log.push("", "Workflows are up to date.");
  return log.join("\n");
}
