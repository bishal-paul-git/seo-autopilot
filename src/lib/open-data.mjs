// Open data with no key: Wikipedia pageviews (how interest in a topic moves month to month) and Stack Exchange questions
// (what people actually ask, in their words). Both are official public APIs; `fetch` is injectable so tests never touch the
// network. Request shapes follow each API's public documentation; not yet run live from a scheduled job.
//   Wikimedia asks every client to send a User-Agent that names it and gives a contact: https://meta.wikimedia.org/wiki/User-Agent_policy
//   Stack Exchange allows 300 requests a day per IP without a key; set STACKEXCHANGE_KEY (free) for 10,000.
import { market } from "./research-sources.mjs";

const UA = "seo-autopilot (https://github.com/bishal-paul-git/seo-autopilot)";
const LANG = { DE: "de", AT: "de", FR: "fr", ES: "es", IT: "it", NL: "nl" };
export const wikiLang = (m) => LANG[market(m)] || "en";

async function getJson(f, name, url) {
  let r;
  try { r = await f(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30000) }); } catch (e) { throw new Error(`${name}: request failed (${e.name || "error"})`); }
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}${r.status === 429 ? " (rate limited)" : ""}`);
  return r.json();
}

const ym = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export const wikipedia = {
  name: "wikipedia",
  /** The article a seed most likely means, or null. Search ranking is Wikipedia's own. */
  async article(seed, m, { fetch: f = fetch } = {}) {
    const lang = wikiLang(m);
    const j = await getJson(f, "wikipedia", `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ action: "query", list: "search", srsearch: seed, srlimit: "1", format: "json" })}`);
    const t = j.query?.search?.[0]?.title;
    return t ? { title: t, lang, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, "_"))}` } : null;
  },
  /** Monthly human pageviews for the last 12 full months, oldest first: [{ month: "2026-09", views }]. */
  async pageviews(title, lang, { fetch: f = fetch, today = new Date() } = {}) {
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)), start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
    const art = encodeURIComponent(title.replace(/ /g, "_"));
    const j = await getJson(f, "wikipedia", `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/${art}/monthly/${ym(start)}0100/${ym(end)}0100`);
    return (j.items || []).map((i) => ({ month: `${String(i.timestamp).slice(0, 4)}-${String(i.timestamp).slice(4, 6)}`, views: Number(i.views) || 0 }));
  },
};

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
export const decode = (s) => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (x, e) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? x));

export const stackexchange = {
  name: "stackexchange",
  /** Questions on one Stack Exchange site matching a seed, most viewed first: [{ title, url, site, views, score, answers, answered, created }]. */
  async questions(seed, site, { fetch: f = fetch, env = process.env, limit = 30 } = {}) {
    const p = new URLSearchParams({ order: "desc", sort: "relevance", q: seed, site, pagesize: String(limit) });
    if (env.STACKEXCHANGE_KEY) p.set("key", env.STACKEXCHANGE_KEY);
    const j = await getJson(f, "stackexchange", `https://api.stackexchange.com/2.3/search/advanced?${p}`);
    if (j.error_id) throw new Error(`stackexchange: ${j.error_name || j.error_id}`);
    return (j.items || []).map((q) => ({
      title: decode(q.title), url: q.link, site, views: q.view_count ?? null, score: q.score ?? null, answers: q.answer_count ?? 0, answered: Boolean(q.is_answered),
      created: q.creation_date ? new Date(q.creation_date * 1000).toISOString().slice(0, 10) : null,
    })).filter((q) => q.title && q.url);
  },
};
