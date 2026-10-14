// Sensitive-topic review gate: which pages touch health, legal, tax, money, safety or children's topics, and do they name an
// author and a reviewer? Read-only. Writes <state>/<site>/ymyl.json and ymyl.md.   npx seo-autopilot run ymyl [--json]
import { checkYmyl, ymylMarkdown } from "../analysis/ymyl.mjs";
import { loadPages } from "../adapters/index.mjs";
import { writeJson, writeText } from "../core/util.mjs";

export const description = "Sensitive-topic review gate: health, legal, tax, money, safety pages that lack an author or reviewer";

export async function run({ site, flags = {} }) {
  const pages = await loadPages(site);
  const result = checkYmyl(pages, site.review || {}, { fieldsKnown: (site.content?.type ?? "sitemap") !== "sitemap" });
  writeJson(`${site.paths.state}/ymyl.json`, { generatedAt: new Date().toISOString(), ...result });
  const md = ymylMarkdown(result, site.name);
  writeText(`${site.paths.state}/ymyl.md`, md);
  console.log(flags.json ? JSON.stringify(result, null, 2) : md);
}
