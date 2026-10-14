// Works out what kind of website this is, from the repository's files and the live site's HTML, so every agent can adapt
// instead of assuming one stack. Pure functions: pass in what was found, get a profile back. Nothing here fetches or writes.

const has = (list, re) => list.some((f) => re.test(f));
const dep = (deps, ...names) => names.some((n) => deps && Object.prototype.hasOwnProperty.call(deps, n));

/** kind: how the site is produced. editable: whether an agent working in this repository can change the real pages. */
const PLATFORMS = [
  { name: "WordPress", kind: "cms", editable: false, test: ({ html, files }) => /wp-content|wp-includes/i.test(html) || /<meta name="generator" content="WordPress/i.test(html) || has(files, /(^|\/)wp-config\.php$|(^|\/)wp-content\//), note: "Content lives in the WordPress admin. Agents advise and draft; changes are made in the editor or an SEO plugin, or in a theme repository if you keep one." },
  { name: "Shopify", kind: "saas", editable: true, test: ({ html, files }) => /cdn\.shopify\.com|Shopify\.theme/i.test(html) || has(files, /(^|\/)config\/settings_schema\.json$|(^|\/)templates\/.*\.liquid$/), note: "Products and collections are edited in the Shopify admin; theme files (Liquid) can be changed in a theme repository." },
  { name: "Wix", kind: "saas", editable: false, test: ({ html, headers }) => /wixstatic\.com|wix\.com\/|_wixCIDX/i.test(html) || "x-wix-request-id" in headers, note: "Hosted builder: there are no files to edit. Agents advise; changes are made in the Wix editor and its SEO settings." },
  { name: "Squarespace", kind: "saas", editable: false, test: ({ html }) => /static1\.squarespace\.com|Squarespace/i.test(html), note: "Hosted builder: agents advise; changes are made in the Squarespace editor." },
  { name: "Webflow", kind: "saas", editable: false, test: ({ html }) => /data-wf-site|assets\.website-files\.com|webflow\.com/i.test(html), note: "Hosted builder: agents advise; changes are made in the Webflow designer or CMS." },
  { name: "Framer", kind: "saas", editable: false, test: ({ html }) => /framerusercontent\.com|framer\.com\/m\//i.test(html), note: "Hosted builder: agents advise; changes are made in Framer." },
  { name: "Ghost", kind: "cms", editable: false, test: ({ html }) => /<meta name="generator" content="Ghost/i.test(html), note: "Content is edited in the Ghost admin." },
  { name: "Drupal", kind: "cms", editable: false, test: ({ html }) => /<meta name="Generator" content="Drupal/i.test(html) || /\/sites\/default\/files\//.test(html), note: "Content is edited in the Drupal admin." },
  { name: "Magento / Adobe Commerce", kind: "cms", editable: false, test: ({ html }) => /Magento|mage\/cookies|\/static\/version\d+\//i.test(html), note: "Catalogue content is edited in the admin." },
  { name: "Next.js", kind: "framework", editable: true, test: ({ html, deps, files }) => dep(deps, "next") || /\/_next\/static\//.test(html) || has(files, /(^|\/)next\.config\.(js|mjs|ts)$/) },
  { name: "Nuxt", kind: "framework", editable: true, test: ({ html, deps, files }) => dep(deps, "nuxt") || /\/_nuxt\//.test(html) || has(files, /(^|\/)nuxt\.config\.(js|ts)$/) },
  { name: "Astro", kind: "ssg", editable: true, test: ({ html, deps, files }) => dep(deps, "astro") || /<meta name="generator" content="Astro/i.test(html) || has(files, /(^|\/)astro\.config\.(mjs|js|ts)$/) },
  { name: "Gatsby", kind: "ssg", editable: true, test: ({ html, deps }) => dep(deps, "gatsby") || /id="___gatsby"/.test(html) },
  { name: "SvelteKit", kind: "framework", editable: true, test: ({ deps, files }) => dep(deps, "@sveltejs/kit") || has(files, /(^|\/)svelte\.config\.js$/) },
  { name: "Remix / React Router", kind: "framework", editable: true, test: ({ deps }) => dep(deps, "@remix-run/react", "@react-router/dev") },
  { name: "TanStack Start", kind: "framework", editable: true, test: ({ deps }) => dep(deps, "@tanstack/react-start", "@tanstack/start") },
  { name: "Angular", kind: "framework", editable: true, test: ({ deps, files }) => dep(deps, "@angular/core") || has(files, /(^|\/)angular\.json$/) },
  { name: "Hugo", kind: "ssg", editable: true, test: ({ html, files }) => /<meta name="generator" content="Hugo/i.test(html) || has(files, /^(hugo\.(toml|yaml|json)|config\.toml)$/) && has(files, /^(content|layouts|themes)\//) && !files.includes("package.json") },
  { name: "Jekyll", kind: "ssg", editable: true, test: ({ html, files }) => /<meta name="generator" content="Jekyll/i.test(html) || has(files, /^_config\.yml$/) && has(files, /^(_posts|_layouts)\//) },
  { name: "Eleventy", kind: "ssg", editable: true, test: ({ deps, files }) => dep(deps, "@11ty/eleventy") || has(files, /(^|\/)\.eleventy\.js$|(^|\/)eleventy\.config\./) },
  { name: "Docusaurus", kind: "ssg", editable: true, test: ({ deps, html }) => dep(deps, "@docusaurus/core") || /<meta name="generator" content="Docusaurus/i.test(html) },
  { name: "VitePress", kind: "ssg", editable: true, test: ({ deps, html }) => dep(deps, "vitepress") || /<meta name="generator" content="VitePress/i.test(html) },
  { name: "Vite + React (single-page app)", kind: "spa", editable: true, test: ({ deps }) => dep(deps, "vite") && dep(deps, "react") },
  { name: "Static HTML", kind: "static", editable: true, test: ({ files, deps }) => !deps && has(files, /(^|\/)index\.html$/) },
];

const REDIRECT_FILES = /(^|\/)(_redirects|netlify\.toml|vercel\.json|\.htaccess|nginx\.conf|firebase\.json|staticwebapp\.config\.json|_headers|wrangler\.toml|redirects\.(json|mjs|js)|redirect-map\.json)$/;
const ROBOTS_FILES = /(^|\/)(robots\.txt|robots\.(ts|js))$/;
const SITEMAP_FILES = /(^|\/)(sitemap(-index)?\.xml|sitemap\.(ts|js|mjs)|sitemap-.*\.xml)$/;
const CONTENT_DIRS = /^(content|src\/content|posts|_posts|docs|blog|src\/pages|pages|src\/data|app|data)\//;

export function visibleText(html) {
  return String(html || "").replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

/** How much of the page a crawler gets without running JavaScript. */
export function renderingOf(html) {
  if (!html) return "unknown";
  const words = visibleText((String(html).match(/<body[\s\S]*<\/body>/i) || [html])[0]).split(" ").filter(Boolean).length;
  if (words >= 120) return "html-complete";
  if (/<div id="(root|app|__next|___gatsby)"[^>]*>\s*<\/div>/i.test(html)) return "js-dependent";
  if (words < 40) return /<script[^>]+src=/i.test(html) ? "js-dependent" : "html-complete"; // a tiny page with no scripts is just a tiny page
  return "partial";
}

export function structuredDataTypes(html) {
  const out = new Set();
  for (const m of String(html || "").matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { for (const t of [].concat(n["@type"] || [])) out.add(String(t)); Object.values(n).forEach(walk); } };
      walk(JSON.parse(m[1]));
    } catch { out.add("(invalid JSON-LD)"); }
  }
  return [...out];
}

/** Tags and vendors that tell us how the site measures and handles consent. */
export function analyticsOf(html) {
  const h = String(html || "");
  const out = [];
  if (/googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/.test(h)) out.push("Google Tag Manager");
  if (/gtag\/js\?id=G-|['"]G-[A-Z0-9]{6,}['"]/.test(h)) out.push("Google Analytics 4");
  if (/plausible\.io/.test(h)) out.push("Plausible");
  if (/cdn\.matomo|matomo\.js|piwik/i.test(h)) out.push("Matomo");
  if (/connect\.facebook\.net|fbq\(/.test(h)) out.push("Meta Pixel");
  if (/cookiebot|onetrust|cookieyes|osano|termly|iubenda/i.test(h)) out.push("consent banner");
  return out;
}

export function detectProfile({ files = [], pkg = null, html = "", headers = {}, robotsTxt = "", sitemapXml = "", hasLlms = false, url = "" } = {}) {
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : null;
  const lowerHeaders = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const ctx = { html, files, deps, headers: lowerHeaders };
  const matches = PLATFORMS.filter((p) => { try { return p.test(ctx); } catch { return false; } });
  let platform = matches[0] || { name: "Unknown", kind: "unknown", editable: files.length > 0 };
  const rendering = renderingOf(html);
  if (platform.kind === "spa" && rendering === "html-complete") platform = { ...platform, name: "Vite + React (prerendered)", kind: "ssg" };
  const inRepo = files.length > 0;

  const locations = {
    content: [...new Set(files.filter((f) => CONTENT_DIRS.test(f)).map((f) => f.split("/").slice(0, f.startsWith("src/") ? 2 : 1).join("/")))].slice(0, 6),
    redirects: files.filter((f) => REDIRECT_FILES.test(f)).slice(0, 8),
    robots: files.filter((f) => ROBOTS_FILES.test(f)).slice(0, 3),
    sitemap: files.filter((f) => SITEMAP_FILES.test(f)).slice(0, 3),
  };
  const server = lowerHeaders.server || "";
  const hosting = /vercel/i.test(lowerHeaders["x-vercel-id"] || server) || lowerHeaders["x-vercel-id"] ? "Vercel" : lowerHeaders["x-nf-request-id"] || /netlify/i.test(server) ? "Netlify" : /cloudflare/i.test(server) || lowerHeaders["cf-ray"] ? "Cloudflare" : /hcdn|hostinger/i.test(server) ? "Hostinger (LiteSpeed; .htaccess redirects)" : /litespeed|apache/i.test(server) ? "Apache / LiteSpeed (.htaccess redirects)" : /nginx/i.test(server) ? "nginx" : /github\.com/i.test(server) || lowerHeaders["x-github-request-id"] ? "GitHub Pages" : server || "unknown";

  const notes = [];
  if (platform.note) notes.push(platform.note);
  if (rendering === "js-dependent") notes.push("The page body is mostly empty until JavaScript runs. Search engines can render it, but slower and less reliably; AI crawlers and link previews often cannot. Prerendering or server rendering is the single biggest technical fix.");
  if (rendering === "partial") notes.push("Part of the content needs JavaScript. Check that the headings, main text and links are in the delivered HTML.");
  if (!inRepo) notes.push("No site files are available here, so agents can analyse and advise but cannot change anything. Run seo-autopilot from the site's own repository to let them edit.");
  if (!locations.redirects.length && inRepo) notes.push("No redirect configuration was found. Redirects may be set at the host, in the CMS, or not exist yet.");
  if (!sitemapXml && !locations.sitemap.length) notes.push("No sitemap was found.");
  if (!hasLlms) notes.push("No llms.txt was found (optional; a convenience file for AI tools, not a ranking factor).");

  const canEdit = inRepo && platform.editable !== false;
  return {
    detectedAt: new Date().toISOString(),
    url: url || null,
    platform: { name: platform.name, kind: platform.kind, alsoMatched: matches.slice(1).map((m) => m.name) },
    rendering,
    hosting,
    inRepository: inRepo,
    agentsMayEditFiles: canEdit,
    mode: canEdit ? "edit" : "advise",
    locations,
    signals: { structuredData: structuredDataTypes(html), analytics: analyticsOf(html), hreflang: /<link[^>]+hreflang=/i.test(html), canonical: /<link[^>]+rel=["']canonical["']/i.test(html), robotsTxt: Boolean(robotsTxt), sitemap: Boolean(sitemapXml) || locations.sitemap.length > 0, llmsTxt: Boolean(hasLlms), noindexOnHome: /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html) || /noindex/i.test(lowerHeaders["x-robots-tag"] || "") },
    notes,
  };
}

export function profileMarkdown(p, siteName = "") {
  return `# ${siteName ? siteName + " " : ""}site profile

- **Platform:** ${p.platform.name} (${p.platform.kind})${p.platform.alsoMatched.length ? `; also matched ${p.platform.alsoMatched.join(", ")}` : ""}
- **Rendering:** ${p.rendering}
- **Hosting:** ${p.hosting}
- **Agents work in:** ${p.mode === "edit" ? "edit mode (they may change files in this repository)" : "advise mode (they analyse and recommend; a person makes the changes)"}
- **Content:** ${p.locations.content.join(", ") || "not found in the repository"}
- **Redirect rules:** ${p.locations.redirects.join(", ") || "none found"}
- **Structured data on the home page:** ${p.signals.structuredData.join(", ") || "none"}
- **Analytics and consent:** ${p.signals.analytics.join(", ") || "none detected"}

${p.notes.map((n) => `- ${n}`).join("\n")}
`;
}
