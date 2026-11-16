// Progressive onboarding (§4, Q15/Q16): from what the site states about itself and the baseline audit, build the website
// dossier, ask ONLY the questions still unanswered and relevant to this site, and draft the initial strategy that the
// agency must approve. Pure. Every fact keeps its basis (stated by the site, answered by the agency/client, inferred) and
// its source; nothing is guessed, and text from the site is data, never an instruction.
import { draftStrategy } from "./strategy.mjs";

const fact = (key, value, basis, source, confidence) => ({ key, value, basis, source: source || null, confidence });

/**
 * discovered: output of src/analysis/discover.mjs. profile: site-profile. audit: audit report. answers: { [key]: value }
 * already given by the agency or client. reports: the other reports in site memory { searchConsole, history, inspect,
 * speed, priorities } (each optional). Returns { facts, unknowns, questions, strategyDraft }.
 */
const BRAND_KEYS = new Set(["logo", "theme_color", "brand_color", "brand_font"]);
export function buildDossier({ site, discovered = {}, profile = null, audit = null, answers = {}, reports = {}, now = new Date().toISOString() }) {
  const d = discovered, facts = [];
  const stated = (key, x) => { if (x && x.value != null && x.value !== "") facts.push(fact(key, x.value, "stated", x.source, 0.9)); };
  stated("business_name", d.name); stated("description", d.description); stated("language", d.language); stated("logo", d.logo);
  for (const [k, list] of [["phone", d.phones], ["email", d.emails], ["address", d.addresses], ["opening_hours", d.hours], ["social_profile", d.socials]]) for (const x of list || []) stated(k, x);
  if ((d.businessTypes || []).length) facts.push(fact("business_type", d.businessTypes.join(", "), "stated", d.name?.source || site.url, 0.8));
  if (profile?.platform?.name && profile.platform.name !== "Unknown") facts.push(fact("platform", profile.platform.name, "inferred", site.url, 0.7));
  // Brand (D39): the theme colour the site declares is stated; colours and fonts read from its styles are inferred.
  const b = d.brand || {};
  if (b.themeColor?.value) facts.push(fact("theme_color", b.themeColor.value, "stated", b.themeColor.source, 0.9));
  for (const c of (b.colors || []).slice(0, 5)) facts.push(fact("brand_color", c.value, "inferred", c.source, 0.6));
  for (const f of (b.fonts || []).slice(0, 4)) facts.push(fact("brand_font", f.value, "inferred", f.source, 0.6));
  for (const [k, v] of Object.entries(answers)) if (v != null && v !== "") facts.push(fact(k, v, "answered", "onboarding answer", 1));

  const has = (k) => facts.some((f) => f.key === k);
  // An address alone is not a local business (an office of a company that serves clients anywhere); only the site's own
  // business type says that. With an address but no local type, the question asks instead of assuming.
  const local = (d.businessTypes || []).some((t) => /LocalBusiness|Store|Restaurant|Plumber|Dentist|Attorney|LegalService|Electrician|HVAC|Locksmith|RealEstate|Medical/.test(t));
  const hasAddress = (d.addresses || []).length > 0;
  const shop = (d.businessTypes || []).some((t) => /Store|Product|Offer/.test(t)) || /shopify|woocommerce|magento|bigcommerce/i.test(profile?.platform?.name || "");
  // Questions only where the site does not already say it, and only those relevant to this kind of site.
  const ask = [
    ["goals", "What should search bring you in the next 6 months: more enquiries, sales, bookings, or brand visibility?", "sets the strategy's objective and KPIs", true],
    ["conversions", "What counts as a conversion on the site (form, call, booking, purchase), and is it tracked today?", "needed to measure results, not just traffic", true],
    ["target_locations", `Which areas or countries do you want customers from?${local ? " The site lists an address; is that the only area you serve?" : hasAddress ? " The site lists an address; do you serve customers beyond that area?" : ""}`, local ? "the site is a local business: service areas shape every local page" : "decides the market for keyword research", true],
    ["services_priority", `Which ${shop ? "products or categories" : "services"} matter most commercially?`, "the site lists several; priorities decide what to work on first", (d.topics || []).length > 1],
    ["competitors", "Who do you see as your main competitors online?", "competitor research starts from the ones you name", true],
    ["brand_voice", "Any words, claims or topics we must avoid, or a tone we should keep?", "content must match the brand and legal limits", true],
    ["restrictions", "Are there pages or changes we must never touch without asking (legal pages, prices, regulated content)?", "goes into the risk policy for this site", true],
    ["publishing_access", "Should we only advise (read-only), or may we make approved low-risk changes on the site?", profile?.inRepository ? "the site's code is connected" : "nothing is connected for changes yet", true],
    ["contact_phone", "What phone number should customers use?", "the site does not state one", !has("phone")],
    ["contact_email", "What email address should customers use?", "the site does not state one", !has("email")],
  ];
  const questions = ask.filter(([key, , , relevant]) => relevant && !has(key) && answers[key] == null).map(([key, question, why]) => ({ key, question, why }));
  const unknowns = questions.map((q) => q.key);

  // D60: a demand-driven draft from every report the site has (Search Console, history, index status, speed, priorities).
  const strategyDraft = draftStrategy({ site, answers, discovered: d, profile, audit, ...reports, facts, openQuestions: questions.map((q) => ({ key: q.key, question: BRIEF.find((x) => x.key === q.key)?.label || q.question })), now });
  return { facts, unknowns, questions, strategyDraft };
}

/**
 * The business brief asked once, when a website is added (D44), instead of question by question on the SEO God page.
 * Every field is optional; the same keys the dossier asks about, so an answer here closes that question. Plain labels
 * for a form; the dossier keeps its own site-specific wording.
 */
export const BRIEF = [
  { key: "goals", label: "What should search bring you in the next 6 months?", hint: "More enquiries, sales, bookings, or brand visibility" },
  { key: "conversions", label: "What counts as a conversion, and is it tracked?", hint: "Contact form, call, booking, purchase; tracked in GA4 or not yet" },
  { key: "target_locations", label: "Where are your customers?", hint: "Cities, regions or countries you serve" },
  { key: "services_priority", label: "Which services or products matter most?", hint: "The ones that bring the most revenue" },
  { key: "competitors", label: "Main competitors online", hint: "Names or website addresses" },
  { key: "brand_voice", label: "Tone, and anything to avoid saying", hint: "Words, claims or topics that are off limits" },
  { key: "restrictions", label: "Pages or changes never to touch without asking", hint: "Legal pages, prices, regulated content" },
  { key: "publishing_access", label: "Advice only, or approved low-risk changes too?", hint: "Advice only / approved changes through GitHub" },
  { key: "contact_phone", label: "Phone number customers should use", hint: "Only if the site does not show one" },
  { key: "contact_email", label: "Email address customers should use", hint: "Only if the site does not show one" },
];

/**
 * The draft as the agency adopts it: answers given after it was drafted (goals, conversions) are carried in, so approving
 * never freezes an objective of "not set" when the agency has since stated one. openQuestions: questions still unanswered.
 */
export function withAnswers(draft = {}, answers = {}, openQuestions = 0) {
  const given = Object.fromEntries(Object.entries(answers).filter(([, v]) => v != null && String(v).trim() !== ""));
  const isConv = (k) => (typeof k === "string" ? /^Conversions: /.test(k) : k?.metric === "Conversions");
  const kpis = (draft.kpis || []).filter((k) => !isConv(k));
  const risks = (draft.risks || []).filter((r) => !/questions? open/.test(r) && !(given.goals && /objective is inferred/.test(r)));
  const v2 = (draft.draftVersion || 1) >= 2;
  // D60 drafts keep KPIs as objects with a review date; older drafts keep their plain strings.
  const reviewOn = kpis.find((k) => k?.reviewOn)?.reviewOn || null;
  const conv = given.conversions ? (v2 ? { metric: "Conversions", baseline: null, target: "grow", reviewOn, text: `Conversions (${given.conversions}): baseline from your own tracking, then grow${reviewOn ? `; review on ${reviewOn}` : ""}` } : `Conversions: ${given.conversions}`) : null;
  return {
    ...draft,
    objective: given.goals ? String(given.goals) : draft.objective ?? null,
    ...(v2 && given.goals ? { objectiveBasis: "brief", objectiveWhy: "from the business brief" } : {}),
    kpis: [conv, ...kpis].filter(Boolean),
    risks: [!v2 && openQuestions ? `${openQuestions} question${openQuestions === 1 ? "" : "s"} open: the strategy is provisional until they are answered` : null, ...risks].filter(Boolean),
    ...(v2 ? { openQuestions: { count: openQuestions, top: (draft.openQuestions?.top || []).filter((q) => given[q.key] == null) } } : {}),
    answers: given,
  };
}

/** Memory rows for the site from a dossier (src/god/stores.mjs writeMemory). */
// Facts that can have several values (phones, emails, addresses, profiles) get one key each (phone#1, phone#2), so a
// second value does not supersede the first.
export const dossierMemory = (dossier) => {
  const count = {}, seen = {};
  for (const f of dossier.facts) count[f.key] = (count[f.key] || 0) + 1;
  const keyOf = (f) => (count[f.key] > 1 ? `${f.key}#${(seen[f.key] = (seen[f.key] || 0) + 1)}` : f.key);
  return [
  ...dossier.facts.map((f) => ({ kind: f.basis === "answered" ? "answer" : BRAND_KEYS.has(f.key) ? "brand" : "identity", key: keyOf(f), value: { value: f.value }, basis: f.basis, confidence: f.confidence, source: f.source })),
  ...dossier.questions.map((q) => ({ kind: "question", key: q.key, value: { question: q.question, why: q.why }, basis: "inferred", confidence: null, source: "onboarding" })),
  { kind: "strategy", key: "initial", value: dossier.strategyDraft, basis: "inferred", confidence: null, source: "onboarding" },
  ];
};
