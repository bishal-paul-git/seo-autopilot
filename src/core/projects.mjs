// The list of projects (website repositories) known to the local management app, plus its small settings file.
// Stored in ~/.seo-autopilot (override with SEO_AUTOPILOT_HOME). Only paths and a key FILE PATH are stored, never secrets.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { join, resolve, basename } from "node:path";
import { loadConfig, CONFIG_NAME } from "./config.mjs";
import { readJson, writeJson } from "./util.mjs";

export const homeDir = () => process.env.SEO_AUTOPILOT_HOME || join(homedir(), ".seo-autopilot");
const projectsFile = () => join(homeDir(), "projects.json");
const settingsFile = () => join(homeDir(), "settings.json");

export const getSettings = () => readJson(settingsFile(), { googleKeyFile: "" });
export function saveSettings(s) {
  const clean = { googleKeyFile: String(s.googleKeyFile || "").slice(0, 500) };
  writeJson(settingsFile(), clean);
  return clean;
}

export const listPaths = () => readJson(projectsFile(), []);

/** Register a repository (a folder containing seo-autopilot.config.json). */
export function addProject(path) {
  const root = resolve(path);
  const file = existsSync(join(root, CONFIG_NAME)) ? join(root, CONFIG_NAME) : null;
  if (!file) throw new Error(`No ${CONFIG_NAME} in ${root}. Run "seo-autopilot init" there first.`);
  loadConfig({ file });
  const all = listPaths();
  if (!all.includes(root)) writeJson(projectsFile(), [...all, root]);
  return root;
}

export function removeProject(path) {
  const root = resolve(path);
  writeJson(projectsFile(), listPaths().filter((p) => p !== root));
}

const idFor = (root, siteId) => `${siteId}-${createHash("sha1").update(root).digest("hex").slice(0, 6)}`;

/** Every site of every registered repository, with its loaded config. Broken entries are reported, not thrown. */
export function listSites() {
  const out = [], problems = [];
  for (const root of listPaths()) {
    try {
      const cfg = loadConfig({ file: join(root, CONFIG_NAME) });
      for (const site of cfg.sites) out.push({ id: idFor(root, site.id), siteId: site.id, root, repo: basename(root), site, cfg });
    } catch (e) { problems.push({ root, error: e.message.split("\n")[0] }); }
  }
  return { sites: out, problems };
}

export const findSite = (id) => listSites().sites.find((s) => s.id === id);
