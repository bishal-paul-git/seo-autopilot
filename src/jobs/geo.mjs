// GEO / AEO readiness: can AI search and answer engines reach, read and cite your pages? Checks AI-crawler access in robots.txt,
// llms.txt, and a sample of pages for answer-first structure, extractable content, entity and trust signals. Read-only (GET).
// Writes <state>/geo.json and geo.md.   npx seo-autopilot run geo [--pages 25]
import { fetchPage } from "../audit/crawl.mjs";
import { checkRobots, checkLlmsTxt, checkPage, summariseGeo } from "../geo/check.mjs";
import { readJson, writeJson, writeText, today } from "../core/util.mjs";

export const description = "AI search readiness (GEO/AEO): AI-crawler access, llms.txt, answer-first structure, entity and trust signals";

export async function run({ site, flags }) {
  const n = Number(flags.pages || site.geo?.pages || 25);
  const origin = new URL(site.url).origin;
  const text = async (p) => { try { const r = await fetch(origin + p, { signal: AbortSignal.timeout(20000) }); return { status: r.status, body: r.status === 200 ? await r.text() : "" }; } catch { return { status: 0, body: "" }; } };
  const rb = await text("/robots.txt");
  const robotsTxt = rb.status === 200 ? rb.body : null;
  const lm = await text("/llms.txt");
  const llms = checkLlmsTxt(lm.body, lm.status);

  // Sample: home page, then the pages from the last audit (or the sitemap), spread across the list.
  const audit = readJson(`${site.paths.state}/audit.json`, null);
  let urls = audit?.pages?.filter((p) => p.status === 200).map((p) => p.url) || [];
  if (!urls.length) {
    const sm = await fetch(site.sitemap).then((r) => r.text()).catch(() => "");
    urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  }
  const step = Math.max(1, Math.floor(urls.length / n));
  const sample = [...new Set([site.url, ...urls.filter((_, i) => i % step === 0)])].slice(0, n);
  const pages = [];
  for (const u of sample) {
    const r = await fetchPage(u).catch(() => null);
    if (r && r.status === 200 && r.isHtml) pages.push(checkPage(r.html, r.finalUrl));
  }

  const robots = checkRobots(robotsTxt);
  const findings = summariseGeo({ robots, llms, pages });
  writeJson(`${site.paths.state}/geo.json`, { generatedAt: new Date().toISOString(), robots, llms, findings, pages });
  const md = `# ${site.name} AI search readiness ${today()}

Checked ${pages.length} pages. These are practices that tend to help being found and cited by AI search; none is a guarantee, and nobody outside the AI companies can see exactly how they choose sources.

## AI crawler access (robots.txt)
${robots.map((b) => `- ${b.name} (${b.owner}, ${b.purpose}): ${b.state}`).join("\n")}

## llms.txt
${llms.present ? `Present${llms.hasTitle ? "" : " (no title line)"}, ${llms.links} links.` : "Not present."}

## Findings
${findings.map((x) => `### ${x.title} (${x.severity})\n**Why it matters:** ${x.why}\n**How to fix:** ${x.fix}${x.detail ? `\n${x.detail}` : ""}`).join("\n\n") || "Nothing to flag."}
`;
  writeText(`${site.paths.state}/geo.md`, md);
  console.log(md);
}
