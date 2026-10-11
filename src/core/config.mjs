// Configuration: one file, seo-autopilot.config.json, in the root of the website's repository.
// Every path inside it is relative to that file. Defaults keep a minimal config to a handful of lines.
import { existsSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { readJson, writeJson } from "./util.mjs";

export const CONFIG_NAME = "seo-autopilot.config.json";

export const DEFAULTS = {
  stateDir: ".seo-autopilot",
  dataDir: "seo-autopilot",
  site: {
    inspectPerDay: 60,
    indexNowPerDay: 10,
    ga4PropertyId: null,
    ignoreQueries: [],
    brandTerms: [],
    content: { type: "sitemap" },
    labels: { proposal: "seo-proposal", topic: "seo-topic", approved: "approved", digest: "seo-digest", backlink: "seo-backlink" },
    limits: { proposalsPerRun: 3, topicsPerWeek: 2, newsTopicsPerRun: 1 },
    indexNow: { keyEnv: "INDEXNOW_KEY" },
    ingest: null,
  },
};

const merge = (base, over) => {
  if (Array.isArray(base) || typeof base !== "object" || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = typeof v === "object" && v !== null && !Array.isArray(v) ? merge(base[k] ?? {}, v) : v;
  return out;
};

export function findConfig(cwd = process.cwd()) {
  const env = process.env.SEO_AUTOPILOT_CONFIG;
  if (env) return resolve(cwd, env);
  let dir = resolve(cwd);
  for (;;) {
    const f = join(dir, CONFIG_NAME);
    if (existsSync(f)) return f;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function validate(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") return ["config is not an object"];
  if (!Array.isArray(raw.sites) || raw.sites.length === 0) errors.push("sites must be a non-empty array");
  const ids = new Set();
  for (const [i, s] of (raw.sites || []).entries()) {
    const w = `sites[${i}]`;
    if (!s.id || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) errors.push(`${w}.id must be lowercase letters, digits and dashes`);
    if (ids.has(s.id)) errors.push(`${w}.id "${s.id}" is used twice`);
    ids.add(s.id);
    if (!s.url || !/^https:\/\//.test(s.url)) errors.push(`${w}.url must start with https://`);
    if (s.url && !s.url.endsWith("/")) errors.push(`${w}.url must end with a slash`);
    if (!s.searchConsoleProperty) errors.push(`${w}.searchConsoleProperty is required (for example "${s.url}" or "sc-domain:example.com")`);
    if (!s.sitemap || !/^https:\/\//.test(s.sitemap)) errors.push(`${w}.sitemap must be a full https URL`);
    const t = s.content?.type ?? "sitemap";
    if (!["sitemap", "json", "markdown"].includes(t)) errors.push(`${w}.content.type must be sitemap, json or markdown`);
    if (t === "json" && !Array.isArray(s.content.include)) errors.push(`${w}.content.include must list glob patterns for the JSON files`);
    if (t === "markdown" && !s.content.dir) errors.push(`${w}.content.dir is required for markdown content`);
  }
  return errors;
}

export function loadConfig({ cwd = process.cwd(), file } = {}) {
  const path = file ? resolve(cwd, file) : findConfig(cwd);
  if (!path || !existsSync(path)) {
    throw new Error(`No ${CONFIG_NAME} found. Run "npx seo-autopilot init" in your website's repository first.`);
  }
  const raw = readJson(path, null);
  const errors = validate(raw);
  if (errors.length) throw new Error(`${CONFIG_NAME} has problems:\n- ${errors.join("\n- ")}`);
  const root = dirname(path);
  const abs = (p) => (isAbsolute(p) ? p : resolve(root, p));
  const stateDir = abs(raw.stateDir ?? DEFAULTS.stateDir);
  const dataDir = abs(raw.dataDir ?? DEFAULTS.dataDir);
  const sites = raw.sites.map((s) => {
    const site = merge(DEFAULTS.site, s);
    site.paths = {
      root,
      state: join(stateDir, site.id),
      data: dataDir,
      feeds: abs(site.feeds ?? join(dataDir, "feeds.json")),
      topics: abs(site.topicsConfig ?? join(dataDir, "topics.json")),
      backlinks: abs(site.backlinksDir ?? join(dataDir, "backlinks")),
    };
    return site;
  });
  return { path, root, stateDir, dataDir, sites };
}

export function pickSites(cfg, only) {
  const list = only ? cfg.sites.filter((s) => s.id === only) : cfg.sites;
  if (only && !list.length) throw new Error(`No site "${only}" in ${CONFIG_NAME}. Sites: ${cfg.sites.map((s) => s.id).join(", ")}`);
  return list;
}

export function saveConfig(path, raw) {
  writeJson(path, raw);
}
