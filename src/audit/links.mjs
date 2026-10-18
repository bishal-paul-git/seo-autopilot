// Internal-link opportunities: pages that talk about a topic another page owns, without linking to it.
// "Owns" = the target page's main phrase (its H1, or its title before a separator). Pure function over crawl records.
import { tokens } from "../adapters/index.mjs";
import { sameWord, siteWords } from "../analysis/quality.mjs";

const mainPhrase = (p) => {
  const raw = (p.h1s?.[0] || p.title || "").split(/\s[|:–—-]\s/)[0].trim();
  return raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
};

export function linkOpportunities(pages, { maxPerTarget = 3, minWords = 2, maxTotal = 40 } = {}) {
  const html = pages.filter((p) => p.status === 200 && p.isHtml && p.text);
  const targets = html.filter((p) => p.inSitemap).map((p) => ({ page: p, phrase: mainPhrase(p) })).filter((t) => t.phrase.split(" ").length >= minWords && t.phrase.length >= 8);
  const key = (u) => u.replace(/\/$/, "");
  const out = [];
  for (const t of targets) {
    const found = [];
    for (const s of html) {
      if (s === t.page || key(s.url) === key(t.page.url)) continue;
      if (s.links.some((l) => key(l.url) === key(t.page.url) || key(l.url) === key(t.page.finalUrl || t.page.url))) continue;
      const text = s.text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ");
      const at = text.indexOf(t.phrase);
      if (at >= 0) found.push({ from: s.url, anchor: t.phrase, context: s.text.slice(Math.max(0, at - 40), at + t.phrase.length + 40).replace(/\s+/g, " ") });
    }
    for (const f of found.slice(0, maxPerTarget)) out.push({ to: t.page.url, toTitle: t.page.title, ...f });
  }
  // Pages with few inbound links benefit most.
  const inbound = new Map(pages.map((p) => [key(p.url), p.inbound ?? 0]));
  return out.sort((a, b) => (inbound.get(key(a.to)) ?? 0) - (inbound.get(key(b.to)) ?? 0)).slice(0, maxTotal);
}

const TITLE_STOP = new Set(["a", "an", "the", "and", "or", "for", "of", "to", "in", "on", "at", "by", "with", "how", "what", "why", "when", "your", "our", "you", "we", "is", "are", "vs", "guide", "guides", "page", "home", "best", "one", "all", "more", "new", "get", "can", "use", "about", "from", "that", "this", "it", "its", "who", "us", "do", "does", "before", "after", "make", "things", "work", "works", "ask", "need", "should"]);
const titleWords = (s) => new Set(String(s || "").split(/\s[|:–—-]\s/)[0].toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !TITLE_STOP.has(w)));
const sharedWords = (a, b) => [...a].filter((w) => [...b].some((x) => sameWord(w, x)));
const section = (u) => { try { return new URL(u).pathname.split("/").filter(Boolean)[0] || ""; } catch { return ""; } };

/**
 * A reviewable list of internal links to add, for the pages with the fewest inbound links first. Pure, over audit.json
 * pages ({ url, finalUrl, status, title, h1, inbound, inSitemap, links: [internal urls] }) and the audit's own mention
 * opportunities. Three reasons, strongest first:
 *   mention   the source page already names the target's topic in its text but does not link (from the audit)
 *   reverse   the target links to the source (not through site navigation) and they share a topic word, but the source
 *             does not link back
 *   sibling   same site section and at least two shared title words
 * Nothing is edited: a person or the refresher agent adds the links that make sense to a reader.
 */
export function relatedLinks(pages = [], mentions = [], { maxInbound = 2, perTarget = 3, maxTotal = 60 } = {}) {
  const key = (u) => String(u || "").replace(/\/$/, "");
  const live = pages.filter((p) => p.status === 200 && Array.isArray(p.links));
  const byKey = new Map(live.map((p) => [key(p.finalUrl || p.url), p]));
  const linksTo = (from, to) => from.links.some((l) => key(l) === key(to.url) || key(l) === key(to.finalUrl || to.url));
  // Links on half the pages or more are navigation (menu, footer, breadcrumbs), not a sign that two pages are related.
  const linkCount = new Map();
  for (const p of live) for (const l of new Set(p.links.map(key))) linkCount.set(l, (linkCount.get(l) || 0) + 1);
  const nav = new Set([...linkCount].filter(([, n]) => live.length >= 10 && n / live.length >= 0.5).map(([l]) => l));
  // Words in half the site's titles say nothing about which pages belong together (quality.mjs siteWords).
  const common = siteWords(live.map((p) => p.title));
  const topic = (p) => new Set([...titleWords(p.h1 || p.title)].filter((w) => !common.has(w)));
  const targets = live.filter((p) => p.inSitemap !== false && (p.inbound ?? 0) <= maxInbound && key(new URL(p.url).pathname) !== "").sort((a, b) => (a.inbound ?? 0) - (b.inbound ?? 0));
  const out = [];
  for (const t of targets) {
    const tw = topic(t), seen = new Set(), picks = [];
    const push = (from, reason, evidence) => { const k = key(from.url); if (k === key(t.url) || seen.has(k) || linksTo(from, t)) return; seen.add(k); picks.push({ to: t.url, toTitle: t.title || t.h1 || "", inbound: t.inbound ?? 0, from: from.url, fromTitle: from.title || "", reason, anchor: t.h1 || (t.title || "").split(/\s[|:–—-]\s/)[0], evidence }); };
    for (const m of mentions.filter((m) => key(m.to) === key(t.url))) { const from = byKey.get(key(m.from)) || live.find((p) => key(p.url) === key(m.from)); if (from) push(from, "mention", `mentions "${m.anchor}": "${m.context}"`); }
    for (const l of t.links) {
      if (nav.has(key(l))) continue;
      const from = byKey.get(key(l)) || live.find((p) => key(p.url) === key(l));
      if (!from) continue;
      const shared = sharedWords(topic(from), tw);
      if (shared.length) push(from, "reverse", `this page links to it; shared topic: ${shared.join(", ")}`);
    }
    for (const from of live) {
      if (section(from.url) !== section(t.url) || !section(t.url)) continue;
      const shared = sharedWords(topic(from), tw);
      if (shared.length >= 2) push(from, "sibling", `same section; shared topic: ${shared.join(", ")}`);
    }
    out.push(...picks.slice(0, perTarget));
  }
  return out.slice(0, maxTotal);
}

export { tokens };
