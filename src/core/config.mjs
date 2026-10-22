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
    labels: { proposal: "seo-proposal", topic: "seo-topic", approved: "approved", digest: "seo-digest", backlink: "seo-backlink", priorities: "seo-priorities" },
    limits: { proposalsPerRun: 3, topicsPerWeek: 2, newsTopicsPerRun: 1, pagesPerDay: 2, pagesPerWeek: 8, perTemplatePerDay: null },
    review: { requireFields: ["author", "reviewedBy"] },
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
    for (const k of ["pagesPerDay", "pagesPerWeek", "perTemplatePerDay"]) {
      const v = s.limits?.[k];
      if (v != null && (!Number.isInteger(v) || v < 1)) errors.push(`${w}.limits.${k} must be a whole number of 1 or more`);
    }
    for (const k of ["thinIgnore", "retired"]) {
      if (s[k] != null && (!Array.isArray(s[k]) || s[k].some((v) => typeof v !== "string"))) errors.push(`${w}.${k} must be a list of URL path patterns, for example ["/contact", "/blog/*"]`);
    }
    if (s.language != null && (typeof s.language !== "string" || !/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(s.language))) errors.push(`${w}.language must be a language code such as "en" or "en-GB"`);
    if (s.conversions != null && (typeof s.conversions !== "object" || (s.conversions.events != null && (!Array.isArray(s.conversions.events) || s.conversions.events.some((e) => typeof e !== "string"))))) errors.push(`${w}.conversions.events must be a list of GA4 event names`);
    if (s.facts != null && (typeof s.facts !== "object" || Array.isArray(s.facts) || (s.facts.strict != null && typeof s.facts.strict !== "boolean"))) errors.push(`${w}.facts must be an object; facts.strict must be true or false`);
    if (s.autopilot != null) {
      const a = s.autopilot;
      if (typeof a !== "object" || Array.isArray(a)) errors.push(`${w}.autopilot must be an object`);
      else {
        if (a.levels != null && (typeof a.levels !== "object" || Array.isArray(a.levels) || Object.values(a.levels).some((v) => !["watch", "prepare", "autopilot", "undo"].includes(v)))) errors.push(`${w}.autopilot.levels values must be watch, prepare, autopilot or undo`);
        if (a.limits != null && (typeof a.limits !== "object" || Object.values(a.limits).some((v) => !Number.isInteger(v) || v < 0))) errors.push(`${w}.autopilot.limits must be whole numbers`);
        for (const k of ["enabled", "paused"]) if (a[k] != null && typeof a[k] !== "boolean") errors.push(`${w}.autopilot.${k} must be true or false`);
      }
    }
    if (s.logs != null && (typeof s.logs !== "object" || Array.isArray(s.logs) || (s.logs.dir != null && typeof s.logs.dir !== "string"))) errors.push(`${w}.logs must be an object; logs.dir must be a folder path`);
    if (s.inbound != null && (typeof s.inbound !== "object" || Array.isArray(s.inbound) || (s.inbound.dir != null && typeof s.inbound.dir !== "string"))) errors.push(`${w}.inbound must be an object; inbound.dir must be a folder path`);
    if (s.research != null) {
      const r = s.research;
      if (typeof r !== "object" || Array.isArray(r)) errors.push(`${w}.research must be an object`);
      else {
        if (r.logo != null && (typeof r.logo !== "string" || !/^https:\/\//.test(r.logo))) errors.push(`${w}.research.logo must be a full https URL of your logo image`);
        for (const k of ["competitors", "competitorNames", "aliases", "engines", "sameAs"]) if (r[k] != null && (!Array.isArray(r[k]) || r[k].some((x) => typeof x !== "string"))) errors.push(`${w}.research.${k} must be a list of strings`);
        if (Array.isArray(r.engines) && r.engines.some((e) => !["perplexity", "openai", "anthropic", "gemini"].includes(e))) errors.push(`${w}.research.engines may list perplexity, openai, anthropic and gemini`);
        if (r.market != null && (typeof r.market !== "string" || !/^[A-Za-z]{2}$/.test(r.market))) errors.push(`${w}.research.market must be a two-letter country code, for example "GB" or "US"`);
        if (r.aiRuns != null && (!Number.isInteger(r.aiRuns) || r.aiRuns < 1 || r.aiRuns > 5)) errors.push(`${w}.research.aiRuns must be a whole number from 1 to 5`);
        if (r.serpLimit != null && (!Number.isInteger(r.serpLimit) || r.serpLimit < 1 || r.serpLimit > 200)) errors.push(`${w}.research.serpLimit must be a whole number from 1 to 200`);
      }
    }
    if (s.redirects != null) {
      if (typeof s.redirects !== "object" || Array.isArray(s.redirects)) errors.push(`${w}.redirects must be an object`);
      else if (s.redirects.format != null && !["apache", "nginx", "netlify", "vercel"].includes(s.redirects.format)) errors.push(`${w}.redirects.format must be apache, nginx, netlify or vercel`);
    }
    if (s.review != null) {
      if (typeof s.review !== "object" || Array.isArray(s.review)) errors.push(`${w}.review must be an object`);
      else {
        if (s.review.requireFields != null && (!Array.isArray(s.review.requireFields) || s.review.requireFields.some((f) => typeof f !== "string"))) errors.push(`${w}.review.requireFields must be a list of field names`);
        const tp = s.review.topics;
        if (tp != null && !Array.isArray(tp) && (typeof tp !== "object" || Object.values(tp).some((v) => !Array.isArray(v)))) errors.push(`${w}.review.topics must be an object of keyword lists, for example {"health": ["symptom\w*"]}`);
      }
    }
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
      redirects: abs(site.redirects?.file ?? join(dataDir, raw.sites.length > 1 ? `redirects-${site.id}.json` : "redirects.json")),
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
