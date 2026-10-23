// Local business checks (the local pack's data). Pure: pass in what each page shows, get findings back.
//  - NAP consistency: the business name, address and phone in markup, tel: links and visible text must agree everywhere.
//    Search engines and AI tools trust a business more when every mention matches; a stray old number splits that trust.
//  - LocalBusiness markup completeness (Google: name and address required; telephone, opening hours, geo, url recommended).
//  - Location pages: near-identical pages with only the town swapped are doorway pages (Google spam policy), and thin ones
//    rarely rank. Never assumes one country: phones are compared by digits, addresses by normalised text.
import { jaccard } from "./text.mjs";

const LOCAL = /LocalBusiness|Dentist|Physician|MedicalClinic|Store|Restaurant|ProfessionalService|LegalService|Attorney|HomeAndConstructionBusiness|AutomotiveBusiness|FoodEstablishment|HealthAndBeautyBusiness|LodgingBusiness|RealEstateAgent|Plumber|Electrician|Locksmith|RoofingContractor|HVACBusiness|Bakery|CafeOrCoffeeShop/;
export const LOCATION_PATH = /\/(locations?|areas?|service-areas?|branches|branch|offices?|stores?|near-me|near|cities|city|towns?)(\/|$)/i;

const flat = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const typesOf = (n) => flat(n?.["@type"]).map(String);

/** A phone number as comparable digits: its last 9, so +44 20 7946 0000, 0044 20 7946 0000 and 020 7946 0000 compare equal
 *  whatever the country code's length. Shorter numbers keep all their digits; under 6 digits is not a phone. */
export function phoneKey(p) {
  const d = String(p || "").replace(/\D/g, "");
  return d.length < 6 ? "" : d.slice(-9);
}

/** Address as comparable text: lower case, punctuation and repeated spaces removed, common abbreviations expanded. */
export function addressKey(a) {
  const s = typeof a === "string" ? a : a && typeof a === "object" ? [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry?.name || a.addressCountry].filter(Boolean).join(" ") : "";
  return s.toLowerCase().replace(/[.,#]/g, " ").replace(/\bst\b/g, "street").replace(/\brd\b/g, "road").replace(/\bave?\b/g, "avenue").replace(/\s+/g, " ").trim();
}

export const nameKey = (n) => String(n || "").toLowerCase().replace(/\b(ltd|limited|llc|inc|plc|gmbh|co)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The local-business nodes in a page's JSON-LD (nested @graph included). */
export function businessNodes(nodes = []) {
  const out = [];
  const walk = (n) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) return n.forEach(walk); if (typesOf(n).some((t) => LOCAL.test(t))) out.push(n); flat(n["@graph"]).forEach(walk); };
  walk(nodes);
  return out;
}

/** Phone numbers a page shows: tel: links, and number-like runs in the visible text. */
export function phonesOnPage(html = "", text = "") {
  const found = new Set();
  for (const m of String(html).matchAll(/href=["']tel:([^"']+)["']/gi)) found.add(decodeURIComponent(m[1]));
  for (const m of String(text).matchAll(/(?:\+|\b0)[\d\s().-]{8,18}\d/g)) found.add(m[0].trim());
  return [...found].filter((p) => phoneKey(p));
}

/** What one page says about the business. */
export function pageFacts({ url, html = "", text = "", nodes = [], words = 0 }) {
  const biz = businessNodes(nodes);
  return {
    url, words,
    markup: biz.map((n) => ({ type: typesOf(n).find((t) => LOCAL.test(t)), name: n.name || null, phone: n.telephone || null, address: n.address || null, hours: !!(n.openingHours || n.openingHoursSpecification), geo: !!n.geo, url: n.url || null })),
    phones: phonesOnPage(html, text),
    hasMap: /google\.[a-z.]+\/maps|maps\.google\.|openstreetmap\.org|maps\.apple\.com|bing\.com\/maps/i.test(html),
    text,
  };
}

const variants = (items, key) => {
  const m = new Map();
  for (const { value, url } of items) { const k = key(value); if (!k) continue; if (!m.has(k)) m.set(k, { value, pages: [] }); if (!m.get(k).pages.includes(url)) m.get(k).pages.push(url); }
  return [...m.values()].sort((a, b) => b.pages.length - a.pages.length);
};

/** Findings across the site. pages: pageFacts[]. owner: optional { name, phone, address } the owner confirmed. */
export function analyseLocal(pages = [], { owner = {} } = {}) {
  const findings = [];
  const marks = pages.flatMap((p) => p.markup.map((m) => ({ ...m, url: p.url })));
  const names = variants(marks.map((m) => ({ value: m.name, url: m.url })), nameKey);
  const phones = variants([...marks.map((m) => ({ value: m.phone, url: m.url })), ...pages.flatMap((p) => p.phones.map((value) => ({ value, url: p.url })))], phoneKey);
  const addresses = variants(marks.map((m) => ({ value: m.address, url: m.url })), addressKey);
  const locations = pages.filter((p) => LOCATION_PATH.test(new URL(p.url).pathname));
  // A site with branches has one address per location page; only main-site disagreements count as inconsistent.
  const multi = addresses.length > 1 && locations.length >= addresses.length - 1;

  if (!marks.length) findings.push({ id: "no-local-markup", severity: "medium", title: "No LocalBusiness markup on the pages checked", detail: "Add LocalBusiness (or a more specific type such as Dentist or LegalService) with name, address and telephone to the home or contact page.", pages: [] });
  if (names.length > 1) findings.push({ id: "name-variants", severity: "medium", title: `The business name appears in ${names.length} forms in markup`, detail: names.map((v) => `"${v.value}" on ${v.pages.length} page(s)`).join("; "), pages: names.slice(1).flatMap((v) => v.pages) });
  if (phones.length > 1 && !multi) findings.push({ id: "phone-variants", severity: "high", title: `${phones.length} different phone numbers appear on the site`, detail: phones.map((v) => `${v.value} on ${v.pages.length} page(s)`).join("; ") + ". If only one is current, replace the others; if several are real (departments, branches), make sure each listing uses the right one.", pages: phones.slice(1).flatMap((v) => v.pages) });
  if (addresses.length > 1 && !multi) findings.push({ id: "address-variants", severity: "high", title: `The address is written ${addresses.length} different ways in markup`, detail: addresses.map((v) => `"${addressKey(v.value)}" on ${v.pages.length} page(s)`).join("; "), pages: addresses.slice(1).flatMap((v) => v.pages) });
  for (const [field, list, key] of [["phone", phones, phoneKey], ["address", addresses, addressKey], ["name", names, nameKey]]) {
    if (owner[field] && list.length && !list.some((v) => key(v.value) === key(owner[field]))) findings.push({ id: `${field}-not-owner`, severity: "high", title: `No page shows the ${field} the owner confirmed`, detail: `Confirmed: ${owner[field]}. Found: ${list.map((v) => String(typeof v.value === "object" ? addressKey(v.value) : v.value)).join("; ")}`, pages: list.flatMap((v) => v.pages) });
  }
  const incomplete = marks.filter((m) => !m.address || !m.phone || !m.hours || !m.geo);
  if (incomplete.length) findings.push({ id: "markup-incomplete", severity: "low", title: `${incomplete.length} LocalBusiness block(s) miss recommended fields`, detail: incomplete.slice(0, 5).map((m) => `${m.url}: missing ${["address", "phone", "hours", "geo"].filter((f) => !m[f]).join(", ")}`).join("; "), pages: [...new Set(incomplete.map((m) => m.url))] });

  // Location pages: thin, no local facts, or near-duplicates of each other once the place name is ignored.
  const thin = locations.filter((p) => p.words && p.words < 300);
  if (thin.length) findings.push({ id: "location-thin", severity: "medium", title: `${thin.length} location page(s) have under 300 words`, detail: thin.slice(0, 6).map((p) => `${p.url} (${p.words} words)`).join("; ") + ". Add what is really local: the team there, services offered there, directions, local proof the owner can confirm.", pages: thin.map((p) => p.url) });
  const bare = locations.filter((p) => !p.markup.length && !p.hasMap);
  if (bare.length) findings.push({ id: "location-no-facts", severity: "low", title: `${bare.length} location page(s) show no address markup or map`, detail: bare.slice(0, 6).map((p) => p.url).join("; "), pages: bare.map((p) => p.url) });
  const pairs = [];
  const shingles = locations.map((p) => {
    const place = new URL(p.url).pathname.split("/").filter(Boolean).pop()?.split("-") || [];
    const toks = String(p.text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !place.includes(w));
    return new Set(toks.slice(0, 3000).map((w, i) => `${w} ${toks[i + 1] || ""} ${toks[i + 2] || ""}`));
  });
  for (let i = 0; i < locations.length; i++) for (let j = i + 1; j < locations.length; j++) {
    if (shingles[i].size < 30 || shingles[j].size < 30) continue;
    const sim = jaccard(shingles[i], shingles[j]);
    if (sim >= 0.8) pairs.push({ a: locations[i].url, b: locations[j].url, similarity: Math.round(sim * 100) / 100 });
  }
  if (pairs.length) findings.push({ id: "location-duplicates", severity: "high", title: `${pairs.length} pair(s) of location pages are near-identical apart from the place name`, detail: pairs.slice(0, 6).map((p) => `${p.a} ≈ ${p.b} (${Math.round(p.similarity * 100)}% the same)`).join("; ") + ". Google treats swapped-town templates as doorway pages. Merge them, or give each page real local substance.", pages: [...new Set(pairs.flatMap((p) => [p.a, p.b]))] });

  return {
    checked: pages.length, locationPages: locations.length,
    nap: { names: names.map((v) => ({ value: v.value, pages: v.pages.length })), phones: phones.map((v) => ({ value: v.value, pages: v.pages.length })), addresses: addresses.map((v) => ({ value: addressKey(v.value), pages: v.pages.length })), multiLocation: multi },
    duplicates: pairs, findings,
  };
}

export function localMarkdown({ siteName, result, skipped = [] }) {
  const L = [`# Local business check: ${siteName}`, "", `Checked ${result.checked} page(s), of which ${result.locationPages} look like location pages.${result.nap.multiLocation ? " Several addresses appear on location pages, so this is treated as a business with branches." : ""}`, ""];
  L.push("## Name, address, phone as the site shows them", "");
  for (const [label, list] of [["Name", result.nap.names], ["Phone", result.nap.phones], ["Address", result.nap.addresses]]) L.push(`- **${label}:** ${list.length ? list.map((v) => `${v.value} (${v.pages} page${v.pages === 1 ? "" : "s"})`).join("; ") : "none found"}`);
  L.push("", "## Findings", "");
  if (!result.findings.length) L.push("Nothing to fix on the pages checked.");
  for (const f of result.findings) L.push(`### ${f.severity.toUpperCase()}: ${f.title}`, "", f.detail, "");
  if (skipped.length) L.push("## Could not check", "", ...skipped.map((s) => `- ${s.url}: ${s.error}`), "");
  L.push("Listings outside the site (Google Business Profile, directories) are not checked here: the seo-local-citation-auditor compares them by hand with this report.");
  return L.join("\n") + "\n";
}
