// The market a site is researched in: a location and a language, read from the site's config and nothing else.
// Pure: no network, no writes. Every provider call (SERP, keyword data, autocomplete, video, Wikipedia, Keyword Planner) takes
// its location and language from here. A market that is wrong or unknown throws before any request. A site with no market at all
// keeps the old behaviour (United Kingdom, English) but is flagged `assumed`, warned about and shown as such in reports and doctor.
//
// Config (per site):
//   "market": { "location_code": 2682, "language_code": "ar", "languages": ["ar", "en"] }
//   "market": { "location": "Saudi Arabia", "languages": ["ar", "en"] }          (name or two-letter country code)
//   location_code is the DataForSEO location code, which is also the Google Ads geo target id.
//   languages: the first is the primary one; language_code, when given, must be that first one.
//   country: a two-letter country code, needed only when location_code is not in the table below (a city, say).
import { detectLanguage } from "../analysis/scope.mjs";

export class MarketError extends Error {
  constructor(message) { super(message); this.name = "MarketError"; }
}

// [location_code, country, name, ...aliases]. Country-level codes from Google's geo target list (the codes DataForSEO uses).
// A code that is not here is still accepted (cities, regions) when the config names its `country`.
const TABLE = [
  [2840, "US", "United States", "usa", "united states of america"], [2826, "GB", "United Kingdom", "uk", "great britain", "england"],
  [2124, "CA", "Canada"], [2036, "AU", "Australia"], [2554, "NZ", "New Zealand"], [2372, "IE", "Ireland"], [2710, "ZA", "South Africa"],
  [2682, "SA", "Saudi Arabia", "ksa"], [2784, "AE", "United Arab Emirates", "uae"], [2818, "EG", "Egypt"], [2414, "KW", "Kuwait"],
  [2634, "QA", "Qatar"], [2048, "BH", "Bahrain"], [2512, "OM", "Oman"], [2400, "JO", "Jordan"], [2422, "LB", "Lebanon"],
  [2368, "IQ", "Iraq"], [2504, "MA", "Morocco"], [2012, "DZ", "Algeria"], [2788, "TN", "Tunisia"],
  [2276, "DE", "Germany"], [2250, "FR", "France"], [2724, "ES", "Spain"], [2380, "IT", "Italy"], [2528, "NL", "Netherlands"],
  [2056, "BE", "Belgium"], [2756, "CH", "Switzerland"], [2040, "AT", "Austria"], [2620, "PT", "Portugal"], [2616, "PL", "Poland"],
  [2752, "SE", "Sweden"], [2578, "NO", "Norway"], [2208, "DK", "Denmark"], [2246, "FI", "Finland"], [2300, "GR", "Greece"],
  [2203, "CZ", "Czechia", "czech republic"], [2642, "RO", "Romania"], [2348, "HU", "Hungary"], [2792, "TR", "Turkey", "turkiye"],
  [2643, "RU", "Russia"], [2804, "UA", "Ukraine"], [2376, "IL", "Israel"],
  [2356, "IN", "India"], [2586, "PK", "Pakistan"], [2392, "JP", "Japan"], [2410, "KR", "South Korea", "korea"], [2702, "SG", "Singapore"],
  [2458, "MY", "Malaysia"], [2360, "ID", "Indonesia"], [2608, "PH", "Philippines"], [2764, "TH", "Thailand"], [2704, "VN", "Vietnam"],
  [2344, "HK", "Hong Kong"], [2158, "TW", "Taiwan"],
  [2076, "BR", "Brazil"], [2484, "MX", "Mexico"], [2032, "AR", "Argentina"], [2170, "CO", "Colombia"], [2152, "CL", "Chile"],
  [2566, "NG", "Nigeria"], [2404, "KE", "Kenya"],
];

export const LOCATIONS = TABLE.map(([code, country, name]) => ({ code, country, name }));
const byCode = new Map(TABLE.map((r) => [r[0], r]));
const byName = new Map(TABLE.flatMap((r) => [[r[2].toLowerCase(), r], ...r.slice(3).map((a) => [a, r])]));
const byCountry = new Map(TABLE.map((r) => [r[1], r]));

// ISO 639-1 code -> name and the Google Ads language constant id (the Keyword Planner needs the id).
export const LANGUAGES = {
  en: ["English", 1000], de: ["German", 1001], fr: ["French", 1002], es: ["Spanish", 1003], it: ["Italian", 1004], ja: ["Japanese", 1005],
  da: ["Danish", 1009], nl: ["Dutch", 1010], fi: ["Finnish", 1011], ko: ["Korean", 1012], no: ["Norwegian", 1013], pt: ["Portuguese", 1014],
  sv: ["Swedish", 1015], ar: ["Arabic", 1019], cs: ["Czech", 1021], el: ["Greek", 1022], hi: ["Hindi", 1023], hu: ["Hungarian", 1024],
  id: ["Indonesian", 1025], he: ["Hebrew", 1027], pl: ["Polish", 1030], ru: ["Russian", 1031], ro: ["Romanian", 1032], uk: ["Ukrainian", 1036],
  tr: ["Turkish", 1037], vi: ["Vietnamese", 1040], ur: ["Urdu", 1041], th: ["Thai", 1044],
};

const EXAMPLE = '"market": { "location_code": 2682, "language_code": "ar", "languages": ["ar", "en"] }';
const NAMES = "docs/configuration.md#market lists the supported location names and languages";

/** A location from a DataForSEO code (number or digits), a country name, or a two-letter country code. Throws MarketError. */
export function parseLocation(value, key = "market.location") {
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value.trim()))) {
    const code = Number(value);
    if (!Number.isInteger(code) || code <= 0) throw new MarketError(`${key}: ${JSON.stringify(value)} is not a valid location code. Use the DataForSEO location code, for example 2682 for Saudi Arabia.`);
    const row = byCode.get(code);
    return { code, country: row ? row[1] : null, name: row ? row[2] : null };
  }
  if (typeof value !== "string" || !value.trim()) throw new MarketError(`${key}: missing. Example: ${EXAMPLE}`);
  const v = value.trim();
  const row = /^[A-Za-z]{2}$/.test(v) ? byCountry.get(v.toUpperCase() === "UK" ? "GB" : v.toUpperCase()) : byName.get(v.toLowerCase());
  if (!row) throw new MarketError(`${key}: unknown location ${JSON.stringify(v)}. Use a country name such as "Saudi Arabia", a two-letter country code such as "SA", or the numeric DataForSEO location_code (${NAMES}).`);
  return { code: row[0], country: row[1], name: row[2] };
}

/** An ISO 639-1 language code ("ar"), lower-cased. Throws MarketError for anything else or an unsupported language. */
export function parseLanguage(value, key = "market.language_code") {
  if (typeof value !== "string" || !/^[A-Za-z]{2}$/.test(value.trim())) throw new MarketError(`${key}: ${JSON.stringify(value)} is not a two-letter language code such as "ar" or "en" (${NAMES}).`);
  const code = value.trim().toLowerCase();
  if (!LANGUAGES[code]) throw new MarketError(`${key}: language ${JSON.stringify(code)} is not supported. Supported: ${Object.keys(LANGUAGES).join(", ")}.`);
  return code;
}

/**
 * Check and normalise a site's `market` block. `owner` only labels errors ("sites[0]" or the site id).
 * Returns { locationCode, locationName, country, languageCode, languages } (languageCode is the primary language).
 */
export function resolveMarket(raw, owner = "site") {
  const where = `${owner}.market`;
  if (raw == null) throw new MarketError(`${where}: missing. Every site needs an explicit market (a location and a language); nothing is assumed. Add it to seo-autopilot.config.json, for example ${EXAMPLE}`);
  if (typeof raw !== "object" || Array.isArray(raw)) throw new MarketError(`${where}: must be an object, for example ${EXAMPLE}`);
  const known = ["location_code", "location", "country", "language_code", "languages"];
  const extra = Object.keys(raw).filter((k) => !known.includes(k));
  if (extra.length) throw new MarketError(`${where}: unknown key ${extra.map((k) => `"${k}"`).join(", ")}. Allowed: ${known.join(", ")}.`);
  if (raw.location_code != null && raw.location != null) throw new MarketError(`${where}: give either location_code or location, not both.`);
  const loc = parseLocation(raw.location_code ?? raw.location, raw.location_code != null ? `${where}.location_code` : `${where}.location`);
  let country = loc.country;
  if (raw.country != null) {
    if (typeof raw.country !== "string" || !/^[A-Za-z]{2}$/.test(raw.country)) throw new MarketError(`${where}.country: must be a two-letter country code such as "SA".`);
    const c = raw.country.toUpperCase();
    if (country && c !== country) throw new MarketError(`${where}.country: "${c}" disagrees with location ${loc.code} (${loc.name}, ${country}). Remove country; it is only for locations outside the built-in table.`);
    country = c;
  }
  if (!country) throw new MarketError(`${where}.country: location ${loc.code} is not in the built-in table, so name its two-letter country code too, for example "country": "SA".`);
  let languages;
  if (raw.languages != null) {
    if (!Array.isArray(raw.languages) || !raw.languages.length) throw new MarketError(`${where}.languages: must be a non-empty list of language codes, the primary one first, for example ["ar", "en"].`);
    languages = [...new Set(raw.languages.map((l, i) => parseLanguage(l, `${where}.languages[${i}]`)))];
  }
  const primary = raw.language_code != null ? parseLanguage(raw.language_code, `${where}.language_code`) : languages?.[0];
  if (!primary) throw new MarketError(`${where}.language_code: missing. Name the language the site is researched in, for example "ar" or "en".`);
  if (languages && languages[0] !== primary) throw new MarketError(`${where}: language_code "${primary}" is not the first of languages [${languages.map((l) => `"${l}"`).join(", ")}]. The first language is the primary one.`);
  return { locationCode: loc.code, locationName: loc.name || `location ${loc.code}`, country, languageCode: primary, languages: languages || [primary] };
}

/** Whether a value is already a resolved market for one call (what providers take). */
export const isCallMarket = (m) => Boolean(m) && typeof m === "object" && Number.isInteger(m.locationCode) && typeof m.country === "string" && typeof m.languageCode === "string";

/** What a provider receives: its market, or a clear error. Strings such as "GB" are refused so no caller falls back to a default. */
export function requireMarket(m, who = "provider") {
  if (!isCallMarket(m)) throw new MarketError(`${who}: no market given. Pass the site's market (resolveMarket(site.market)), never a bare country code; nothing is assumed. Example config: ${EXAMPLE}`);
  return m;
}

/** The same market for one language of the site (it must be one of market.languages). */
export function inLanguage(market, language) {
  requireMarket(market, "market");
  if (language == null) return market;
  const l = parseLanguage(language, "language");
  if (!market.languages.includes(l)) throw new MarketError(`language: "${l}" is not one of this site's languages [${market.languages.map((x) => `"${x}"`).join(", ")}]. Add it to market.languages, or choose one of those.`);
  return { ...market, languageCode: l };
}

/** The language to research a piece of text in: the explicit one, else the one the text is clearly in (if the site has it), else the primary. */
export function languageFor(market, text, explicit) {
  if (explicit != null) return inLanguage(market, explicit);
  const got = detectLanguage(text);
  return got && got !== market.languageCode && market.languages.includes(got) ? { ...market, languageCode: got } : market;
}

/** What providers used before `market` existed: the United Kingdom in English. Only ever used when a site sets no market, and never silently. */
const LEGACY = { locationCode: 2826, locationName: "United Kingdom", country: "GB", languageCode: "en", languages: ["en"] };
const warned = new Set();
const legacyNote = (id, from) => `site "${id}": no "market" in the config, so ${from} and English are used, as before. Set "market" (for example ${EXAMPLE}) to research the site's real country and language.`;

/**
 * The market of a site object (config already loaded). Throws MarketError naming the site when `market` is wrong.
 * With no `market` it keeps the old behaviour (the country in research.market / citations.market, else the United Kingdom, in
 * English), marks the result `assumed: true` (marketLabel then says so) and prints one warning per site and process.
 */
export function siteMarket(site, language) {
  const id = site?.id ?? "?";
  if (site?.market != null) return inLanguage(resolveMarket(site.market, `site "${id}"`), language);
  const old = site?.research?.market ?? site?.citations?.market;
  const which = site?.research?.market != null ? "research.market" : "citations.market";
  const loc = old != null ? parseLocation(old, which) : null;
  const m = { ...LEGACY, ...(loc?.country ? { locationCode: loc.code, locationName: loc.name, country: loc.country } : {}), assumed: true };
  if (!warned.has(id)) { warned.add(id); console.warn(`market: ${legacyNote(id, loc ? `${m.locationName} (from ${which})` : "the United Kingdom")}`); }
  return inLanguage(m, language);
}

/** The same market with another location (a per-question override: a name, country code or location code). */
export function withLocation(market, value, key = "market") {
  requireMarket(market, "market");
  const loc = parseLocation(value, key);
  if (!loc.country) throw new MarketError(`${key}: location ${loc.code} is not in the built-in table, so it cannot be used as an override. Use a country name or code.`);
  return { ...market, locationCode: loc.code, locationName: loc.name, country: loc.country };
}

/**
 * The `--market` flag of init: "<location>:<language>[,<language>...]", for example "2682:ar,en", "SA:ar,en" or "Saudi Arabia:ar".
 * Returns the config block to write (always the numeric location_code) after checking it like any other config.
 */
export function marketFromFlag(spec) {
  const text = String(spec ?? "");
  const cut = text.lastIndexOf(":");
  if (cut < 1 || cut === text.length - 1) throw new MarketError(`--market: expected "<location>:<language>[,<language>]", for example "2682:ar,en" or "Saudi Arabia:ar". Got ${JSON.stringify(text)}.`);
  const loc = parseLocation(text.slice(0, cut).trim(), "--market location");
  const languages = text.slice(cut + 1).split(",").map((x) => x.trim()).filter(Boolean);
  const raw = { location_code: loc.code, language_code: languages[0], ...(languages.length > 1 ? { languages } : {}) };
  resolveMarket(raw, "--market");
  return raw;
}

/** Short text for reports and logs: "Saudi Arabia (2682), ar". */
export const marketLabel = (m) => `${m.locationName} (${m.locationCode}), ${m.languageCode}${m.assumed ? " (assumed: no market in the config)" : ""}`;

/** Google Ads language constant id for the market's language. */
export const adsLanguageId = (m) => LANGUAGES[requireMarket(m, "google-ads").languageCode][1];

/** Google's gl value for a country (Google uses "uk" for the United Kingdom). */
export const googleGl = (m) => (requireMarket(m, "market").country === "GB" ? "uk" : m.country.toLowerCase());
