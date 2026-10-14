// The site profile decides which platform a site is on and whether agents may edit it; the router decides who runs next.
import test from "node:test";
import assert from "node:assert/strict";
import { detectProfile, renderingOf, structuredDataTypes } from "../src/analysis/site-profile.mjs";
import { routeAgents, planMarkdown } from "../src/analysis/agent-router.mjs";

const page = (body, head = "") => `<!doctype html><html><head><title>t</title>${head}</head><body>${body}</body></html>`;
const prose = "word ".repeat(200);

test("recognises a WordPress site from its HTML and puts agents in advise mode", () => {
  const p = detectProfile({ html: page(`<p>${prose}</p>`, '<link rel="stylesheet" href="/wp-content/themes/x/style.css">') });
  assert.equal(p.platform.name, "WordPress");
  assert.equal(p.mode, "advise");
  assert.equal(p.agentsMayEditFiles, false);
});

test("recognises hosted builders and never offers edit mode", () => {
  for (const [name, html] of [["Wix", '<img src="https://static.wixstatic.com/a.png">'], ["Squarespace", '<script src="https://static1.squarespace.com/x.js">'], ["Webflow", '<html data-wf-site="abc">'], ["Framer", '<img src="https://framerusercontent.com/a.png">']]) {
    const p = detectProfile({ html: page(`<p>${prose}</p>${html}`), files: ["README.md"] });
    assert.equal(p.platform.name, name);
    assert.equal(p.mode, "advise", name);
  }
});

test("recognises frameworks and static generators from package.json and config files, in edit mode", () => {
  const cases = [
    [{ pkg: { dependencies: { next: "15", react: "19" } }, files: ["package.json", "next.config.mjs"] }, "Next.js"],
    [{ pkg: { devDependencies: { astro: "5" } }, files: ["astro.config.mjs"] }, "Astro"],
    [{ pkg: { dependencies: { "@tanstack/react-start": "1" } }, files: ["package.json"] }, "TanStack Start"],
    [{ files: ["hugo.toml", "content/posts/a.md"] }, "Hugo"],
    [{ files: ["_config.yml", "_posts/2025-01-01-a.md"] }, "Jekyll"],
    [{ files: ["index.html", "about.html", "css/site.css"] }, "Static HTML"],
  ];
  for (const [input, name] of cases) {
    const p = detectProfile({ ...input, html: page(`<h1>x</h1><p>${prose}</p>`) });
    assert.equal(p.platform.name, name);
    assert.equal(p.mode, "edit", name);
    assert.equal(p.inRepository, input.files.length > 0);
  }
});

test("a Vite single-page app that ships an empty shell is flagged as JavaScript-dependent", () => {
  const spa = page('<div id="root"></div><script type="module" src="/assets/index.js"></script>');
  assert.equal(renderingOf(spa), "js-dependent");
  const p = detectProfile({ pkg: { dependencies: { react: "19" }, devDependencies: { vite: "6" } }, files: ["package.json", "index.html"], html: spa });
  assert.equal(p.platform.kind, "spa");
  assert.ok(p.notes.some((n) => /JavaScript runs/.test(n)));
  assert.equal(renderingOf(page(`<h1>x</h1><p>${prose}</p>`)), "html-complete");
});

test("with no repository files the profile advises and says why", () => {
  const p = detectProfile({ html: page(`<p>${prose}</p>`) });
  assert.equal(p.mode, "advise");
  assert.ok(p.notes.some((n) => /cannot change anything/.test(n)));
});

test("finds redirect, robots and sitemap files, hosting, analytics and structured data", () => {
  const html = page(`<p>${prose}</p>`, '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCDEF1234"></script><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"A"},{"@type":["WebSite"]}]}</script><link rel="canonical" href="https://a.test/">');
  const p = detectProfile({ files: ["public/.htaccess", "public/robots.txt", "public/sitemap.xml", "scripts/redirect-map.json"], html, headers: { Server: "LiteSpeed" }, sitemapXml: "<urlset/>", robotsTxt: "User-agent: *" });
  assert.deepEqual(p.locations.redirects.sort(), ["public/.htaccess", "scripts/redirect-map.json"]);
  assert.equal(p.locations.robots[0], "public/robots.txt");
  assert.match(p.hosting, /Apache \/ LiteSpeed/);
  assert.deepEqual(p.signals.structuredData.sort(), ["Organization", "WebSite"]);
  assert.ok(p.signals.analytics.includes("Google Analytics 4"));
  assert.equal(p.signals.canonical, true);
  assert.deepEqual(structuredDataTypes('<script type="application/ld+json">{bad</script>'), ["(invalid JSON-LD)"]);
});

test("the router puts blockers before content work and always includes the strategist and reporter", () => {
  const plan = routeAgents({
    profile: { mode: "edit", rendering: "html-complete", signals: { structuredData: ["Organization"] }, platform: { name: "Hugo" } },
    audit: { issues: [{ rule: "status-error", url: "https://a.test/x" }, { rule: "schema-required-missing", url: "https://a.test/y" }, { rule: "images-no-alt", url: "https://a.test/z" }] },
    priorities: { items: [{ type: "snippet", title: "Rewrite /a" }, { type: "structure", title: "Resolve q" }] },
  });
  const names = plan.steps.map((s) => s.agent);
  assert.equal(names[0], "seo-redirect-guardian");
  assert.ok(names.indexOf("seo-redirect-guardian") < names.indexOf("seo-snippet-optimizer"));
  assert.ok(names.indexOf("seo-schema-engineer") < names.indexOf("seo-cannibalization-resolver"));
  assert.ok(names.includes("seo-media-optimizer") && names.includes("seo-strategist") && names.at(-1) === "seo-reporter");
  assert.ok(!names.includes("seo-link-builder"), "no link building while blockers exist");
  assert.deepEqual(plan.steps.map((s) => s.order), plan.steps.map((_, i) => i + 1));
  assert.match(planMarkdown(plan, "A"), /## 1\. seo-redirect-guardian/);
});

test("without a profile the router starts with the onboarder, and advise mode is passed on in every instruction", () => {
  assert.equal(routeAgents({}).steps[0].agent, "seo-onboarder");
  const plan = routeAgents({ profile: { mode: "advise", rendering: "js-dependent", signals: { structuredData: [] }, platform: { name: "Wix" } }, audit: { issues: [{ rule: "status-error", url: "https://a.test/" }] } });
  const fixer = plan.steps.find((s) => s.agent === "seo-technical-fixer");
  assert.match(fixer.prompt, /advise mode/);
  assert.ok(plan.steps.some((s) => s.agent === "seo-entity-reputation"), "no organisation markup is flagged");
});

test("when nothing blocks, authority building is recommended; local, ecommerce and international agents appear only when they apply", () => {
  const clean = routeAgents({ profile: { mode: "edit", rendering: "html-complete", signals: { structuredData: ["Organization"] }, platform: { name: "Astro" } } });
  assert.ok(clean.steps.some((s) => s.agent === "seo-link-builder"));
  for (const a of ["seo-local-agent", "seo-ecommerce", "seo-international"]) assert.ok(!clean.steps.some((s) => s.agent === a), a);
  const shop = routeAgents({ profile: { mode: "edit", rendering: "html-complete", signals: { structuredData: ["Organization", "Product"], hreflang: true }, platform: { name: "Shopify" } }, site: { local: true } });
  for (const a of ["seo-local-agent", "seo-ecommerce", "seo-international"]) assert.ok(shop.steps.some((s) => s.agent === a), a);
});
