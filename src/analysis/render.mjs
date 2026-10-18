// Delivered HTML vs the page after JavaScript runs. Pure: pass in both versions' title, H1 and main text.
// Two failures matter (ported from Erudience's static-content check, which kept its prerendered HTML honest):
//   prerendered text says something the real page does not (crawlers and AI tools read a page visitors never see)
//   the real page's text is mostly missing from the delivered HTML (crawlers that do not run JavaScript see little)

const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();

/** Sentences of six words or more: shorter fragments are labels, buttons and menu items, which differ legitimately. */
export function sentences(text) {
  return String(text || "").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 6);
}

/** A prose sentence: ends like a sentence and is long enough to state something, unlike a heading, label or link list. */
export const isProse = (s) => /[.!?]["')\]]?$/.test(s.trim()) && s.trim().split(/\s+/).length >= 8;

/**
 * raw and rendered = { title, h1, text }. Returns { findings, rawWords, renderedWords, missingShare, notOnPage }.
 * missingShare is the share of the rendered page's sentences that the delivered HTML lacks.
 */
export function compareRender(raw, rendered, { minRenderedWords = 80 } = {}) {
  const rawN = norm(raw.text), renN = norm(rendered.text);
  const rawWords = rawN ? rawN.split(" ").length : 0, renderedWords = renN ? renN.split(" ").length : 0;
  const notOnPage = sentences(raw.text).filter((s) => !renN.includes(norm(s)));
  const renSent = sentences(rendered.text);
  const missing = renSent.filter((s) => !rawN.includes(norm(s)));
  const missingShare = renSent.length ? missing.length / renSent.length : 0;
  const findings = [];
  // A full sentence the page does not say is a content claim crawlers see and visitors do not; a differing heading or label
  // ("Related services" vs "Where to go next") is the same block worded differently, which matters much less.
  const prose = notOnPage.filter(isProse), labels = notOnPage.filter((s) => !isProse(s));
  if (prose.length) findings.push({ id: "prerender-text-not-on-page", severity: "high", title: "The delivered HTML says things the page does not show", evidence: prose.slice(0, 3).map((s) => `"${s.slice(0, 140)}"`), fix: "Prerendered or server-rendered text may only repeat what the real page says. Regenerate it from the same source as the page, or remove the stale text." });
  if (labels.length) findings.push({ id: "prerender-labels-differ", severity: "low", title: "Headings or labels in the delivered HTML differ from the page", evidence: labels.slice(0, 3).map((s) => `"${s.slice(0, 100)}"`), fix: "Use the same headings and labels in the prerendered HTML as on the page, so crawlers and visitors read the same structure." });
  if (renderedWords >= minRenderedWords && missingShare >= 0.5) findings.push({ id: "rendered-text-missing", severity: "medium", title: "Most of the page's text appears only after JavaScript runs", evidence: [`${Math.round(missingShare * 100)}% of ${renSent.length} sentence(s) are not in the delivered HTML (${rawWords} words delivered, ${renderedWords} after rendering)`], fix: "Prerender or server-render the main content, so crawlers and AI tools that do not run JavaScript can read it." });
  if (raw.title && rendered.title && norm(raw.title) !== norm(rendered.title)) findings.push({ id: "render-title-changed", severity: "low", title: "JavaScript changes the title", evidence: [`delivered "${raw.title}", rendered "${rendered.title}"`], fix: "Deliver the final title in the HTML; search engines may use either." });
  if (norm(raw.h1) !== norm(rendered.h1) && (raw.h1 || rendered.h1)) findings.push({ id: "render-h1-changed", severity: "low", title: "The main heading differs after JavaScript runs", evidence: [`delivered "${raw.h1 || "(none)"}", rendered "${rendered.h1 || "(none)"}"`], fix: "Deliver the same H1 the visitor sees." });
  return { findings, rawWords, renderedWords, missingShare: Number(missingShare.toFixed(2)), notOnPage: notOnPage.length, proseNotOnPage: prose.length };
}
