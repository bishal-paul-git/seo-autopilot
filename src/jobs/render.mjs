// Rendered vs delivered: loads sitemap pages in a headless browser and compares what JavaScript shows with the HTML the
// server sent. Optional: needs Playwright (npm i --no-save playwright && npx playwright install chromium), and skips
// cleanly without it. SEO_CHROMIUM_PATH points it at a Chromium you already have. Read-only.
//   npx seo-autopilot run render [--max-pages 20]
// Writes <state>/<site>/render.json and render.md.
import { createRequire } from "node:module";
import { join } from "node:path";
import { writeJson, writeText, today } from "../core/util.mjs";
import { mainScope, blockText, stripTags } from "../audit/extract.mjs";
import { compareRender } from "../analysis/render.mjs";

export const description = "Rendered vs delivered HTML (optional headless browser): prerendered text not on the page, JS-only content";

/** Playwright from the project, the package, NODE_PATH or a global install; null when none is found. */
async function loadPlaywright(root) {
  try { return await import("playwright"); } catch { /* not resolvable as a module here */ }
  for (const from of [join(root, "package.json"), import.meta.url]) {
    try { return createRequire(from)("playwright"); } catch { /* try the next place */ }
  }
  return null;
}

// Full DOM text, one line per block. Not innerText: that drops content hidden by CSS, such as a collapsed FAQ answer,
// which is on the page for anyone who opens it.
const snapshot = (page) => page.evaluate(() => {
  const scope = (document.querySelector("main") || document.body).cloneNode(true);
  scope.querySelectorAll("script,style,noscript,template,svg").forEach((n) => n.remove());
  scope.querySelectorAll("p,div,li,h1,h2,h3,h4,h5,h6,section,article,header,footer,nav,aside,tr,td,th,br,dt,dd,blockquote,figcaption,button,label,summary,details").forEach((n) => n.append("\n"));
  const h1 = document.querySelector("main h1") || document.querySelector("h1");
  return { title: document.title, h1: h1 ? h1.textContent.replace(/\s+/g, " ").trim() : "", lines: scope.textContent.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean) };
});

/**
 * What a visitor can read, including what they can open: <details>, ARIA disclosures (aria-expanded="false") and FAQ
 * buttons whose text is a question. Many accordions add an answer only while it is open and close the last one when the
 * next opens, so the text is read after every click and the lines are merged.
 */
async function readable(page, max = 60) {
  const first = await snapshot(page);
  const lines = new Set(first.lines);
  const take = async () => { for (const l of (await snapshot(page).catch(() => ({ lines: [] }))).lines) lines.add(l); };
  await page.evaluate(() => document.querySelectorAll("details:not([open])").forEach((d) => { d.open = true; })).catch(() => {});
  // Only question buttons and ARIA disclosures are clicked, never other buttons, which could submit a form or start an action.
  await page.evaluate(() => {
    for (const b of document.querySelectorAll("main button:not([type=submit])")) {
      const t = b.textContent.replace(/\s+/g, " ").trim();
      if (/\?\s*[+\-−–▾▼⌄›>]?$/.test(t)) b.setAttribute("data-seo-autopilot-open", "");
    }
    for (const b of document.querySelectorAll('main [aria-expanded="false"]')) b.setAttribute("data-seo-autopilot-open", "");
  }).catch(() => {});
  await take();
  const toOpen = page.locator("[data-seo-autopilot-open]");
  const n = Math.min(await toOpen.count().catch(() => 0), max);
  const home = page.url();
  for (let i = 0; i < n; i++) {
    await toOpen.nth(i).click({ timeout: 2000, force: true }).catch(() => {});
    if (page.url() !== home) { await page.goto(home, { waitUntil: "networkidle" }).catch(() => {}); break; }
    await page.waitForTimeout(150);
    await take();
  }
  return { title: first.title, h1: first.h1, text: [...lines].join("\n") };
}

const rawView = (html) => ({
  title: stripTags((String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""),
  h1: stripTags((mainScope(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || ""),
  text: blockText(mainScope(html)),
});

export async function run({ site, cfg, flags }) {
  const pw = await loadPlaywright(cfg?.root || process.cwd());
  if (!pw) { console.log("render: Playwright is not installed (npm i --no-save playwright && npx playwright install chromium). Skipped."); return; }
  let urls = [];
  try { urls = [...(await (await fetch(site.sitemap, { signal: AbortSignal.timeout(20000) })).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()); } catch { /* unreachable */ }
  const max = Number(flags["max-pages"] ?? 20);
  if (!urls.length) { console.log(`render: no URLs in ${site.sitemap}. Skipped.`); return; }
  const browser = await pw.chromium.launch({ headless: true, ...(process.env.SEO_CHROMIUM_PATH ? { executablePath: process.env.SEO_CHROMIUM_PATH } : {}) });
  const results = [];
  try {
    const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (compatible; seo-autopilot-render/1.0)" });
    for (const url of urls.slice(0, max)) {
      try {
        const r = await fetch(url, { headers: { "user-agent": "seo-autopilot-render/1.0" }, signal: AbortSignal.timeout(15000) });
        const raw = rawView(await r.text());
        const page = await ctx.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
          const rendered = await readable(page);
          results.push({ url, ...compareRender(raw, rendered) });
        } finally { await page.close().catch(() => {}); }
      } catch (e) { results.push({ url, error: `${e.name}: ${String(e.message).split("\n")[0]}`.slice(0, 200), findings: [] }); }
    }
  } finally { await browser.close().catch(() => {}); }

  const flagged = results.filter((x) => x.findings.length);
  writeJson(`${site.paths.state}/render.json`, { generatedAt: new Date().toISOString(), checked: results.length, of: urls.length, results });
  const p = (u) => u.replace(site.url, "/");
  const md = `# ${site.name} rendered vs delivered HTML ${today()}

Loaded ${results.length} of ${urls.length} sitemap page(s) in a headless browser and compared the page after JavaScript with the HTML the server sent. ${flagged.length} page(s) differ in a way that matters.${results.some((x) => x.error) ? ` ${results.filter((x) => x.error).length} could not be loaded.` : ""}

${flagged.map((x) => `## ${p(x.url)}\n${x.findings.map((f) => `- **${f.title}** (${f.severity}): ${f.evidence.join("; ")}. ${f.fix}`).join("\n")}`).join("\n\n") || "No differences that matter: the delivered HTML matches what visitors see."}
${results.filter((x) => x.error).map((x) => `- could not load ${p(x.url)}: ${x.error}`).join("\n")}
`;
  writeText(`${site.paths.state}/render.md`, md);
  console.log(md);
}
