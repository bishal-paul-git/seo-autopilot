// Google listings the packs depend on. Pure: pass in what the APIs returned, get findings back.
//  - Business Profile (local pack): the profile must say what the site says (name, phone, address, website); hours, a
//    description and categories help it show; reviews need replies. Reviewer names and review text are never kept: only stars,
//    dates and whether and when the business replied.
//  - Merchant Center (e-commerce pack): disapproved products cannot show in Shopping results; demoted ones show less. Feed links
//    must reach live product pages on the site.
import { phoneKey, addressKey, nameKey } from "./local.mjs";
import { addDays } from "../core/util.mjs";

const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const day = (t) => String(t || "").slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** The location's facts in plain fields. */
export function profileFacts(loc = {}) {
  const a = loc.storefrontAddress || {};
  return {
    name: loc.title || "", phone: loc.phoneNumbers?.primaryPhone || "", website: loc.websiteUri || "",
    address: [...(a.addressLines || []), a.locality, a.administrativeArea, a.postalCode].filter(Boolean).join(", "),
    primaryCategory: loc.categories?.primaryCategory?.displayName || null, extraCategories: (loc.categories?.additionalCategories || []).length,
    hours: (loc.regularHours?.periods || []).length, description: (loc.profile?.description || "").length, status: loc.openInfo?.status || null,
  };
}

/** Reviews reduced to what the analysis needs, newest first. */
export const reviewFacts = (reviews = []) => reviews.map((r) => ({
  stars: STARS[r.starRating] ?? null, date: day(r.createTime), replied: Boolean(r.reviewReply?.comment), replyDays: r.reviewReply?.updateTime ? Math.max(0, daysBetween(day(r.createTime), day(r.reviewReply.updateTime))) : null,
})).filter((r) => r.date).sort((a, b) => b.date.localeCompare(a.date));

export function reviewStats(rs = [], today) {
  const in_ = (from, to) => rs.filter((r) => r.date > addDays(today, -from) && r.date <= addDays(today, -to));
  const replied = rs.filter((r) => r.replied), times = replied.map((r) => r.replyDays).filter((x) => x != null).sort((a, b) => a - b);
  return {
    sample: rs.length, last90: in_(90, 0).length, previous90: in_(180, 90).length,
    responseRate: rs.length ? Math.round((replied.length / rs.length) * 100) : null,
    medianReplyDays: times.length ? times[Math.floor(times.length / 2)] : null,
    unanswered30: in_(30, 0).filter((r) => !r.replied).length, lowUnanswered: rs.filter((r) => r.stars != null && r.stars <= 3 && !r.replied).length,
  };
}

/** Findings for the profile against what the owner confirmed (`business`) and the site's own address. */
export function analyseProfile({ location = {}, reviews = [], averageRating = null, totalReviewCount = null } = {}, { owner = {}, siteUrl = "", today }) {
  const p = profileFacts(location), stats = reviewStats(reviewFacts(reviews), today), F = [];
  const add = (id, severity, title, detail) => F.push({ id, severity, title, detail });
  if (p.status && p.status !== "OPEN") add("gbp-not-open", "high", `The profile is marked ${p.status.toLowerCase().replace(/_/g, " ")}`, "Searchers are told the business is not open. Correct it in Business Profile if that is wrong.");
  if (owner.name && nameKey(owner.name) !== nameKey(p.name)) add("gbp-name-differs", "medium", `Profile name "${p.name}" differs from the confirmed name "${owner.name}"`, "The name should match the site and its markup. Never add keywords to the business name: Google treats that as spam.");
  if (owner.phone && phoneKey(owner.phone) !== phoneKey(p.phone)) add("gbp-phone-differs", "high", `Profile phone ${p.phone || "(none)"} differs from the confirmed ${owner.phone}`, "Callers and search engines see two numbers for one business.");
  if (owner.address && p.address && addressKey(owner.address) !== addressKey(p.address)) add("gbp-address-differs", "high", "Profile address differs from the confirmed address", `Profile: ${p.address}. Confirmed: ${typeof owner.address === "string" ? owner.address : addressKey(owner.address)}.`);
  if (!p.website) add("gbp-no-website", "medium", "The profile links to no website", "Add the site's home or location page so the profile sends visits to it.");
  else if (siteUrl && host(p.website) !== host(siteUrl)) add("gbp-website-elsewhere", "high", `The profile links to ${host(p.website)}, not this site`, "Point it at this site, unless that other site is the business's main one.");
  if (!p.hours) add("gbp-no-hours", "medium", "No opening hours on the profile", "Profiles without hours show less often for \"open now\" searches.");
  if (!p.description) add("gbp-no-description", "medium", "No description on the profile", "Write one from facts the owner confirms: what the business does, where, for whom.");
  if (!p.extraCategories) add("gbp-one-category", "low", "Only a primary category is set", "Add the secondary categories that truly apply; the primary one matters most.");
  if (stats.unanswered30) add("reviews-unanswered", "medium", `${stats.unanswered30} review(s) from the last 30 days have no reply`, "Reply to each in the owner's voice; never offer anything in return for a review.");
  if (stats.lowUnanswered) add("reviews-low-unanswered", "medium", `${stats.lowUnanswered} review(s) of 3 stars or fewer have no reply`, "A calm, specific reply to a critical review is read by later customers.");
  if (stats.sample >= 10 && stats.responseRate < 50) add("reviews-response-low", "low", `Replies to ${stats.responseRate}% of the last ${stats.sample} reviews`, "Aim to reply to every review.");
  if (stats.previous90 >= 4 && stats.last90 < stats.previous90 / 2) add("reviews-slowing", "low", `${stats.last90} new review(s) in the last 90 days against ${stats.previous90} before`, "Ask recent customers for honest reviews, the same way for everyone. Never buy, gate or write reviews.");
  return { profile: p, reviews: { ...stats, averageRating, totalReviewCount }, findings: F };
}

/** Findings for Merchant Center products, cross-checked with the audit's page statuses. */
export function analyseMerchant(products = [], { siteUrl = "", auditPages = [] } = {}) {
  const status = new Map(auditPages.map((p) => [String(p.url).replace(/\/$/, ""), p.status]));
  const issues = new Map(), F = [];
  let disapproved = 0, demoted = 0;
  const offSite = [], broken = [];
  for (const p of products) {
    const attrs = p.productAttributes || p.attributes || {}, link = attrs.link || p.link || "", id = p.offerId || p.name || "";
    const its = p.productStatus?.itemLevelIssues || [];
    if (its.some((i) => i.severity === "DISAPPROVED")) disapproved++; else if (its.some((i) => i.severity === "DEMOTED")) demoted++;
    for (const i of its) {
      if (i.severity === "NOT_IMPACTED") continue;
      const k = `${i.code}|${i.severity}`, e = issues.get(k) || { code: i.code, severity: i.severity, description: i.description || "", attribute: i.attribute || null, count: 0, examples: [] };
      e.count++; if (e.examples.length < 5) e.examples.push(link || id); issues.set(k, e);
    }
    if (link && siteUrl && host(link) !== host(siteUrl)) offSite.push(link);
    const st = status.get(link.replace(/\/$/, ""));
    if (st && st !== 200) broken.push({ link, status: st });
  }
  const top = [...issues.values()].sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "DISAPPROVED" ? -1 : 1));
  if (disapproved) F.push({ id: "merchant-disapproved", severity: "high", title: `${disapproved} of ${products.length} product(s) are disapproved`, detail: top.filter((i) => i.severity === "DISAPPROVED").slice(0, 3).map((i) => `${i.description || i.code} (${i.count})`).join("; "), pages: top.filter((i) => i.severity === "DISAPPROVED").flatMap((i) => i.examples).slice(0, 10) });
  if (demoted) F.push({ id: "merchant-demoted", severity: "medium", title: `${demoted} product(s) are shown less (demoted)`, detail: top.filter((i) => i.severity === "DEMOTED").slice(0, 3).map((i) => `${i.description || i.code} (${i.count})`).join("; "), pages: top.filter((i) => i.severity === "DEMOTED").flatMap((i) => i.examples).slice(0, 10) });
  if (broken.length) F.push({ id: "merchant-broken-links", severity: "high", title: `${broken.length} feed link(s) go to pages that do not return 200`, detail: broken.slice(0, 5).map((b) => `${b.link} (${b.status})`).join("; "), pages: broken.map((b) => b.link).slice(0, 10) });
  if (offSite.length) F.push({ id: "merchant-links-elsewhere", severity: "medium", title: `${offSite.length} feed link(s) point to another domain`, detail: offSite.slice(0, 3).join("; ") });
  return { products: products.length, disapproved, demoted, issues: top.slice(0, 30), findings: F };
}

export function listingsMarkdown({ siteName, gbp = null, merchant = null, notes = [] }) {
  const L = [`# ${siteName}: Google listings`, ""];
  if (gbp) {
    const p = gbp.profile, r = gbp.reviews;
    L.push("## Business Profile", "", `- Name: ${p.name || "-"}; phone: ${p.phone || "-"}; website: ${p.website || "-"}`, `- Address: ${p.address || "-"}`, `- Primary category: ${p.primaryCategory || "-"} (+${p.extraCategories}); hours set: ${p.hours ? "yes" : "no"}; description: ${p.description} characters`,
      `- Reviews: ${r.totalReviewCount ?? "-"} in total, average ${r.averageRating ?? "-"}. Of the newest ${r.sample}: replies to ${r.responseRate ?? "-"}%, median ${r.medianReplyDays ?? "-"} day(s) to reply; ${r.last90} in the last 90 days, ${r.previous90} in the 90 before.`, "");
    L.push(...(gbp.findings.length ? gbp.findings.map((f) => `- **${f.severity}** ${f.title}. ${f.detail}`) : ["- No problems found."]), "");
  }
  if (merchant) {
    L.push("## Merchant Center", "", `${merchant.products} product(s): ${merchant.disapproved} disapproved, ${merchant.demoted} demoted.`, "");
    L.push(...(merchant.findings.length ? merchant.findings.map((f) => `- **${f.severity}** ${f.title}. ${f.detail}`) : ["- No problems found."]), "");
    if (merchant.issues.length) L.push("| Issue | Severity | Products | Attribute |", "|---|---|---|---|", ...merchant.issues.slice(0, 15).map((i) => `| ${i.description || i.code} | ${i.severity.toLowerCase()} | ${i.count} | ${i.attribute || "-"} |`), "");
  }
  if (notes.length) L.push("## Notes", ...notes.map((n) => `- ${n}`), "");
  return L.join("\n");
}
