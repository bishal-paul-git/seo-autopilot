// What a website says about itself, read from its own pages: business name, contact details, address, social profiles,
// key pages and topics. Pure (no network): the caller passes the raw HTML of a few pages plus the crawl records. Every
// value carries the URL it came from, and nothing is guessed: a field the site does not state stays empty.

const ORG_TYPES = /Organization|LocalBusiness|Corporation|Store|Restaurant|Dentist|Attorney|LegalService|ProfessionalService|MedicalBusiness|HomeAndConstructionBusiness|AutomotiveBusiness|FinancialService|RealEstateAgent|EducationalOrganization|NGO|Plumber|Electrician|Locksmith|HVACBusiness/;
const SOCIAL = [
  ["Facebook", /(^|\.)facebook\.com$/], ["Instagram", /(^|\.)instagram\.com$/], ["LinkedIn", /(^|\.)linkedin\.com$/],
  ["X", /(^|\.)(x|twitter)\.com$/], ["YouTube", /(^|\.)youtube\.com$/], ["TikTok", /(^|\.)tiktok\.com$/],
  ["Pinterest", /(^|\.)pinterest\.[a-z.]+$/], ["GitHub", /(^|\.)github\.com$/], ["Threads", /(^|\.)threads\.net$/],
];
const SHARE_PATH = /\/(sharer|share|intent|dialog|plugins)\b|[?&](u|url|text)=/i; // share buttons are not the site's own profile
const KEY_PAGES = [
  ["contact", /\/(contact|contact-us|get-in-touch)\/?$/i], ["about", /\/(about|about-us|who-we-are)\/?$/i],
  ["services", /\/(services|what-we-do|solutions)\/?$/i], ["pricing", /\/(pricing|prices|plans)\/?$/i],
  ["blog", /\/(blog|news|articles|insights|guides)\/?$/i], ["careers", /\/(careers|jobs)\/?$/i],
  ["privacy", /\/(privacy|privacy-policy)\/?$/i], ["terms", /\/(terms|terms-and-conditions|terms-of-service)\/?$/i],
];

const decode = (s = "") => String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag); return m ? decode(m[1] ?? m[2] ?? "") : ""; };
const metaContent = (html, key) => { for (const m of html.matchAll(/<meta\b[^>]*>/gi)) if (new RegExp(`(?:name|property)\\s*=\\s*["']${key}["']`, "i").test(m[0])) return attr(m[0], "content"); return ""; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return ""; } };

/** Every JSON-LD node (objects with an @type), flattened out of @graph arrays and nesting. */
export function jsonLdNodes(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n["@type"]) out.push(n); for (const v of Object.values(n)) if (v && typeof v === "object") walk(v); } };
    walk(data);
  }
  return out;
}
const types = (n) => [].concat(n["@type"] || []).map(String);
const text = (v) => (typeof v === "string" ? decode(v) : v && typeof v === "object" && typeof v.name === "string" ? decode(v.name) : "");
const urlOf = (v) => (typeof v === "string" ? v : v && typeof v === "object" ? v.url || v["@id"] || "" : "");

/** A phone number as written, if it has enough digits to be one. */
const phone = (s) => { const t = decode(s).replace(/^tel:/i, "").replace(/%20/g, " ").trim(); return (t.match(/\d/g) || []).length >= 7 ? t : ""; };
const email = (s) => { const t = decode(s).replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(t) && !/\.(png|jpe?g|gif|webp|svg)$/.test(t) && !/example\.(com|org)$|sentry|wixpress/.test(t) ? t : ""; };

function add(list, value, source, extra = {}) {
  if (!value) return;
  const key = String(value).toLowerCase().replace(/\s+/g, "");
  if (!list.some((x) => String(x.value).toLowerCase().replace(/\s+/g, "") === key)) list.push({ value, source, ...extra });
}

function address(a) {
  if (!a || typeof a !== "object") return typeof a === "string" ? decode(a) : "";
  return [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, text(a.addressCountry) || a.addressCountry].filter((x) => typeof x === "string" && x.trim()).map(decode).join(", ");
}

/**
 * docs: [{ url, html }] for the pages read in full (home first, then contact and about if there are any).
 * pages: crawl records ({ url, finalUrl, status, title, h1s, depth, words }).
 */
export function discoverSite({ siteUrl, docs = [], pages = [], sitemapUrls = [], robotsTxt = null }) {
  const home = docs[0] || { url: siteUrl, html: "" };
  const own = hostOf(siteUrl);
  const out = { name: null, description: null, logo: null, language: null, businessTypes: [], emails: [], phones: [], addresses: [], hours: [], socials: [], keyPages: {}, topics: [], stats: {} };

  for (const d of docs) {
    const html = String(d.html || "");
    for (const n of jsonLdNodes(html)) {
      const t = types(n);
      if (!t.some((x) => ORG_TYPES.test(x))) continue;
      for (const x of t) if (!out.businessTypes.includes(x)) out.businessTypes.push(x);
      if (!out.name && text(n.name)) out.name = { value: text(n.name), source: d.url };
      if (!out.logo && urlOf(n.logo)) out.logo = { value: new URL(urlOf(n.logo), d.url).toString(), source: d.url };
      add(out.phones, phone(n.telephone || ""), d.url);
      add(out.emails, email(n.email || ""), d.url);
      for (const a of [].concat(n.address || [])) add(out.addresses, address(a), d.url);
      for (const h of [].concat(n.openingHours || [])) add(out.hours, decode(h), d.url);
      for (const s of [].concat(n.openingHoursSpecification || [])) if (s && s.opens) add(out.hours, `${[].concat(s.dayOfWeek || []).map((x) => String(x).split("/").pop()).join(", ")} ${s.opens}–${s.closes || ""}`.trim(), d.url);
      for (const u of [].concat(n.sameAs || [])) { const h = hostOf(u); const s = SOCIAL.find(([, re]) => re.test(h)); if (s) add(out.socials, u, d.url, { platform: s[0] }); }
    }
    for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
      const href = attr(m[0], "href");
      if (/^mailto:/i.test(href)) add(out.emails, email(href), d.url);
      else if (/^tel:/i.test(href)) add(out.phones, phone(href), d.url);
      else if (/^https?:/i.test(href) && !SHARE_PATH.test(href)) { const h = hostOf(href); const s = SOCIAL.find(([, re]) => re.test(h)); if (s && h !== own) add(out.socials, href.replace(/\/$/, ""), d.url, { platform: s[0] }); }
    }
  }

  const homeHtml = String(home.html || "");
  if (!out.name) { const v = metaContent(homeHtml, "og:site_name"); if (v) out.name = { value: v, source: home.url }; }
  if (!out.name) { // "Page | Brand" or "Brand – tagline": the short part shared with other pages' titles is most likely the brand
    const t = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(homeHtml) || [])[1] || "");
    const parts = t.split(/\s[|–—-]\s/).map((x) => x.trim()).filter(Boolean);
    const others = pages.map((p) => p.title || "").filter(Boolean);
    const shared = parts.find((x) => others.filter((o) => o.includes(x)).length >= 2);
    if (shared || parts.length === 1) out.name = { value: shared || parts[0], source: home.url };
  }
  const desc = metaContent(homeHtml, "description") || metaContent(homeHtml, "og:description");
  if (desc) out.description = { value: desc, source: home.url };
  const lang = (/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i.exec(homeHtml) || [])[1];
  if (lang) out.language = { value: lang, source: home.url };
  if (!out.logo) { const icon = (/<link\b[^>]*rel\s*=\s*["'](?:apple-touch-icon|icon)["'][^>]*>/i.exec(homeHtml) || [])[0]; if (icon && attr(icon, "href")) out.logo = { value: new URL(attr(icon, "href"), home.url).toString(), source: home.url, kind: "icon" }; }

  const ok = pages.filter((p) => p.status === 200);
  for (const [k, re] of KEY_PAGES) { const p = ok.find((x) => re.test(pathOf(x.finalUrl || x.url))); if (p) out.keyPages[k] = p.finalUrl || p.url; }
  const seen = new Set();
  for (const p of ok.filter((x) => x.depth != null && x.depth >= 1 && x.depth <= 2).sort((a, b) => a.depth - b.depth || (b.inbound || 0) - (a.inbound || 0))) {
    const h = decode((p.h1s || [])[0] || ""); const k = h.toLowerCase();
    if (h && h.length <= 90 && !seen.has(k)) { seen.add(k); out.topics.push({ value: h, source: p.finalUrl || p.url }); }
    if (out.topics.length >= 12) break;
  }
  const words = ok.map((p) => p.words || 0);
  out.stats = { pagesRead: ok.length, pagesFailed: pages.length - ok.length, sitemapUrls: sitemapUrls.length, robotsTxt: robotsTxt != null, avgWords: words.length ? Math.round(words.reduce((a, b) => a + b, 0) / words.length) : 0 };
  out.emails = out.emails.slice(0, 6); out.phones = out.phones.slice(0, 6); out.addresses = out.addresses.slice(0, 6); out.socials = out.socials.slice(0, 12); out.hours = out.hours.slice(0, 10);
  return out;
}

/** The few pages worth reading in full for contact details: home, then contact and about pages from the crawl. */
export function pagesToRead(siteUrl, pages = []) {
  const ok = pages.filter((p) => p.status === 200).map((p) => p.finalUrl || p.url);
  const pick = (re) => ok.find((u) => re.test(pathOf(u)));
  return [...new Set([siteUrl, pick(KEY_PAGES[0][1]), pick(KEY_PAGES[1][1])].filter(Boolean))];
}
