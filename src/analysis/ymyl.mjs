// Sensitive-topic review gate ("your money or your life" pages). Pure: pass pages from loadPages and the site.review config.
// A page that gives health, legal, tax, money, safety or children's advice should name who wrote it and who checked it.
// Keywords are regex source strings (matched case-insensitively, at a word start), so "gdpr" and "data protect\\w*" both work.

export const DEFAULT_TOPICS = {
  health: ["health\\w*", "symptom\\w*", "diet\\w*", "nutrition", "wellbeing", "mental health", "therap\\w+", "disease\\w*"],
  medical: ["medic\\w+", "medication", "dosage", "diagnos\\w+", "treatment", "surgery", "clinical", "prescri\\w+"],
  legal: ["legal advice", "lawsuit", "solicitor", "attorney", "your rights", "contract law", "liabilit\\w+", "tenancy", "employment law"],
  "data-protection": ["gdpr", "data protect\\w*", "privacy law", "ccpa", "cookie law", "subject access"],
  tax: ["tax", "vat", "hmrc", "irs", "self assessment", "tax return", "inheritance"],
  finance: ["invest\\w*", "mortgage", "pension\\w*", "loan\\w*", "credit score", "insurance", "payments?", "refund\\w*", "chargeback", "crypto\\w*"],
  safety: ["safety", "hazard\\w*", "emergency", "first aid", "fire safety", "recall", "toxic", "poison\\w*"],
  children: ["children", "child safety", "kids", "teen\\w*", "parental", "safeguarding", "under 18"],
};
export const DEFAULT_FIELDS = ["author", "reviewedBy"];

const compile = (kw) => { try { return new RegExp(`(?:^|[^a-z0-9])(?:${kw})(?![a-z0-9])`, "i"); } catch { return null; } };

/** Merge site.review.topics over the defaults. A topic set to an empty list switches that topic off. */
export function topicList(review = {}) {
  const t = { ...DEFAULT_TOPICS };
  const custom = review.topics;
  if (custom && !Array.isArray(custom) && typeof custom === "object") for (const [k, v] of Object.entries(custom)) t[k] = Array.isArray(v) ? v : [];
  else if (Array.isArray(custom) && custom.length) t.custom = custom.map(String);
  return Object.entries(t).map(([topic, kws]) => ({ topic, res: kws.map((k) => [k, compile(k)]).filter(([, r]) => r) })).filter((x) => x.res.length);
}

/**
 * pages: [{ title, url, text, hold, author, reviewedBy, ... }]. review: { topics, requireFields }.
 * fieldsKnown=false (a sitemap site: page files are not readable) reports topics but cannot say who wrote or reviewed.
 */
export function checkYmyl(pages = [], review = {}, { fieldsKnown = true } = {}) {
  const fields = Array.isArray(review.requireFields) && review.requireFields.length ? review.requireFields : DEFAULT_FIELDS;
  const topics = topicList(review);
  const out = [];
  for (const p of pages) {
    const hay = `${p.title || ""} ${p.url || ""} ${p.text || ""}`.replace(/[-_/]+/g, " ");
    const hits = [];
    for (const { topic, res } of topics) {
      const m = res.find(([, r]) => r.test(hay));
      if (m) hits.push({ topic, keyword: m[0] });
    }
    if (!hits.length) continue;
    const missing = fieldsKnown ? fields.filter((f) => !p[f] || String(p[f]).trim() === "") : [];
    const status = p.hold ? "held" : !fieldsKnown ? "unchecked" : missing.length ? "needs reviewer" : "ok";
    out.push({ title: p.title || p.id || p.url, url: p.url, file: p.file, topics: hits.map((h) => h.topic), keywords: hits.map((h) => h.keyword), missing, status });
  }
  const count = (s) => out.filter((x) => x.status === s).length;
  return { requireFields: fields, fieldsKnown, flagged: out.length, needsReviewer: count("needs reviewer"), held: count("held"), ok: count("ok"), unchecked: count("unchecked"), pages: out };
}

export function ymylMarkdown(r, siteName = "") {
  const rows = r.pages.map((p) => `| ${String(p.title).replace(/\|/g, "/")} | ${p.topics.join(", ")} | ${p.missing.join(", ") || "-"} | ${p.status} |`);
  return `# ${siteName ? siteName + ": " : ""}sensitive-topic review

${r.flagged} page(s) touch a sensitive topic. Needs a reviewer: ${r.needsReviewer}. Held: ${r.held}. Fine: ${r.ok}.${r.fieldsKnown ? "" : "\nThe site's content type is a sitemap, so who wrote or reviewed each page cannot be read. Use content type json or markdown with author and reviewedBy fields to get a real check."}
Required fields: ${r.requireFields.join(", ")}. Topic matching is keyword based, so expect a few false alarms; edit \`review.topics\` in the config to tune it.

${rows.length ? "| Page | Topic | Missing | Status |\n|---|---|---|---|\n" + rows.join("\n") : "No sensitive-topic pages found."}

A page marked needs reviewer should get a named author and a qualified reviewer before it goes live. Add \`"hold": true\` to keep it out of the release schedule until then.
`;
}
