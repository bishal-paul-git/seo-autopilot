// Crawler log analysis from your own server access logs (no API key, nothing leaves your machine or runner):
//   npx seo-autopilot run logs [--file access.log,access.log.1.gz] [--verify]
// Put log files (plain or .gz) in <dataDir>/logs/ (or "logs": { "dir": "..." }), or pass --file. --verify checks that
// Googlebot and Bingbot requests really came from Google and Microsoft (reverse DNS, then forward DNS back to the same
// address), as both document; fakes are left out. Writes <state>/<site>/logs.json and logs.md with totals only: no IP
// address or visitor detail is stored. Compares what Googlebot requested with your sitemap and noindex pages (audit.json).
import { existsSync, readdirSync, createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { promises as dns } from "node:dns";
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { parseLine, crawlerOf, createCollector } from "../analysis/logs.mjs";

export const description = "Crawler log analysis: what Googlebot and AI crawlers requested, crawl wasted on errors and redirects, sitemap pages not crawled";

/** Reverse then forward DNS, as Google and Bing document for verifying their crawlers. */
async function verifyIp(ip, suffix) {
  try {
    const names = await dns.reverse(ip);
    for (const n of names) {
      if (!suffix.test(n)) continue;
      const fwd = [...await dns.resolve4(n).catch(() => []), ...await dns.resolve6(n).catch(() => [])];
      if (fwd.includes(ip)) return true;
    }
    return false;
  } catch { return false; }
}

const pathOf = (u) => { try { return new URL(u).pathname; } catch { return null; } };

export async function run({ site, flags = {} }) {
  const s = site.paths.state;
  const dir = resolve(site.paths.root, site.logs?.dir ?? join(site.paths.data, "logs"));
  const files = typeof flags.file === "string" ? flags.file.split(",").map((f) => resolve(site.paths.root, f.trim()))
    : existsSync(dir) ? readdirSync(dir).filter((f) => /\.(log|txt|json|jsonl|ndjson)(\.\d+)?(\.gz)?$|\.gz$/i.test(f)).sort().map((f) => join(dir, f)) : [];
  if (!files.length) {
    console.log(`No access logs found. Download them from your host or CDN and save them in ${dir} (plain or .gz), or pass --file.`);
    return;
  }
  const verify = Boolean(flags.verify);
  const cache = new Map();
  const maxLookups = Number(flags["max-lookups"] ?? 300);
  const col = createCollector();
  let unparsed = 0;
  for (const f of files) {
    const stream = /\.gz$/i.test(f) ? createReadStream(f).pipe(createGunzip()) : createReadStream(f);
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      const r = parseLine(line);
      if (!r) { if (line.trim()) unparsed++; continue; }
      const c = crawlerOf(r.ua);
      let verified;
      if (verify && c?.verify && r.ip) {
        const key = `${c.name}|${r.ip}`;
        if (!cache.has(key) && cache.size < maxLookups) cache.set(key, await verifyIp(r.ip, c.verify));
        verified = cache.get(key);
      }
      col.add(r, { verified });
    }
  }
  const audit = readJson(`${s}/audit.json`, null);
  const pages = audit?.pages || [];
  const r = col.finish({
    sitemapPaths: pages.filter((p) => p.inSitemap && p.status === 200).map((p) => pathOf(p.url)).filter(Boolean),
    noindexPaths: pages.filter((p) => p.noindex).map((p) => pathOf(p.url)).filter(Boolean),
  });
  writeJson(`${s}/logs.json`, { generatedAt: new Date().toISOString(), files: files.length, unparsed, verified: verify, lookups: cache.size, auditGeneratedAt: audit?.generatedAt || null, ...r });

  const g = r.googlebot;
  const kinds = { search: "search engine", "ai-search": "AI search (cites pages in answers)", "ai-user": "fetched for a person using an AI tool", "ai-training": "AI model training" };
  const md = `# Crawlers in your access logs (${today()})

${r.lines} request line(s) from ${files.length} file(s), ${r.window.first?.slice(0, 10) || "?"} to ${r.window.last?.slice(0, 10) || "?"}${unparsed ? `; ${unparsed} line(s) not recognised as requests` : ""}. ${verify ? `Googlebot and Bingbot checked by DNS (${cache.size} address(es)); fakes left out.` : "Crawlers are identified by user agent only (claimed). Run with --verify to confirm Googlebot and Bingbot by DNS."}

## Who crawled
${r.crawlers.length ? r.crawlers.map((c) => `- **${c.name}** (${kinds[c.kind]}): ${c.hits} request(s), ${c.pages} page(s); ${Object.entries(c.status).map(([k, v]) => `${k} ${v}`).join(", ")}${c.paramShare ? `; ${c.paramShare}% with parameters` : ""}${c.failedVerify ? `; ${c.failedVerify} fake` : ""}`).join("\n") : "- No known crawler in these logs."}

${g ? `## Googlebot
- Crawl spent on errors, redirects and parameter URLs: ${g.wastedShare}% of page requests.
- Sitemap pages not requested in this window: ${g.sitemapNotCrawledCount} of ${g.sitemapPages}${g.sitemapNotCrawled.length ? ` (e.g. ${g.sitemapNotCrawled.slice(0, 8).join(", ")})` : ""}.
${g.errors.length ? `- Errors it hit: ${g.errors.slice(0, 8).map((e) => `${e.path} (${e.status.join("/")}, ${e.hits}x)`).join(", ")}` : "- No error responses to Googlebot."}
${g.redirects.length ? `- Redirects it followed: ${g.redirects.slice(0, 8).map((e) => `${e.path} (${e.hits}x)`).join(", ")}` : "- No redirects followed."}
- Most requested: ${g.topPages.slice(0, 8).map((p) => `${p.path} (${p.hits})`).join(", ")}
` : ""}
## Findings
${r.findings.length ? r.findings.map((f) => `- **${f.title}.** ${f.detail}`).join("\n") : "- Nothing stands out in this window."}

A short window says little: compare several weeks. Allowing or blocking AI crawlers is a business decision (robots.txt rules per crawler); this report only shows who came.
`;
  writeText(`${s}/logs.md`, md);
  console.log(md);
}
