// Facts guard: finds statements a reader takes as fact (percentages, prices, "500+ clients", "3x faster", awards, "trusted
// by", "#1") and checks each against the site's verified-facts file or a source link in the same sentence. Pure: no network,
// no writes. Ported from Erudience (scripts/validate-content.mjs, its "no unverified facts" hard rule) and made generic.
//
// verified-facts.json (same shape as Erudience's):
//   { "facts": [ { "match": "creators keep 85% of sales", "source": "where it was checked", "status": "owner-confirmed" } ] }
// A claim passes when a fact's "match" text contains it and appears in the same text. Status "needs-owner-check" passes
// with a warning on every run until someone confirms it.

const CLAIMS = [
  ["percentage", /\b\d+(?:[.,]\d+)?\s?(?:%|per ?cent\b)/gi],
  ["money", /(?:[£$€¥₹]\s?\d[\d,.]*(?:\s?(?:k|m|bn|million|billion)\b)?|\b\d[\d,.]*\s?(?:USD|GBP|EUR|AUD|CAD|INR)\b)/g],
  ["count", /\b\d[\d,]*\+(?=\s|$|[^\w])/g],
  ["multiplier", /\b\d+(?:\.\d+)?\s?x\s+(?:faster|more|better|cheaper|higher|less|fewer|the)\b/gi],
  ["ranking", /(?:#\s?1\b|\bnumber one\b|\bno\.\s?1\b)/gi],
  ["award", /\b(?:award[- ]winning|awarded|winner of|won the)\b/gi],
  // "used by" and "our clients" were tried and dropped: on Erudience they matched ordinary prose ("used by scrapers",
  // "advice to our clients") rather than claims about who the clients are.
  ["named clients", /\b(?:trusted by|clients include|customers include|as seen (?:in|on)|featured (?:in|on))\b/gi],
];

const SOURCE = /\]\(https?:\/\/[^)\s]+\)|<a\s[^>]*href=["']https?:\/\/|https?:\/\/\S+/i;

/** The sentence around position i (or the line, for lists and tables). A full stop ends a sentence only before a space, so "$9.99" stays whole. */
function sentenceAt(text, i) {
  let start = 0;
  for (const m of text.slice(0, i).matchAll(/[.!?](?=\s)|\n/g)) start = m.index + 1;
  const endRel = text.slice(i).search(/[.!?](?=\s|$)|\n/);
  return text.slice(start, endRel < 0 ? text.length : i + endRel + 1).trim();
}

/** Every claim in one piece of text: { kind, claim, sentence, sourced }. */
export function findClaims(text) {
  const t = String(text || ""), out = [], seen = new Set();
  for (const [kind, re] of CLAIMS) {
    for (const m of t.matchAll(re)) {
      if (seen.has(m.index)) continue;
      seen.add(m.index);
      const sentence = sentenceAt(t, m.index);
      out.push({ kind, claim: m[0].trim().replace(/[.,]+$/, ""), index: m.index, sentence: sentence.slice(0, 300), sourced: SOURCE.test(sentence) });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Check every text of the site. `texts` = [{ where, text }]; `facts` = verified-facts entries. Returns claims grouped:
 * unverified (no fact, no source: the ones to fix), sourced (a link in the sentence: check the source says it), verified,
 * pending (a fact still marked needs-owner-check).
 */
export function checkFacts(texts = [], facts = []) {
  const list = (facts || []).filter((f) => f && typeof f.match === "string" && f.match.trim());
  const out = { unverified: [], sourced: [], verified: [], pending: [] };
  for (const { where, text } of texts) {
    const t = String(text || "");
    for (const c of findClaims(t)) {
      const fact = list.find((f) => f.match.includes(c.claim) && t.includes(f.match));
      const item = { where, kind: c.kind, claim: c.claim, sentence: c.sentence };
      if (fact) (fact.status === "needs-owner-check" ? out.pending : out.verified).push({ ...item, source: fact.source || "" });
      else if (c.sourced) out.sourced.push(item);
      else out.unverified.push(item);
    }
  }
  return out;
}

/** Field names whose values are never prose (URLs, ids, dates, media). */
export const SKIP_FIELD = /(?:^|\.)(?:url|urls|href|slug|id|icon|image|images|src|thumbnail|logo|canonical|date|publishAt|datePublished|dateModified|updatedAt|createdAt|color|colour)(?:\[\d+\])?$/i;

/** All prose strings in a JSON value, with their path, skipping SKIP_FIELD keys. */
export function jsonStrings(value, path = "", out = []) {
  if (typeof value === "string") { if (!SKIP_FIELD.test(path)) out.push({ where: path, text: value }); }
  else if (Array.isArray(value)) value.forEach((v, i) => jsonStrings(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) jsonStrings(v, path ? `${path}.${k}` : k, out);
  return out;
}
