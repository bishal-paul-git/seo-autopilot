// Facts guard: every percentage, price, "500+", "3x", award, ranking or "trusted by" claim in your content must be in your
// verified-facts file (with its source) or carry a source link in the same sentence. Ported from Erudience's hard rule.
//   npx seo-autopilot run facts [--strict] [--files a.json,b.md] [--max-pages 100]
// Reads your content files (json or markdown sites) or, for sitemap sites, the visible text of your live pages. Writes
// <state>/<site>/facts.json and facts.md. Warns by default; --strict (or "facts": { "strict": true }) exits 1 when a claim
// is unverified, so a build or pull-request check can block it. It never edits content.
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { contentFiles } from "../adapters/index.mjs";
import { visibleText } from "../audit/extract.mjs";
import { checkFacts, jsonStrings } from "../analysis/facts.mjs";

export const description = "Facts guard: numbers, prices, awards and client claims must be in verified-facts.json or sourced";

const rel = (site, f) => relative(site.paths.root, f).split("\\").join("/");

function fileTexts(site, files) {
  const out = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (/\.json$/i.test(f)) {
      let data; try { data = JSON.parse(src); } catch { out.push({ where: rel(site, f), text: "", error: "not valid JSON" }); continue; }
      for (const s of jsonStrings(data)) out.push({ where: `${rel(site, f)}: ${s.where}`, text: s.text });
    } else out.push({ where: rel(site, f), text: src });
  }
  return out;
}

async function liveTexts(site, max) {
  let urls = [];
  try { urls = [...(await (await fetch(site.sitemap, { signal: AbortSignal.timeout(20000) })).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()); } catch { /* sitemap unreachable */ }
  const out = [];
  for (const u of urls.slice(0, max)) {
    try {
      const r = await fetch(u, { headers: { "user-agent": "seo-autopilot-facts/1.0" }, signal: AbortSignal.timeout(15000) });
      if (r.ok && /html/i.test(r.headers.get("content-type") || "")) out.push({ where: u.replace(site.url, "/"), text: visibleText(await r.text()) });
    } catch { /* skip unreachable page */ }
  }
  return out;
}

export async function run({ site, flags }) {
  const factsFile = resolve(site.paths.root, site.facts?.file ?? `${site.paths.data}/verified-facts.json`);
  const facts = readJson(factsFile, { facts: [] }).facts || [];
  const strict = Boolean(flags.strict || site.facts?.strict);
  const only = typeof flags.files === "string" ? flags.files.split(",").map((f) => resolve(site.paths.root, f.trim())).filter((f) => existsSync(f)) : null;
  const files = only ?? contentFiles(site);
  const texts = files.length ? fileTexts(site, files) : only ? [] : await liveTexts(site, Number(flags["max-pages"] ?? 100));
  const from = files.length ? `${files.length} content file(s)` : only ? "no matching files" : `${texts.length} live page(s)`;
  const r = checkFacts(texts, facts);
  const broken = texts.filter((t) => t.error).map((t) => `${t.where}: ${t.error}`);
  writeJson(`${site.paths.state}/facts.json`, { generatedAt: new Date().toISOString(), from, factsFile: existsSync(factsFile) ? rel(site, factsFile) : null, strict, broken, ...r });

  const line = (c) => `- ${c.where}: **${c.claim}** (${c.kind}): "${c.sentence.slice(0, 160)}"`;
  const md = `# ${site.name} facts check ${today()}

Checked ${from} against ${existsSync(factsFile) ? `${facts.length} verified fact(s) in ${rel(site, factsFile)}` : `no verified-facts file (create ${rel(site, factsFile)})`}.
${r.unverified.length} unverified, ${r.sourced.length} with a source link in the sentence, ${r.verified.length} verified, ${r.pending.length} awaiting an owner check.

## Unverified (add to the verified-facts file with a source, link a source, or remove)
${r.unverified.slice(0, 60).map(line).join("\n") || "- none"}${r.unverified.length > 60 ? `\n- ...and ${r.unverified.length - 60} more in facts.json` : ""}
${r.pending.length ? `\n## Awaiting an owner check\n${[...new Set(r.pending.map((c) => c.claim))].map((c) => `- ${c}`).join("\n")}\n` : ""}${r.sourced.length ? `\n## Sourced in the sentence (open the link and check it says this)\n${r.sourced.slice(0, 20).map(line).join("\n")}\n` : ""}${broken.length ? `\n## Files that could not be read\n${broken.map((b) => `- ${b}`).join("\n")}\n` : ""}`;
  writeText(`${site.paths.state}/facts.md`, md);
  console.log(md);
  if (strict && (r.unverified.length || broken.length)) process.exitCode = 1;
}
