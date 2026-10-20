// Structured data: check the JSON-LD a page has against what search engines require, against what the page visibly says,
// and draft the markup a page is missing from facts the page itself shows. Pure.
//
// Rules: markup must describe what a visitor can see (Google's structured data policies), so ratings, prices or FAQ answers
// that appear only in the markup are flagged. Drafts are filled only from the page, the config and the URL; anything not
// known is left as a "<fill: ...>" placeholder for a person. Nothing here invents a fact.
import { terms, jaccard } from "./text.mjs";

/** Every JSON-LD node on a page (blocks, arrays and @graph flattened), with a parse-error count. */
export function jsonldNodes(html) {
  const nodes = [];
  let invalid = 0;
  for (const m of String(html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { if (x["@graph"]) walk(x["@graph"]); if (x["@type"]) nodes.push(x); } };
      walk(JSON.parse(m[1].trim()));
    } catch { invalid++; }
  }
  return { nodes, invalid };
}

const types = (n) => [].concat(n["@type"] || []).map(String);
const has = (v) => v != null && v !== "" && !(Array.isArray(v) && !v.length);
const first = (v) => (Array.isArray(v) ? v[0] : v);
const str = (v) => (typeof v === "string" ? v : v?.name || v?.["@id"] || "");

// Required (missing = not eligible) and recommended properties, after Google's rich result documentation.
export const REQUIREMENTS = {
  Article: { required: ["headline"], recommended: ["image", "datePublished", "dateModified", "author"] },
  Product: { required: ["name"], oneOf: [["offers", "review", "aggregateRating"]], recommended: ["image", "description", "brand"] },
  Offer: { required: ["price", "priceCurrency"], recommended: ["availability"] },
  LocalBusiness: { required: ["name", "address"], recommended: ["telephone", "url", "openingHoursSpecification", "geo", "image"] },
  Organization: { required: ["name"], recommended: ["url", "logo", "sameAs"] },
  FAQPage: { required: ["mainEntity"] },
  BreadcrumbList: { required: ["itemListElement"] },
  Event: { required: ["name", "startDate", "location"], recommended: ["endDate", "image", "description", "offers"] },
  JobPosting: { required: ["title", "description", "datePosted", "hiringOrganization", "jobLocation"], recommended: ["validThrough", "employmentType", "baseSalary"] },
  Recipe: { required: ["name", "image"], recommended: ["recipeIngredient", "recipeInstructions", "author", "totalTime"] },
  VideoObject: { required: ["name", "thumbnailUrl", "uploadDate"], recommended: ["description", "duration", "contentUrl"] },
  WebSite: { required: ["name", "url"] },
};
const FAMILY = (t) => (/^(Article|BlogPosting|NewsArticle|TechArticle)$/.test(t) ? "Article" : /(Business|Store|Restaurant|Dentist|Attorney|Plumber|Electrician|Hotel|Clinic|AutoRepair|ProfessionalService)$/.test(t) && t !== "Organization" ? "LocalBusiness" : t);

/** Problems with one node: missing required or recommended properties, and claims the visible page does not back up. */
export function checkNode(n, { text = "", h1 = "", title = "" } = {}) {
  const out = [];
  const t = types(n).map(FAMILY).find((x) => REQUIREMENTS[x]);
  if (!t) return { type: types(n).join(", "), problems: out };
  const r = REQUIREMENTS[t];
  for (const p of r.required || []) if (!has(n[p])) out.push({ level: "error", note: `missing required "${p}"` });
  for (const group of r.oneOf || []) if (!group.some((p) => has(n[p]))) out.push({ level: "error", note: `needs one of ${group.map((p) => `"${p}"`).join(", ")}` });
  for (const p of r.recommended || []) if (!has(n[p])) out.push({ level: "warning", note: `missing recommended "${p}"` });
  const page = String(text).toLowerCase();
  const visible = (v) => { const s = String(v ?? "").toLowerCase().trim(); return !s || page.includes(s); };
  if (t === "Article") {
    if (String(n.headline || "").length > 110) out.push({ level: "warning", note: "headline over 110 characters" });
    if (n.headline && jaccard(terms(n.headline), terms(`${h1} ${title}`)) < 0.3) out.push({ level: "warning", note: `headline "${n.headline}" does not match the visible H1 or title` });
  }
  if (t === "Product" || t === "Offer") {
    for (const o of [].concat(t === "Offer" ? n : n.offers || [])) {
      if (o?.price != null && !visible(o.price) && !visible(Number(o.price).toFixed(2))) out.push({ level: "error", note: `price ${o.price} is in the markup but not on the page` });
      if (t === "Product" && o && !has(o.priceCurrency) && has(o.price)) out.push({ level: "error", note: "offer has a price but no priceCurrency" });
    }
  }
  const rating = n.aggregateRating;
  if (rating?.ratingValue != null && !visible(rating.ratingValue)) out.push({ level: "error", note: `rating ${rating.ratingValue} is in the markup but not shown on the page` });
  if (rating && /^(Organization|LocalBusiness)$/.test(t)) out.push({ level: "warning", note: "ratings a business marks up about itself are not shown as review stars (self-serving reviews)" });
  if (t === "FAQPage") {
    const qs = [].concat(n.mainEntity || []);
    for (const q of qs) {
      if (!q?.acceptedAnswer?.text) out.push({ level: "error", note: `question "${q?.name || "?"}" has no acceptedAnswer.text` });
      else if (q.name && !visible(q.name)) out.push({ level: "error", note: `question "${q.name}" is in the markup but not on the page` });
    }
  }
  if (t === "BreadcrumbList") for (const [i, it] of [].concat(n.itemListElement || []).entries()) if (!it?.position || !(it.name || it.item?.name)) out.push({ level: "error", note: `breadcrumb item ${i + 1} needs position and name` });
  return { type: t, problems: out };
}

/** Question headings followed by an answer in the page's own blocks: the only honest source for FAQ markup. */
export function visibleFaq(blocks = []) {
  const out = [];
  for (let i = 0; i < blocks.length - 1; i++) {
    const q = blocks[i].trim(), a = blocks[i + 1].trim();
    if (/\?$/.test(q) && q.length <= 150 && a.length >= 20 && !/\?$/.test(a)) out.push({ q, a: a.slice(0, 600) });
  }
  return out;
}

const FILL = (what) => `<fill: ${what}>`;

/**
 * Drafts for what a page is missing. page: { url, title, h1, description, published, modified, author, image, blocks, isHome,
 * kind }. ctx: { siteName, siteUrl, logo, sameAs, crumbs: [{ name, url }] }.
 */
export function suggest(page, nodes, ctx) {
  const present = new Set(nodes.flatMap((n) => types(n).map(FAMILY)));
  const out = [];
  if (page.isHome && !present.has("Organization") && !present.has("LocalBusiness")) out.push({ type: "Organization", why: "the home page does not say who the business is", jsonld: { "@context": "https://schema.org", "@type": "Organization", name: ctx.siteName, url: ctx.siteUrl, logo: ctx.logo || FILL("URL of your logo image"), ...(ctx.sameAs?.length ? { sameAs: ctx.sameAs } : { sameAs: [FILL("your official profile URLs, or remove")] }) } });
  if (page.isHome && !present.has("WebSite")) out.push({ type: "WebSite", why: "names the site for search results", jsonld: { "@context": "https://schema.org", "@type": "WebSite", name: ctx.siteName, url: ctx.siteUrl } });
  if (page.kind === "article" && !present.has("Article")) out.push({ type: "Article", why: "the page reads as an article (dated or under a blog or news path)", jsonld: { "@context": "https://schema.org", "@type": "Article", headline: (page.h1 || page.title || "").slice(0, 110), datePublished: page.published || FILL("publication date, YYYY-MM-DD"), ...(page.modified ? { dateModified: page.modified } : {}), author: page.author ? { "@type": "Person", name: page.author } : FILL("author name, as shown on the page"), image: page.image || FILL("main image URL") } });
  if ((ctx.crumbs || []).length >= 2 && !present.has("BreadcrumbList")) out.push({ type: "BreadcrumbList", why: "the page sits below other pages; breadcrumbs show that path in results", jsonld: { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: ctx.crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })) } });
  const faq = visibleFaq(page.blocks || []);
  if (faq.length >= 2 && !present.has("FAQPage")) out.push({ type: "FAQPage", why: `${faq.length} questions with answers are visible on the page. Google shows FAQ results mainly for government and health sites, but the markup still describes the page`, jsonld: { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })) } });
  return out;
}

/** Breadcrumb trail from the URL path, named by the titles of the ancestor pages that exist. */
export function crumbs(url, titles) {
  const u = new URL(url), parts = u.pathname.split("/").filter(Boolean);
  const out = [{ name: titles.get(`${u.origin}/`) || "Home", url: `${u.origin}/` }];
  for (let i = 0; i < parts.length; i++) {
    const path = `${u.origin}/${parts.slice(0, i + 1).join("/")}`;
    const t = titles.get(path) || titles.get(`${path}/`);
    if (t || i === parts.length - 1) out.push({ name: (t || parts[i].replace(/[-_]/g, " ")).split(/\s[|–-]\s/)[0].trim(), url: i === parts.length - 1 ? url : path });
  }
  return out;
}

export function schemaMarkdown({ siteName, results }) {
  const errors = results.reduce((n, r) => n + r.checks.reduce((m, c) => m + c.problems.filter((p) => p.level === "error").length, 0), 0);
  const drafts = results.reduce((n, r) => n + r.suggestions.length, 0);
  const L = [`# ${siteName} structured data`, "", `${results.length} pages checked: ${errors} error(s) in existing markup, ${drafts} suggested addition(s). Markup must describe what the page visibly shows; drafts use only facts from the page and your config, and "<fill: ...>" marks what a person must supply. The seo-schema-engineer applies them.`, ""];
  for (const r of results) {
    const probs = r.checks.flatMap((c) => c.problems.map((p) => `${c.type}: ${p.note}${p.level === "error" ? " **(error)**" : ""}`));
    if (!probs.length && !r.suggestions.length && !r.invalid) continue;
    L.push(`## ${r.url}`);
    if (r.invalid) L.push(`- ${r.invalid} JSON-LD block(s) do not parse **(error)**`);
    L.push(...probs.map((p) => `- ${p}`));
    for (const s of r.suggestions) L.push(`- Add ${s.type}: ${s.why}`, "", "```json", JSON.stringify(s.jsonld, null, 2), "```", "");
  }
  return L.join("\n") + "\n";
}
