// Internal-link opportunities: pages that talk about a topic another page owns, without linking to it.
// "Owns" = the target page's main phrase (its H1, or its title before a separator). Pure function over crawl records.
import { tokens } from "../adapters/index.mjs";

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

export { tokens };
