// Server access logs: what search and AI crawlers actually requested, from the owner's own log files. Pure: feed parsed
// lines into a collector, then read the totals. Only totals are kept: no IP address or visitor detail reaches a report.
//
// Formats: the common and "combined" formats (Apache, nginx and most hosts), and JSON lines with recognisable field names
// (several CDNs and hosts export these). User agents can be faked: a request is "claimed" until DNS verification
// (the job's --verify) confirms it came from the crawler's own network. Tested on sample lines, not yet on a real host's logs.

// Ordered: the first match wins. kind: search = search engine crawler; ai-search = fetches pages to cite in AI answers;
// ai-user = fetches a page because a person asked an AI tool to; ai-training = collects pages for model training.
export const CRAWLERS = [
  { name: "Googlebot", kind: "search", re: /Googlebot(?!-Image|-Video|-News)|Google-InspectionTool/i, verify: /\.(googlebot|google)\.com$/ },
  { name: "Googlebot-Image", kind: "search", re: /Googlebot-Image/i, verify: /\.(googlebot|google)\.com$/ },
  { name: "Bingbot", kind: "search", re: /bingbot|BingPreview/i, verify: /\.search\.msn\.com$/ },
  { name: "OAI-SearchBot", kind: "ai-search", re: /OAI-SearchBot/i },
  { name: "ChatGPT-User", kind: "ai-user", re: /ChatGPT-User/i },
  { name: "GPTBot", kind: "ai-training", re: /GPTBot/i },
  { name: "Claude-SearchBot", kind: "ai-search", re: /Claude-SearchBot/i },
  { name: "Claude-User", kind: "ai-user", re: /Claude-User/i },
  { name: "ClaudeBot", kind: "ai-training", re: /ClaudeBot/i },
  { name: "PerplexityBot", kind: "ai-search", re: /PerplexityBot/i },
  { name: "Perplexity-User", kind: "ai-user", re: /Perplexity-User/i },
  { name: "Applebot", kind: "search", re: /Applebot(?!-Extended)/i },
  { name: "CCBot", kind: "ai-training", re: /CCBot/i },
  { name: "Bytespider", kind: "ai-training", re: /Bytespider/i },
  { name: "DuckDuckBot", kind: "search", re: /DuckDuckBot/i },
  { name: "YandexBot", kind: "search", re: /YandexBot/i },
];

export function crawlerOf(ua) {
  return CRAWLERS.find((c) => c.re.test(String(ua || ""))) || null;
}

const COMBINED = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)(?: [^"]*)?" (\d{3}) \S+(?: "[^"]*" "([^"]*)")?/;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const pick = (o, keys) => { for (const k of keys) if (o[k] != null && o[k] !== "") return o[k]; return null; };

function apacheDate(s) {
  const m = s.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/);
  if (!m) return null;
  const off = (Number(m[7].slice(0, 3)) * 60 + Math.sign(Number(m[7].slice(0, 3)) || 1) * Number(m[7].slice(3))) * 60000;
  return new Date(Date.UTC(+m[3], MONTHS[m[2]], +m[1], +m[4], +m[5], +m[6]) - off).toISOString();
}

/** One log line to { ip, time, method, path, status, ua }, or null if it is not a request line. */
export function parseLine(line) {
  const s = String(line).trim();
  if (!s) return null;
  if (s.startsWith("{")) {
    let o; try { o = JSON.parse(s); } catch { return null; }
    const path = pick(o, ["path", "ClientRequestURI", "ClientRequestPath", "request_uri", "uri", "url", "requestPath"]);
    const status = Number(pick(o, ["status", "statusCode", "EdgeResponseStatus", "OriginResponseStatus", "status_code", "response_code"]));
    if (!path || !status) return null;
    const t = pick(o, ["time", "timestamp", "EdgeStartTimestamp", "@timestamp", "date"]);
    const time = typeof t === "number" ? new Date(t > 1e15 ? t / 1e6 : t > 1e12 ? t : t * 1000).toISOString() : t ? new Date(t).toISOString() : null;
    return { ip: pick(o, ["ip", "ClientIP", "client_ip", "remote_addr"]), time, method: pick(o, ["method", "ClientRequestMethod", "request_method"]) || "GET", path: String(path).replace(/^https?:\/\/[^/]+/, ""), status, ua: pick(o, ["userAgent", "user_agent", "ClientRequestUserAgent", "ua", "http_user_agent"]) || "" };
  }
  const m = s.match(COMBINED);
  if (!m) return null;
  return { ip: m[1], time: apacheDate(m[2]), method: m[3], path: m[4].replace(/^https?:\/\/[^/]+/, ""), status: Number(m[5]), ua: m[6] || "" };
}

const strip = (p) => p.split("#")[0];
const noQuery = (p) => strip(p).split("?")[0] || "/";
const ASSET = /\.(css|js|mjs|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|map|mp4|webm|pdf|xml|txt|json)$/i;

/**
 * Collect crawler requests. add(record, { verified }) for each parsed line (verified: true, false or undefined = not checked);
 * finish({ sitemapPaths, noindexPaths }) returns the totals and findings.
 */
export function createCollector() {
  const bots = new Map();
  let lines = 0, first = null, last = null;
  const bot = (c) => {
    if (!bots.has(c.name)) bots.set(c.name, { name: c.name, kind: c.kind, hits: 0, verified: 0, failedVerify: 0, status: {}, pages: new Map(), params: 0, assets: 0 });
    return bots.get(c.name);
  };
  return {
    add(r, { verified } = {}) {
      lines++;
      if (r.time) { if (!first || r.time < first) first = r.time; if (!last || r.time > last) last = r.time; }
      const c = crawlerOf(r.ua);
      if (!c) return;
      const b = bot(c);
      if (verified === false) { b.failedVerify++; return; }
      b.hits++;
      if (verified === true) b.verified++;
      const cls = `${String(r.status)[0]}xx`;
      b.status[cls] = (b.status[cls] || 0) + 1;
      if (ASSET.test(noQuery(r.path))) { b.assets++; return; }
      if (strip(r.path).includes("?")) b.params++;
      const p = noQuery(r.path);
      const e = b.pages.get(p) || { hits: 0, last: null, status: {} };
      e.hits++; e.status[r.status] = (e.status[r.status] || 0) + 1;
      if (r.time && (!e.last || r.time > e.last)) e.last = r.time;
      b.pages.set(p, e);
    },
    finish({ sitemapPaths = [], noindexPaths = [] } = {}) {
      const list = [...bots.values()].sort((a, b) => b.hits - a.hits);
      const g = bots.get("Googlebot");
      const summary = list.map((b) => ({ name: b.name, kind: b.kind, hits: b.hits, verified: b.verified, failedVerify: b.failedVerify, status: b.status, pages: b.pages.size, paramShare: b.hits ? Math.round((b.params / b.hits) * 100) : 0, assetShare: b.hits ? Math.round((b.assets / b.hits) * 100) : 0 }));
      const out = { window: { first, last }, lines, crawlers: summary, findings: [] };
      if (!g) {
        out.findings.push({ id: "no-googlebot", severity: sitemapPaths.length ? "medium" : "low", title: "No Googlebot requests in these logs", detail: "Either the logs are too short or filtered, the site is not crawled, or Googlebot is blocked before it reaches this server (a CDN or firewall)." });
        return out;
      }
      const pages = [...g.pages];
      const errors = pages.filter(([, e]) => Object.keys(e.status).some((s) => s >= 400)).map(([p, e]) => ({ path: p, hits: e.hits, status: Object.keys(e.status).map(Number).filter((s) => s >= 400) }));
      const redirects = pages.filter(([, e]) => Object.keys(e.status).some((s) => s >= 300 && s < 400)).map(([p, e]) => ({ path: p, hits: e.hits }));
      const wastedHits = errors.reduce((n, x) => n + x.hits, 0) + redirects.reduce((n, x) => n + x.hits, 0) + g.params;
      const pageHits = g.hits - g.assets;
      const crawled = new Set(pages.map(([p]) => p));
      const norm = (p) => p.replace(/\/$/, "") || "/";
      const crawledNorm = new Set([...crawled].map(norm));
      const notCrawled = sitemapPaths.filter((p) => !crawledNorm.has(norm(p)));
      const noindexCrawled = noindexPaths.filter((p) => crawledNorm.has(norm(p)));
      out.googlebot = {
        topPages: pages.sort((a, b) => b[1].hits - a[1].hits).slice(0, 20).map(([path, e]) => ({ path, hits: e.hits, last: e.last })),
        errors: errors.sort((a, b) => b.hits - a.hits).slice(0, 30),
        redirects: redirects.sort((a, b) => b.hits - a.hits).slice(0, 30),
        wastedShare: pageHits ? Math.round((wastedHits / pageHits) * 100) : 0,
        sitemapPages: sitemapPaths.length,
        sitemapNotCrawled: notCrawled.slice(0, 50),
        sitemapNotCrawledCount: notCrawled.length,
        noindexCrawled: noindexCrawled.slice(0, 30),
      };
      if (g.failedVerify) out.findings.push({ id: "fake-googlebot", severity: "low", title: `${g.failedVerify} request(s) claimed to be Googlebot but failed DNS verification`, detail: "They were left out of every figure. Fake crawlers are common and usually harmless; block them at the firewall if they cost you." });
      if (out.googlebot.wastedShare >= 25 && pageHits >= 100) out.findings.push({ id: "crawl-waste", severity: "medium", title: `${out.googlebot.wastedShare}% of Googlebot's page requests hit errors, redirects or parameter URLs`, detail: "Fix internal links that point at redirects or missing pages, and stop linking parameter variants, so crawling goes to pages that matter." });
      if (sitemapPaths.length >= 10 && notCrawled.length / sitemapPaths.length >= 0.3) out.findings.push({ id: "sitemap-not-crawled", severity: "medium", title: `${notCrawled.length} of ${sitemapPaths.length} sitemap pages were not requested by Googlebot in this window`, detail: "Over a short window this is normal for a large site. Over weeks it suggests weak internal links or pages Google does not value; check them in Search Console." });
      if (noindexCrawled.length >= 5) out.findings.push({ id: "noindex-crawled", severity: "low", title: `Googlebot keeps requesting ${noindexCrawled.length} noindex page(s)`, detail: "Fine in small numbers. If they are many, link to them less or block a whole low-value section in robots.txt (blocked pages are not crawled, so a noindex on them is never seen)." });
      return out;
    },
  };
}
