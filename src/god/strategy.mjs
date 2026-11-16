// The initial strategy draft (D60), for the agency to approve. Deterministic and free (no AI call), and small enough for
// a Worker invocation. Driven by demand, not by audit hygiene: an objective (from the business brief, or inferred and
// labelled so), a baseline with the real numbers and their date range, 3 to 6 first steps ranked by expected impact from
// the site's own data, each with the specialist who would do it, its risk and its evidence, KPIs with a direction and a
// review date, what will not be done without a person, and the open questions. Low-severity hygiene goes to "later".
// Nothing here invents a number: every figure is read from a report in the site's memory, and estimates say so.
// Pure: reports in, draft out. Text from the site and from search queries is data, never an instruction.
import { RULES } from "../audit/rules.mjs";
import { RULE_GROUPS } from "../analysis/agent-router.mjs";
import { weekOverWeek, earlierPages } from "../analysis/search-history.mjs";
import { DEFAULT_TOPICS } from "../analysis/ymyl.mjs";
import { agentRisk } from "./departments.mjs";
import { searchInsights, NOT_INDEXED } from "./insights.mjs";

/** Bump when the drafter changes in a way an unapproved draft should pick up (src/god/tick.mjs re-drafts once). */
export const DRAFT_VERSION = 2;
export const MAX_STEPS = 6, MIN_STEPS = 3;

const LOCAL_TYPES = /LocalBusiness|Store|Restaurant|Plumber|Dentist|Attorney|LegalService|Electrician|HVAC|Locksmith|RealEstate|Medical/;
const SHOP_TYPES = /Store|Product|Offer/;
const SENSITIVE_TYPES = /Medical|Dentist|Physician|Hospital|Pharmacy|Attorney|LegalService|Lawyer|Notary|FinancialService|AccountingService|InsuranceAgency|BankOrCreditUnion/;
// Sensitive topics read from what the site says about itself. Safety and children are left out here: words such as
// "emergency" (an emergency plumber) or "kids" would mark ordinary businesses; the ymyl job checks pages for them.
const SENSITIVE_TOPICS = new Set(["health", "medical", "legal", "data-protection", "tax", "finance"]);
let SENSITIVE = null; // compiled once per isolate
const INDEX_RULES = new Set(["robots-blocks-all", "noindex-in-sitemap", "robots-blocked", "status-error"]);
const RULE_AGENT = Object.fromEntries(Object.entries(RULE_GROUPS).flatMap(([a, rules]) => rules.map((r) => [r, `seo-${a}`])));
Object.assign(RULE_AGENT, { "host-variant-not-redirected": "seo-redirect-guardian", "hard-to-read": "seo-editor", "ssl-expiring": "seo-technical-fixer" });
const GENERIC = new Set(["the", "and", "ltd", "limited", "llc", "inc", "company", "group", "services", "service", "solutions", "agency", "official", "www", "home"]);

const DAY = 864e5;
const addDays = (d, n) => new Date(Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const num = (n) => Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (x) => `${(Number(x || 0) * 100).toFixed(1)}%`;
const pos = (p) => Number(p || 0).toFixed(1);
const path = (u) => String(u || "").replace(/^https?:\/\/[^/]+/, "") || "/";
const urlKey = (u) => String(u || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

/** Words that make a query a brand query: the business name's distinctive words and the domain name. */
export function brandTerms(site = {}, name = null) {
  const out = new Set();
  for (const w of String(name || site.name || "").toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 4 && !GENERIC.has(w)) out.add(w);
  try { const h = new URL(site.url).hostname.replace(/^www\./, "").split(".")[0]; if (h.length >= 4) out.add(h.toLowerCase()); } catch { /* no address */ }
  return [...out];
}
const isBrand = (q, terms) => { if (!terms.length) return false; const s = String(q || "").toLowerCase().split(" ").join(""); return terms.some((t) => s.includes(t)); };

/** Sensitive (your-money-or-your-life) topics the site states about itself, with the words that matched. */
export function sensitiveTopics(discovered = {}) {
  const hay = [discovered.description?.value, ...(discovered.topics || []).map((t) => t?.value ?? t), discovered.name?.value].filter(Boolean).join(" ").replace(/[-_/]+/g, " ");
  const out = [];
  // One pattern per topic, built from the ymyl job's keyword lists (compiled once per isolate; regex compiling is not free).
  SENSITIVE ??= [...SENSITIVE_TOPICS].map((topic) => ({ topic, re: new RegExp(`(?:^|[^a-z0-9])(${DEFAULT_TOPICS[topic].join("|")})(?![a-z0-9])`, "i") }));
  if (hay) for (const { topic, re } of SENSITIVE) { const m = hay.match(re); if (m) out.push({ topic, matched: m[1].slice(0, 40), source: "site text" }); }
  for (const t of discovered.businessTypes || []) if (SENSITIVE_TYPES.test(t) && !out.some((o) => o.source === "business type")) out.push({ topic: /Medical|Dentist|Physician|Hospital|Pharmacy/.test(t) ? "medical" : /Attorney|Legal|Lawyer|Notary/.test(t) ? "legal" : "finance", matched: t, source: "business type" });
  return out;
}

const step = (s) => ({ title: s.title, category: s.category, why: s.why, agent: s.agent, risk: s.risk, evidence: (s.evidence || []).filter(Boolean).slice(0, 6), ...(s.impact ? { impact: s.impact } : {}), ...(s.page ? { page: s.page } : {}), ...(s.query ? { query: s.query } : {}), source: s.source });

/**
 * site: { url, name }. answers: the business brief { goals, conversions, target_locations, services_priority, restrictions, ... }.
 * discovered, profile, audit: the scan's reports. searchConsole, history, inspect, speed, priorities: the reports in
 * site memory (each optional). facts: dossier facts. openQuestions: [{ key, question }]. now: ISO time.
 */
export function draftStrategy({ site = {}, answers = {}, discovered = {}, profile = null, audit = null, searchConsole = null, history = null, inspect = null, speed = null, priorities = null, facts = [], openQuestions = [], now = new Date().toISOString() } = {}) {
  const today = now.slice(0, 10), reviewOn = addDays(today, 28);
  const given = Object.fromEntries(Object.entries(answers || {}).filter(([, v]) => v != null && String(v).trim() !== "").map(([k, v]) => [k, String(v).trim()]));
  const types = discovered.businessTypes || [];
  const local = types.some((t) => LOCAL_TYPES.test(t));
  const shop = types.some((t) => SHOP_TYPES.test(t)) || /shopify|woocommerce|magento|bigcommerce/i.test(profile?.platform?.name || "");
  const sensitive = sensitiveTopics(discovered);
  const brand = brandTerms(site, discovered.name?.value);
  const sc = searchConsole && searchConsole.totals ? searchConsole : null;
  // A priorities report ranked from this snapshot (or a newer one) already holds the search analysis: read it instead of
  // running it again (the analysis is most of the draft's CPU in a fresh Worker isolate).
  const ranked = sc && priorities?.items?.some((i) => i.metrics) && String(priorities.generatedAt || "") >= String(sc.generatedAt || "~");
  const ofType = (t) => (priorities?.items || []).filter((i) => i.type === t && i.metrics).map((i) => i.metrics);
  const insights = !sc ? null : ranked ? { strikingDistance: ofType("content"), ctrUnderperformers: ofType("snippet"), decay: ofType("refresh"), cannibalization: ofType("structure") } : searchInsights(sc, history);
  const scPages = [...(sc?.pages || [])].sort((a, b) => (b.impressions || 0) - (a.impressions || 0));
  const scImpr = new Map(scPages.map((p) => [urlKey(p.url), p.impressions || 0]));
  const homeKey = urlKey(site.url);

  // ---- Baseline: only numbers read from the reports, with their dates.
  const baseline = {};
  if (sc) {
    const queries = sc.queries || [];
    const brandClicks = queries.filter((q) => isBrand(q.query, brand)).reduce((a, q) => a + (q.clicks || 0), 0);
    const topClicks = queries.reduce((a, q) => a + (q.clicks || 0), 0);
    const wow = weekOverWeek(history);
    const before = earlierPages(history, sc.to);
    baseline.searchConsole = {
      property: sc.property || null, from: sc.from, to: sc.to, days: sc.days || 28,
      clicks: sc.totals.clicks || 0, impressions: sc.totals.impressions || 0, ctr: sc.totals.ctr ?? null, position: sc.totals.position ?? null,
      ...(brand.length && queries.length ? { topQueries: queries.length, brandClicksInTopQueries: brandClicks, nonBrandClicksInTopQueries: topClicks - brandClicks } : {}),
      topPages: [...scPages].sort((a, b) => (b.clicks || 0) - (a.clicks || 0) || (b.impressions || 0) - (a.impressions || 0)).slice(0, 5).map((p) => ({ url: p.url, clicks: p.clicks || 0, impressions: p.impressions || 0, position: Number(pos(p.position)) })),
      topQueriesList: queries.slice(0, 5).map((q) => ({ query: String(q.query).slice(0, 120), clicks: q.clicks || 0, impressions: q.impressions || 0, position: Number(pos(q.position)), brand: isBrand(q.query, brand) })),
      ...(wow && wow.prev?.clicks != null ? { lastWeek: { to: wow.to, clicks: wow.now.clicks, previousWeekClicks: wow.prev.clicks, change: wow.clicksChange } } : {}),
      ...(before?.totals ? { previous28: { to: before.to, clicks: before.totals[0], impressions: before.totals[1] } } : {}),
    };
  } else baseline.searchConsole = null;
  baseline.note = sc ? `Search Console ${sc.from} to ${sc.to} (${sc.days || 28} days).` : "No Search Console data yet: clicks, impressions and queries are unknown, so none are stated here.";
  const insp = inspect && !inspect.blocked ? Object.entries(inspect.results || {}) : [];
  const notIndexed = insp.filter(([, v]) => NOT_INDEXED(v));
  if (insp.length) baseline.index = { checked: insp.length, notIndexed: notIndexed.length, at: String(inspect.generatedAt || "").slice(0, 10) };
  else if (inspect?.blocked) baseline.index = { unknown: "URL inspection refused: the service account needs Full permission on the property" };
  if (audit) {
    const sev = { high: 0, medium: 0, low: 0 };
    for (const i of audit.issues || []) if (sev[i.severity] != null) sev[i.severity]++;
    baseline.audit = { pages: audit.summary?.pagesCrawled ?? null, at: String(audit.generatedAt || "").slice(0, 10), findings: sev };
  }
  const speedPages = (speed?.pages || []).filter((p) => !p.error);
  const poor = speedPages.filter((p) => (p.field?.lcpMs ?? 0) > 4000 || (p.field?.inpMs ?? 0) > 500 || (p.field?.cls ?? 0) > 0.25 || (p.score != null && p.score < 50));
  if (speedPages.length) baseline.speed = { checked: speedPages.length, poor: poor.length, at: String(speed.generatedAt || "").slice(0, 10) };

  // ---- Objective: the brief's own words, else inferred from the site and labelled so.
  let objective, objectiveBasis = "brief", objectiveWhy = "from the business brief";
  if (given.goals) objective = given.goals;
  else {
    objectiveBasis = "inferred";
    const area = given.target_locations;
    const topSection = (() => {
      const p = scPages.find((x) => urlKey(x.url) !== homeKey && !isBrand(x.url.replace(/^https?:\/\/[^/]+/, ""), brand));
      const seg = p ? path(p.url).split("/").filter(Boolean)[0] : null;
      return seg ? `/${seg}` : null;
    })();
    if (given.services_priority) { objective = `Grow non-brand search clicks to the pages for ${given.services_priority}`; objectiveWhy = "inferred from the services you named as most important"; }
    else if (local) { objective = `More enquiries from people searching locally${area ? ` in ${area}` : ""}`; objectiveWhy = `inferred: the site describes itself as a local business (${types.filter((t) => LOCAL_TYPES.test(t)).join(", ")})`; }
    else if (shop) { objective = "Grow non-brand search clicks to product and category pages"; objectiveWhy = "inferred: the site sells products"; }
    else if (topSection) { objective = `Grow non-brand search clicks to the ${topSection} pages`; objectiveWhy = `inferred: the page with the most search impressions after the home page is under ${topSection}`; }
    else { objective = "Grow non-brand search clicks to the pages that bring enquiries"; objectiveWhy = "inferred: no goal stated yet"; }
    objectiveWhy += "; answer “What should search bring you?” in the business brief to replace it";
  }

  // ---- First steps, by expected impact from data. Each candidate keeps its category so the order is explainable.
  const steps = [], later = [];
  if (!sc) steps.push({ category: "access", title: "Give Search Console access", agent: "seo-onboarder", risk: "low", source: "setup",
    why: "Without Search Console the plan cannot see which searches already show the site, so every other step would be a guess about demand.",
    evidence: ["no Search Console report for this site yet", "in Search Console, add the service account email from this site's Set up card as a user of the property, then press Check access (or wait for the first daily read if that is done)"] });
  // 1. Index problems: blocking audit findings, then pages Google has not indexed (the ones with search impressions or the home page first).
  const issues = audit?.issues || [];
  const byRule = new Map();
  for (const i of issues) (byRule.get(i.rule) || byRule.set(i.rule, []).get(i.rule)).push(i);
  for (const rule of ["robots-blocks-all", "noindex-in-sitemap", "robots-blocked", "status-error"]) {
    const list = (byRule.get(rule) || []).filter((i) => i.severity === "high" || RULES[rule]?.severity === "high");
    if (!list.length) continue;
    const agent = RULE_AGENT[rule] || "seo-technical-fixer";
    steps.push({ category: "index", title: `${RULES[rule]?.title || rule} (${list.length} page${list.length === 1 ? "" : "s"})`, agent, risk: agentRisk(agent, { mayEdit: true }), source: "audit",
      why: `${RULES[rule]?.why || ""} Pages that cannot be crawled or indexed cannot earn any search traffic.`.trim(), evidence: list.slice(0, 5).map((i) => `${path(i.url)}${i.detail ? ` (${i.detail})` : ""}`) });
  }
  if (notIndexed.length) {
    const order = [...notIndexed].sort(([a], [b]) => (urlKey(b) === homeKey) - (urlKey(a) === homeKey) || (scImpr.get(urlKey(b)) || 0) - (scImpr.get(urlKey(a)) || 0));
    const important = order.filter(([u]) => urlKey(u) === homeKey || scImpr.get(urlKey(u)));
    steps.push({ category: "index", title: `Get ${notIndexed.length} page${notIndexed.length === 1 ? "" : "s"} indexed${important.length ? `, starting with ${path(important[0][0])}` : ""}`, agent: "seo-indexing-monitor", risk: "low", source: "url inspection",
      why: "Google cannot rank a page it has not indexed. Group the pages by cause first: some are meant to stay out.",
      evidence: [`${notIndexed.length} of ${insp.length} inspected pages not indexed (${baseline.index.at})`, ...order.slice(0, 4).map(([u, v]) => `${path(u)}: ${v.coverage}${scImpr.get(urlKey(u)) ? ` (${num(scImpr.get(urlKey(u)))} impressions)` : ""}`)] });
  }
  if (insights) {
    // 2. Striking distance: queries already shown on page one's edge, one step per page (non-brand only).
    const strike = (insights.strikingDistance || []).filter((s) => !isBrand(s.query, brand));
    const byPage = new Map();
    for (const s of strike) (byPage.get(s.page) || byPage.set(s.page, []).get(s.page)).push(s);
    for (const [page, list] of [...byPage].slice(0, 2)) {
      const s = list[0];
      steps.push({ category: "striking", page, query: String(s.query).slice(0, 120), title: `Move "${String(s.query).slice(0, 80)}" onto page one: strengthen ${path(page)}`, agent: "seo-researcher", risk: "medium", source: "search console",
        why: "It already ranks and shows impressions, so a stronger page can move it up faster than a new page can rank from nothing.",
        impact: s.estimatedExtraClicks != null ? `about +${num(s.estimatedExtraClicks)} clicks in ${sc.days || 28} days at position 3 (estimate from this site's own click-through curve)` : null,
        evidence: list.slice(0, 3).map((x) => `"${String(x.query).slice(0, 80)}": position ${pos(x.position)}, ${num(x.impressions)} impressions, ${num(x.clicks)} click${x.clicks === 1 ? "" : "s"} (${sc.from} to ${sc.to})`) });
    }
    // 3. Low click-through on pages with many impressions.
    const ctr = (insights.ctrUnderperformers || []).filter((u) => u.impressions >= 100)[0];
    if (ctr) steps.push({ category: "ctr", page: ctr.page, title: `Rewrite the title and description of ${path(ctr.page)}`, agent: "seo-snippet-optimizer", risk: "medium", source: "search console",
      why: "It ranks where pages on this site normally earn far more clicks, so the snippet is probably not earning the click.",
      impact: `about ${num(ctr.estimatedLostClicks)} clicks missed in ${sc.days || 28} days (estimate)`,
      evidence: [`position ${pos(ctr.position)}, ${num(ctr.impressions)} impressions, CTR ${pct(ctr.ctr)} against about ${pct(ctr.expectedCtr)} for that position on this site (${sc.from} to ${sc.to})`] });
    // 4. Decay: visibility fell against the 28 days before.
    const d = (insights.decay || [])[0];
    if (d) steps.push({ category: "decay", page: d.page, title: `Refresh ${path(d.page)}: impressions fell ${Math.abs(Math.round(d.change * 100))}%`, agent: "seo-refresher", risk: "medium", source: "search console history",
      why: "Impressions dropped sharply against the previous 28 days. Check the live results first: it can be seasonality, a competitor or stale content.",
      evidence: [`impressions ${num(d.impressionsBefore)} to ${num(d.impressionsNow)}, clicks ${num(d.clicksBefore)} to ${num(d.clicksNow)} (28-day windows to ${sc.to})`] });
    // 5. Cannibalisation: two pages split one query.
    const c = (insights.cannibalization || []).filter((x) => !isBrand(x.query, brand))[0];
    if (c) steps.push({ category: "cannibalisation", query: String(c.query).slice(0, 120), title: `Choose one page for "${String(c.query).slice(0, 80)}"`, agent: "seo-cannibalization-resolver", risk: "high", source: "search console",
      why: "Two of the site's pages split the impressions for one query, so neither ranks as well as one strong page would. Merging or redirecting waits for you.",
      evidence: c.pages.slice(0, 3).map((p) => `${path(p.page)}: position ${pos(p.position)}, ${num(p.impressions)} impressions`) });
  } else if (!sc && priorities?.items?.length) {
    // An older ranking with search items but no snapshot in memory: use its items as they are.
    for (const i of priorities.items.filter((x) => ["content", "snippet", "refresh", "structure"].includes(x.type)).slice(0, 3))
      steps.push({ category: { content: "striking", snippet: "ctr", refresh: "decay", structure: "cannibalisation" }[i.type], title: i.title, agent: { content: "seo-researcher", snippet: "seo-snippet-optimizer", refresh: "seo-refresher", structure: "seo-cannibalization-resolver" }[i.type], risk: i.type === "structure" ? "high" : "medium", why: i.why, evidence: i.evidence, source: "priorities report" });
  }
  // 6. Technical audit findings of high severity only (index blockers are already above). Medium and low wait.
  const auditGroups = [...byRule].filter(([rule]) => !INDEX_RULES.has(rule) && RULES[rule]).map(([rule, list]) => ({ rule, list, severity: RULES[rule].severity }))
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]) || b.list.length - a.list.length);
  const auditStep = (g) => { const agent = RULE_AGENT[g.rule] || "seo-technical-fixer"; return { category: "technical", title: `${RULES[g.rule].title} (${g.list.length} page${g.list.length === 1 ? "" : "s"})`, agent, risk: agentRisk(agent, { mayEdit: true }), source: "audit", why: RULES[g.rule].why, evidence: g.list.slice(0, 4).map((i) => `${path(i.url)}${i.detail ? ` (${i.detail})` : ""}`), severity: g.severity }; };
  for (const g of auditGroups.filter((x) => x.severity === "high")) steps.push(auditStep(g));
  // Too few demand-driven steps: medium findings, then conversion tracking, fill up to the minimum; never low ones.
  const mediums = auditGroups.filter((x) => x.severity === "medium");
  while (steps.length < MIN_STEPS && mediums.length) steps.push(auditStep(mediums.shift()));
  if (steps.length < MIN_STEPS && !given.conversions) steps.push({ category: "measurement", title: "Decide what counts as a conversion and check it is tracked", agent: "seo-reporter", risk: "low", source: "business brief",
    why: "Without a conversion to count, the plan can only measure traffic, not whether search brings business.", evidence: ["the business brief does not say what a conversion is yet"] });
  const first = steps.slice(0, MAX_STEPS).map((s, i) => ({ rank: i + 1, ...step(s) }));
  for (const s of steps.slice(MAX_STEPS)) later.push({ title: s.title, agent: s.agent, why: "after the first steps", evidence: s.evidence.slice(0, 2) });
  for (const g of [...mediums, ...auditGroups.filter((x) => x.severity === "low")]) { const s = auditStep(g); later.push({ title: s.title, agent: s.agent, severity: g.severity, evidence: s.evidence.slice(0, 2) }); }
  if (poor.length) later.push({ title: `${poor.length} page${poor.length === 1 ? "" : "s"} rate poor on speed (phone)`, agent: "seo-performance-fixer", why: "a tie-breaker in rankings, rarely a first fix", evidence: poor.slice(0, 3).map((p) => `${path(p.url)}: score ${p.score ?? "n/a"}`) });
  if (local) later.push({ title: "Check the Google Business Profile matches the site", agent: "seo-local-gbp-optimizer", why: "local results lean on the profile; a person makes any change there", evidence: [] });
  if (profile?.rendering === "js-dependent") later.push({ title: "Content needs JavaScript to appear", agent: "seo-technical-fixer", why: "crawlers and AI tools may miss it", evidence: ["rendering: js-dependent"] });

  // ---- KPIs: a direction and a review date; a baseline only where a report gives one.
  const kpis = [];
  const kpi = (metric, baselineValue, target, text) => kpis.push({ metric, baseline: baselineValue, target, reviewOn, text: `${text}; review on ${reviewOn}` });
  if (sc) {
    const b = baseline.searchConsole;
    if (b.nonBrandClicksInTopQueries != null) kpi("Non-brand clicks (top queries)", b.nonBrandClicksInTopQueries, "grow", `Non-brand clicks in the top ${b.topQueries} queries: from ${num(b.nonBrandClicksInTopQueries)} (${sc.from} to ${sc.to}) to grow`);
    const focus = first.find((s) => s.category === "striking" || s.category === "ctr");
    const focusPage = (focus && scPages.find((p) => urlKey(p.url) === urlKey(focus.page))) || scPages.find((p) => urlKey(p.url) !== homeKey);
    if (focusPage) kpi(`Clicks to ${path(focusPage.url)}`, focusPage.clicks || 0, "grow", `Clicks to ${path(focusPage.url)}: from ${num(focusPage.clicks)} in ${sc.days || 28} days to grow`);
    kpi("Search clicks (whole site)", sc.totals.clicks || 0, "grow", `Search clicks to the whole site: from ${num(sc.totals.clicks)} in ${sc.days || 28} days to grow (impressions ${num(sc.totals.impressions)})`);
  } else kpi("Search clicks (whole site)", null, "grow", "Search clicks to the whole site: baseline once Search Console access is given, then grow");
  if (baseline.index?.checked) kpi("Pages not indexed", baseline.index.notIndexed, baseline.index.notIndexed ? "reduce" : "hold", `Inspected pages not indexed: ${baseline.index.notIndexed} of ${baseline.index.checked} to ${baseline.index.notIndexed ? "fall (only pages meant to rank)" : "stay at 0"}`);
  const highs = baseline.audit?.findings?.high ?? null;
  if (highs) kpi("High-severity audit findings", highs, "reduce", `High-severity audit findings: from ${highs} to 0`);
  if (given.conversions) kpi("Conversions", null, "grow", `Conversions (${given.conversions}): baseline from your own tracking, then grow`);

  // ---- What waits for a person, always.
  const notWithoutYou = [
    "Any change to the website: each one waits for your approval (hosted pull requests always wait for a person).",
    "Site-wide changes (robots.txt, redirects, sitemaps, migrations) and removing, merging or noindexing pages.",
    "Outreach, link building and anything published under your name.",
  ];
  if (sensitive.length) notWithoutYou.push(`Pages on sensitive topics (${[...new Set(sensitive.map((s) => s.topic))].join(", ")}; found in ${[...new Set(sensitive.map((s) => s.source))].join(" and ")}): advice only; edits need a named, qualified reviewer and your approval.`);
  if (local) notWithoutYou.push("Google Business Profile changes and review replies: drafted for you, made by a person.");
  if (given.restrictions) notWithoutYou.push(`Your restrictions: ${given.restrictions.slice(0, 300)}`);

  const top = openQuestions.slice(0, 3).map((q) => ({ key: q.key, question: q.question }));
  const risks = [profile?.rendering === "js-dependent" ? "content needs JavaScript to appear: crawlers may miss it" : null,
    !sc ? "no search data yet: the steps come from the site itself until Search Console is connected" : null,
    inspect?.blocked ? "index status unknown: the service account has Restricted access" : null,
    objectiveBasis === "inferred" ? "the objective is inferred, not stated by you" : null].filter(Boolean);

  return {
    status: "proposed", approval: "agency", draftVersion: DRAFT_VERSION, draftedAt: now,
    objective, objectiveBasis, objectiveWhy,
    baseline, firstSteps: first, later: later.slice(0, 8), kpis, notWithoutYou,
    openQuestions: { count: openQuestions.length, top }, risks,
    profile: { local, shop, sensitive: sensitive.map((s) => s.topic) },
    basedOn: { facts: facts.length, auditPages: audit?.summary?.pagesCrawled ?? 0, openQuestions: openQuestions.length, searchConsole: sc ? { from: sc.from, to: sc.to } : null,
      inspected: insp.length, speed: speedPages.length > 0, history: !!history, priorities: !!(ranked || (!sc && priorities?.items?.length)) },
  };
}
