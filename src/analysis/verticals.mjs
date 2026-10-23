// Vertical packs: specialist agents for a kind of business (local, e-commerce). Pure: detection reads the site profile and the
// site config; the pack list lives in departments/verticals/packs.json so agents and packs stay in one place.
// A site's own `verticals` setting wins over detection: ["local"] forces the local pack on, [] turns every pack off.
import { readFileSync } from "node:fs";

export const PACKS = JSON.parse(readFileSync(new URL("../../departments/verticals/packs.json", import.meta.url), "utf8"));

const LOCAL_TYPES = /LocalBusiness|Dentist|Physician|MedicalClinic|Store|Restaurant|ProfessionalService|LegalService|Attorney|HomeAndConstructionBusiness|AutomotiveBusiness|FoodEstablishment|HealthAndBeautyBusiness|LodgingBusiness|RealEstateAgent/;
const SHOP_TYPES = /^(Product|Offer|AggregateOffer|ProductGroup)$/;
const SHOP_PLATFORMS = /Shopify|WooCommerce|Magento|BigCommerce|PrestaShop|Squarespace Commerce|Wix Stores/i;

/** Which packs apply to a site, each with the evidence. Returns [{ pack, why: [..], forced }]. */
export function detectVerticals({ profile = null, site = {} } = {}) {
  if (Array.isArray(site.verticals)) return site.verticals.filter((p) => PACKS[p]).map((pack) => ({ pack, why: ["set in seo-autopilot.config.json (verticals)"], forced: true }));
  const types = profile?.signals?.structuredData || [];
  const out = [];
  const local = types.filter((t) => LOCAL_TYPES.test(t));
  if (local.length || site.local) out.push({ pack: "local", why: [...(site.local ? ["local: true in the config"] : []), ...local.map((t) => `${t} markup on the home page`)], forced: false });
  const shop = types.filter((t) => SHOP_TYPES.test(t)), platform = profile?.platform?.name || "";
  if (shop.length || SHOP_PLATFORMS.test(platform)) out.push({ pack: "ecommerce", why: [...(SHOP_PLATFORMS.test(platform) ? [`runs on ${platform}`] : []), ...shop.map((t) => `${t} markup`)], forced: false });
  return out;
}

/** Agent names of the given packs. */
export const packAgents = (packs) => packs.flatMap((p) => Object.keys(PACKS[p]?.agents || {}));

/** Every agent that belongs to some pack (the rest are core and always installed). */
export const ALL_PACK_AGENTS = new Set(packAgents(Object.keys(PACKS)));

/**
 * Which pack agents to install for a project. A pack is installed when some site sets it in `verticals`, and every pack is
 * installed when any site has no `verticals` setting (detection then decides at run time, so nothing is missing).
 */
export function packsToInstall(sites = []) {
  if (!sites.length || sites.some((s) => !Array.isArray(s.verticals))) return Object.keys(PACKS);
  return [...new Set(sites.flatMap((s) => s.verticals.filter((p) => PACKS[p])))];
}
