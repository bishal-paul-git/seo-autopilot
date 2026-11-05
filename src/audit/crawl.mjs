// A small, polite crawler for auditing your own site. It reads your sitemap, fetches each page with a plain HTTP
// request (what a crawler sees before running JavaScript), records redirect chains and timings, and follows internal
// links to build the link graph (inbound links and click depth).
import { createHash } from "node:crypto";
import { extractPage } from "./extract.mjs";
import { sleep } from "../core/util.mjs";

const UA = "seo-autopilot-audit/2 (+https://github.com/bishal-paul-git/seo-autopilot)";

/** Fetch a URL, following redirects by hand so the chain is recorded. */
export async function fetchPage(url, { timeout = 20000, maxHops = 6, method = "GET", fetchImpl = fetch } = {}) {
  const chain = [];
  let current = url, started = Date.now(), ttfb = 0;
  for (let hop = 0; hop <= maxHops; hop++) {
    let res;
    try {
      res = await fetchImpl(current, { method, redirect: "manual", signal: AbortSignal.timeout(timeout), headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } });
    } catch (e) { return { url, finalUrl: current, status: 0, chain, error: String(e.message).slice(0, 120), ttfb: 0, isHtml: false }; }
    if (hop === 0) ttfb = Date.now() - started;
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      chain.push(current);
      current = new URL(res.headers.get("location"), current).toString();
      continue;
    }
    const type = res.headers.get("content-type") || "";
    const isHtml = /html/i.test(type);
    const body = method === "GET" && isHtml ? (await res.text()).slice(0, 2_000_000) : "";
    return { url, finalUrl: current, status: res.status, chain, ttfb, isHtml, html: body, xRobots: res.headers.get("x-robots-tag") || "", type };
  }
  return { url, finalUrl: current, status: 0, chain, error: "too many redirects", ttfb, isHtml: false };
}

const hashText = (t) => createHash("sha1").update(t.toLowerCase().replace(/\s+/g, " ").slice(0, 3000)).digest("hex");
const strip = (u) => u.replace(/\/$/, "");

async function pool(items, size, worker, delay = 0) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await worker(items[i], i); if (delay) await sleep(delay); }
  }));
  return out;
}


/**
 * Link graph: inbound counts and click depth from the home page (internal links to HTML pages only). Shared by the built-in
 * crawler and the Go engine so both feed the audit rules identical data. Mutates each page: p.inbound, p.depth.
 */
export function linkGraph(list, homeUrl) {
  const pages = new Map(list.map((p) => [strip(p.url), p]));
  const key = (u) => strip(u);
  const finalToKey = new Map(list.map((p) => [key(p.finalUrl || p.url), key(p.url)]));
  const inbound = new Map(list.map((p) => [key(p.url), new Set()]));
  const adj = new Map();
  for (const p of list) {
    const targets = new Set();
    for (const l of p.links || []) {
      const k = key(l.url), t = pages.has(k) ? k : finalToKey.get(k);
      if (t && t !== key(p.url)) { targets.add(t); inbound.get(t)?.add(key(p.url)); }
    }
    adj.set(key(p.url), targets);
  }
  const home = key(homeUrl), depth = new Map([[home, 0]]), q = [home];
  while (q.length) { const c = q.shift(); for (const n of adj.get(c) || []) if (!depth.has(n)) { depth.set(n, depth.get(c) + 1); q.push(n); } }
  for (const p of list) { p.inbound = inbound.get(key(p.url))?.size ?? 0; p.depth = depth.has(key(p.url)) ? depth.get(key(p.url)) : null; }
}

/**
 * Crawl the site. Returns { pages, ctx } ready for runChecks().
 * opts: { maxPages, concurrency, fetchImpl }
 */
export async function crawlSite(site, opts = {}) {
  const engine = opts.engine ?? site.audit?.engine ?? "node";
  if (engine === "go" || engine === "auto") {
    const { crawlWithGo, findGoEngine } = await import("./engines.mjs");
    if (findGoEngine()) {
      const r = await crawlWithGo(site, opts);
      linkGraph(r.pages, site.url);
      return r;
    }
    if (engine === "go") console.log("audit: the Go engine was requested but neither a built seo-crawl nor the Go toolchain was found; using the built-in crawler.");
  }
  const maxPages = opts.maxPages ?? site.audit?.maxPages ?? 300;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const host = new URL(site.url).host;
  const isInternal = (u) => { try { return new URL(u).host.replace(/^www\./, "") === host.replace(/^www\./, ""); } catch { return false; } };

  const sm = await fetchImpl(site.sitemap, { headers: { "User-Agent": UA } }).then((r) => r.text()).catch(() => "");
  const sitemapUrls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const robots = await fetchImpl(new URL("/robots.txt", site.url), { headers: { "User-Agent": UA } }).then((r) => (r.ok ? r.text() : null)).catch(() => null);

  const queue = [site.url, ...sitemapUrls];
  const seen = new Set(queue.map(strip));
  const pages = new Map();
  const inSitemap = new Set(sitemapUrls.map(strip));

  for (let round = 0; round < 3 && queue.length && pages.size < maxPages; round++) {
    const batch = queue.splice(0, queue.length).slice(0, maxPages - pages.size);
    const results = await pool(batch, opts.concurrency ?? 6, (u) => fetchPage(u, { fetchImpl }), 120);
    for (const r of results) {
      const rec = { url: r.url, finalUrl: r.finalUrl, status: r.status, chain: r.chain, ttfb: r.ttfb, xRobots: r.xRobots || "", isHtml: r.isHtml, inSitemap: inSitemap.has(strip(r.url)) };
      if (r.isHtml && r.status === 200) {
        const x = extractPage(r.html, r.finalUrl);
        Object.assign(rec, x, { textHash: hashText(x.text) });
        for (const l of x.links) if (isInternal(l.url) && !seen.has(strip(l.url)) && !/\.(pdf|jpe?g|png|gif|svg|webp|zip|xml|json|txt|ico|css|js|mp3|mp4)(\?|$)/i.test(l.url)) { seen.add(strip(l.url)); queue.push(l.url); }
      } else Object.assign(rec, { title: "", description: null, robots: "", viewport: null, canonical: null, alternates: [], h1s: [], h2s: [], headings: [], lang: null, jsonld: { types: [], invalid: 0 }, links: [], images: 0, imagesNoAlt: 0, mixed: [], words: 0, text: "" });
      pages.set(strip(r.url), rec);
    }
  }

  const list = [...pages.values()];
  linkGraph(list, site.url);
  const key = (u) => strip(u);
  const finalToKey = new Map(list.map((p) => [key(p.finalUrl || p.url), key(p.url)]));

  // Internal link targets we did not crawl: check they resolve (HEAD), capped.
  const unknownTargets = new Set();
  for (const p of list) for (const l of p.links) if (isInternal(l.url) && !pages.has(key(l.url)) && !finalToKey.has(key(l.url))) unknownTargets.add(l.url);
  const brokenTargets = new Map();
  const probe = [...unknownTargets].filter((u) => !/\.(pdf|jpe?g|png|gif|svg|webp|zip|xml|json|txt|ico|css|js|mp3|mp4)(\?|$)/i.test(u)).slice(0, 150);
  await pool(probe, 6, async (u) => { const r = await fetchPage(u, { method: "HEAD", fetchImpl }); if (r.status >= 400 || r.status === 0) brokenTargets.set(u, r.status); }, 100);

  // Images the pages use: check they load (HEAD; a server that refuses HEAD with 405 is not counted as broken), capped.
  const brokenImages = new Map();
  const images = [...new Set(list.flatMap((p) => p.imageSrcs || []))].slice(0, opts.maxImages ?? 80);
  await pool(images, 6, async (u) => { const r = await fetchPage(u, { method: "HEAD", fetchImpl, timeout: 10000 }); if ((r.status >= 400 && r.status !== 405) || r.status === 0) brokenImages.set(u, r.status || "no response"); }, 50);

  // The other addresses of the home page (http://, and www or not) should redirect to the address the site uses.
  const home = new URL(site.url);
  const alt = home.hostname.startsWith("www.") ? home.hostname.slice(4) : `www.${home.hostname}`;
  const hostVariants = [];
  for (const v of [`http://${home.hostname}/`, `https://${alt}/`]) {
    const r = await fetchPage(v, { fetchImpl, timeout: 10000 });
    if (r.status === 0 && !r.chain.length) continue; // that name does not resolve: nothing to redirect
    let final; try { final = new URL(r.finalUrl); } catch { continue; }
    hostVariants.push({ from: v, to: r.finalUrl, status: r.status, ok: final.protocol === "https:" && final.hostname === home.hostname });
  }

  return { pages: list, ctx: { robotsTxt: robots, sitemapUrls, brokenTargets, brokenImages, hostVariants, tls: opts.checkTls === false ? null : await tlsDaysLeft(home.hostname), siteHost: host } };
}

/** Days until the site's TLS certificate expires, or null when it cannot be read here (some runtimes do not expose it). */
export async function tlsDaysLeft(hostname, { timeout = 8000 } = {}) {
  try {
    const tls = await import("node:tls");
    return await new Promise((resolve) => {
      const done = (v) => { try { sock.destroy(); } catch { /* closed */ } resolve(v); };
      const sock = tls.connect({ host: hostname, port: 443, servername: hostname, timeout }, () => {
        const c = sock.getPeerCertificate?.();
        const end = c && c.valid_to ? Date.parse(c.valid_to) : NaN;
        done(Number.isFinite(end) ? { daysLeft: Math.floor((end - Date.now()) / 864e5), validTo: new Date(end).toISOString().slice(0, 10) } : null);
      });
      sock.on("error", () => done(null)); sock.on("timeout", () => done(null));
    });
  } catch { return null; }
}
