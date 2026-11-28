// Resolved markets for tests. The code has no default market, so every test that reaches a provider says which one it uses.
import { resolveMarket } from "../src/lib/market.mjs";

const mk = (location_code, language_code, extra = {}) => resolveMarket({ location_code, language_code, ...extra }, "test");
export const UK = mk(2826, "en");
export const US = mk(2840, "en");
export const DE = mk(2276, "de");
export const SA_AR = mk(2682, "ar", { languages: ["ar", "en"] });
export const SA_EN = { ...SA_AR, languageCode: "en" };
/** The config block a site would carry for each, for tests that go through a job. */
export const CONFIG = { UK: { location_code: 2826, language_code: "en" }, SA: { location_code: 2682, language_code: "ar", languages: ["ar", "en"] } };
