// Per-site AEO (answer engine optimisation) tracking config: which buyer questions to ask Google's AI answers and which
// names to look for in them. Pure: no network, no writes. Every bad value throws or is listed; nothing is guessed.
//
//   "aeo": {
//     "prompts": [ { "text": "best apps for a shop", "lang": "en" }, { "text": "...", "lang": "ar" } ],
//     "aliases": ["Brand Name", "brand.example"],          names looked for in answers, in any script (Arabic is normalised)
//     "mode": "ai_mode",                                  ai_mode (default) | ai_overview | llm_responses
//     "schedule": "weekly",                               weekly | daily | monthly | manual
//     "maxCostPerRunUsd": 1                               hard stop for one run, on top of the DataForSEO monthly cap
//   }
//
// The location comes from the site's `market` and each prompt's `lang` must be one of `market.languages`; a prompt without
// `lang` uses the market's main language. Every call goes through the DataForSEO cost guard (src/lib/dataforseo.mjs).
import { resolveMarket, inLanguage, MarketError } from "./market.mjs";

export class AeoError extends Error {
  constructor(message) { super(message); this.name = "AeoError"; }
}

/** What each mode asks DataForSEO for (see docs/aeo.md for prices and the measured comparison). */
export const AEO_MODES = {
  ai_overview: "Google's AI Overview for the question (SERP, loaded asynchronously) and the pages it cites",
  ai_mode: "Google's AI Mode answer (SERP AI Mode endpoint) and the pages it cites",
  llm_responses: "ChatGPT with web search through the LLM Responses API, and the sources it cites",
};
export const AEO_SCHEDULES = { daily: 1, weekly: 7, monthly: 30, manual: null };
export const DEFAULT_MODE = "ai_mode"; // picked from measured results (docs/aeo.md)
export const DEFAULT_SCHEDULE = "weekly";
export const DEFAULT_MAX_COST_PER_RUN_USD = 1;
export const MAX_PROMPTS = 100;
export const MAX_PROMPT_CHARS = 500; // the LLM Responses endpoint allows 500 characters in user_prompt; SERP keywords 700

const KEYS = ["prompts", "aliases", "mode", "schedule", "maxCostPerRunUsd"];
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);

/**
 * Problems with a site's `aeo` block, as messages ([] when fine). `rawMarket` is the site's `market` (to check prompt languages);
 * without one the languages are only checked for shape, and the job refuses to run until a market is set.
 */
export function validateAeo(aeo, where = "aeo", rawMarket = null) {
  const errors = [];
  if (!isObj(aeo)) return [`${where} must be an object, for example {"prompts": [{"text": "…", "lang": "en"}], "aliases": ["Brand"], "mode": "${DEFAULT_MODE}"}`];
  const extra = Object.keys(aeo).filter((k) => !KEYS.includes(k));
  if (extra.length) errors.push(`${where}: unknown key ${extra.map((k) => `"${k}"`).join(", ")}. Allowed: ${KEYS.join(", ")}`);
  if (aeo.mode != null && !Object.hasOwn(AEO_MODES, aeo.mode)) errors.push(`${where}.mode "${aeo.mode}" is not a mode. Use one of: ${Object.keys(AEO_MODES).join(", ")}`);
  if (aeo.schedule != null && !Object.hasOwn(AEO_SCHEDULES, aeo.schedule)) errors.push(`${where}.schedule "${aeo.schedule}" is not a schedule. Use one of: ${Object.keys(AEO_SCHEDULES).join(", ")}`);
  if (aeo.maxCostPerRunUsd != null && (typeof aeo.maxCostPerRunUsd !== "number" || !Number.isFinite(aeo.maxCostPerRunUsd) || aeo.maxCostPerRunUsd <= 0)) errors.push(`${where}.maxCostPerRunUsd must be a number of US dollars above 0`);
  if (aeo.aliases != null && (!Array.isArray(aeo.aliases) || aeo.aliases.some((a) => typeof a !== "string" || a.trim().length < 2))) errors.push(`${where}.aliases must be a list of names (text of 2 or more characters) to look for in answers`);

  let market = null;
  if (rawMarket != null) { try { market = resolveMarket(rawMarket, where); } catch (e) { if (!(e instanceof MarketError)) throw e; /* the market's own error is reported by the market check */ } }
  if (!Array.isArray(aeo.prompts) || aeo.prompts.length === 0) errors.push(`${where}.prompts must be a non-empty list of { "text", "lang" } (or plain text for the market's main language)`);
  else {
    if (aeo.prompts.length > MAX_PROMPTS) errors.push(`${where}.prompts has ${aeo.prompts.length} entries; the most allowed is ${MAX_PROMPTS}`);
    for (const [i, p] of aeo.prompts.entries()) {
      const w = `${where}.prompts[${i}]`;
      const text = typeof p === "string" ? p : p?.text;
      if (typeof p !== "string" && !isObj(p)) { errors.push(`${w} must be text or { "text", "lang" }`); continue; }
      if (isObj(p)) { const x = Object.keys(p).filter((k) => !["text", "lang"].includes(k)); if (x.length) errors.push(`${w}: unknown key ${x.map((k) => `"${k}"`).join(", ")}. Allowed: text, lang`); }
      if (typeof text !== "string" || !text.trim()) errors.push(`${w}.text must be the question to ask`);
      else if (text.length > MAX_PROMPT_CHARS) errors.push(`${w}.text is ${text.length} characters; the most allowed is ${MAX_PROMPT_CHARS}`);
      if (isObj(p) && p.lang != null) {
        if (typeof p.lang !== "string" || !/^[a-z]{2}$/.test(p.lang)) errors.push(`${w}.lang must be a two-letter language code such as "ar" or "en"`);
        else if (market) { try { inLanguage(market, p.lang); } catch (e) { if (!(e instanceof MarketError)) throw e; errors.push(`${w}.lang: ${e.message}`); } }
      }
    }
  }
  return errors;
}

/**
 * The AEO settings of a site with defaults applied, or null when the site has no `aeo` block. Throws AeoError (listing every
 * problem) for a bad block and MarketError when the site has no market. `site.market` must be set: nothing is assumed.
 */
export function resolveAeo(site) {
  const aeo = site?.aeo;
  if (aeo == null) return null;
  const errors = validateAeo(aeo, `${site.id || "site"}.aeo`, site.market);
  if (errors.length) throw new AeoError(`aeo config has problems:\n- ${errors.join("\n- ")}`);
  const market = resolveMarket(site.market, site.id || "site");
  return {
    market,
    mode: aeo.mode || DEFAULT_MODE,
    schedule: aeo.schedule || DEFAULT_SCHEDULE,
    maxCostPerRunUsd: aeo.maxCostPerRunUsd ?? DEFAULT_MAX_COST_PER_RUN_USD,
    aliases: [...new Set((aeo.aliases || []).map((a) => a.trim()))],
    prompts: aeo.prompts.map((p) => {
      const text = (typeof p === "string" ? p : p.text).trim();
      return { text, lang: (isObj(p) && p.lang) || market.languageCode };
    }),
  };
}
