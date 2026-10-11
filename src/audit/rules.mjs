// The audit rulebook. Every rule says what it found, WHY it matters and HOW to fix it, so a finding teaches as well as
// reports. Thresholds are practical guidelines, not search-engine limits: titles and descriptions are truncated by pixel
// width, not characters, and nothing here promises a ranking effect.

export const RULES = {
  "status-error": { severity: "high", title: "Sitemap URL does not return 200", why: "A URL in your sitemap that errors tells search engines your sitemap is unreliable and wastes crawl attention.", fix: "Fix the page or remove it from the sitemap." },
  "status-redirect": { severity: "medium", title: "Sitemap URL redirects", why: "Sitemaps should list the final, canonical URL. Redirecting entries add a hop and mix signals.", fix: "Put the destination URL in the sitemap, not the redirecting one." },
  "redirect-chain": { severity: "medium", title: "Redirect chain", why: "Each extra hop slows crawling and can dilute signals. Crawlers may stop after several hops.", fix: "Redirect straight to the final URL in one step." },
  "noindex-in-sitemap": { severity: "high", title: "Noindex page listed in the sitemap", why: "The sitemap says 'index this' while the page says 'do not index'. Search engines may ignore both.", fix: "Remove the page from the sitemap, or remove the noindex if it should rank." },
  "robots-blocked": { severity: "high", title: "Sitemap URL blocked by robots.txt", why: "A blocked URL cannot be crawled, so its content and noindex tag are never seen and it can still appear without a description.", fix: "Allow the URL in robots.txt, or drop it from the sitemap." },
  "canonical-missing": { severity: "medium", title: "No canonical tag", why: "Without a canonical, URL variants (tracking parameters, slashes, www) can split signals between duplicates.", fix: "Add a self-referencing <link rel=\"canonical\"> with the preferred absolute URL." },
  "canonical-other": { severity: "medium", title: "Canonical points to a different URL", why: "This page asks to be treated as a copy of another page and will normally not be indexed itself.", fix: "If this page should rank, point the canonical at itself. If it is a true duplicate, keep it and redirect or consolidate." },
  "canonical-broken": { severity: "high", title: "Canonical target is not a healthy page", why: "A canonical pointing at a redirect, error or noindex page sends contradictory signals.", fix: "Point the canonical at a live, indexable, 200 URL." },
  "title-missing": { severity: "high", title: "Missing title", why: "The title is the strongest on-page signal and the headline users see in results.", fix: "Write a unique title that leads with the page's main topic." },
  "title-long": { severity: "low", title: "Title likely truncated", why: "Long titles are cut off in results, so the end of your message is lost.", fix: "Keep the important words first and aim for roughly 60 characters or fewer." },
  "title-short": { severity: "low", title: "Very short title", why: "A very short title wastes space to match search intent and stand out.", fix: "Describe the page's topic and benefit in the title." },
  "title-duplicate": { severity: "medium", title: "Duplicate title", why: "Pages with identical titles compete with each other and look interchangeable in results.", fix: "Give every page a title that reflects its own unique topic." },
  "desc-missing": { severity: "medium", title: "Missing meta description", why: "Search engines often write their own snippet, usually worse than a deliberate one, which can lower click-through.", fix: "Write a unique 120 to 155 character summary that earns the click." },
  "desc-long": { severity: "low", title: "Description likely truncated", why: "Overlong descriptions are cut off.", fix: "Tighten to roughly 155 characters or fewer." },
  "desc-short": { severity: "low", title: "Very short description", why: "A thin description gives users little reason to click.", fix: "Expand to a useful sentence or two." },
  "desc-duplicate": { severity: "medium", title: "Duplicate meta description", why: "Repeated descriptions make different pages look the same in results.", fix: "Write a distinct description for each page." },
  "h1-missing": { severity: "medium", title: "No H1", why: "The H1 tells users and crawlers what the page is about at a glance.", fix: "Add one clear H1 that matches the page's main topic." },
  "h1-multiple": { severity: "low", title: "Several H1s", why: "Multiple H1s can blur the page's main topic (HTML allows them, clarity suffers).", fix: "Use one H1 and structure the rest with H2s." },
  "h1-duplicate": { severity: "low", title: "Same H1 on several pages", why: "Identical headings suggest duplicate or overlapping pages.", fix: "Differentiate the pages or merge them." },
  "thin-content": { severity: "low", title: "Very little visible text", why: "Pages with almost no text rarely satisfy a search intent on their own. (Hubs and tools can be legitimately short.)", fix: "If it should rank for a query, answer the query properly. If not, consider noindex or merging." },
  "jsonld-invalid": { severity: "high", title: "Broken structured data", why: "Invalid JSON-LD is ignored, so any rich-result eligibility is lost silently.", fix: "Fix the JSON syntax and validate with Google's Rich Results Test." },
  "jsonld-article-incomplete": { severity: "low", title: "Article markup missing recommended fields", why: "Complete Article markup helps search engines understand authorship and freshness.", fix: "Add headline, datePublished, author and image where true." },
  "images-no-alt": { severity: "low", title: "Images without alt text", why: "Alt text is how screen readers and image search understand images (decorative images may use an empty alt).", fix: "Describe meaningful images; use alt=\"\" for decoration." },
  "viewport-missing": { severity: "medium", title: "No mobile viewport tag", why: "Without it phones render the desktop layout, hurting mobile usability. Google indexes the mobile version first.", fix: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">." },
  "lang-missing": { severity: "low", title: "No html lang attribute", why: "Language declarations help accessibility tools and some search features.", fix: "Set <html lang=\"en\"> (or the right code)." },
  "mixed-content": { severity: "high", title: "HTTP resources on an HTTPS page", why: "Browsers block or warn on insecure resources, breaking the page and trust.", fix: "Load every resource over https." },
  "orphan": { severity: "medium", title: "No internal links point here", why: "Pages nobody links to are hard for crawlers to discover and look unimportant.", fix: "Link to it from a relevant hub and at least two related pages." },
  "deep": { severity: "low", title: "Far from the home page", why: "Pages many clicks from the home page tend to be crawled less and signal low importance.", fix: "Link to it from a hub nearer the top of the site." },
  "broken-link": { severity: "high", title: "Internal link to a broken page", why: "Users hit a dead end and crawlers waste budget.", fix: "Fix the link or restore the page." },
  "link-to-redirect": { severity: "low", title: "Internal link points to a redirect", why: "Linking directly to the final URL saves a hop and keeps signals clean.", fix: "Update the link to the destination URL." },
  "generic-anchor": { severity: "low", title: "Generic link text", why: "Anchors like 'click here' tell neither users nor search engines what the target is about.", fix: "Use descriptive anchor text." },
  "duplicate-content": { severity: "high", title: "Identical page text on several URLs", why: "Search engines pick one version and may choose the wrong one; the others waste crawl attention.", fix: "Consolidate with a redirect or canonical, or make the pages genuinely different." },
  "slow-ttfb": { severity: "low", title: "Slow first byte (measured from the audit server)", why: "A slow server response delays everything after it. One measurement from one place is only a hint.", fix: "Check caching, hosting and server-side work; confirm with real-user data." },
  "sitemap-not-in-robots": { severity: "low", title: "robots.txt does not list the sitemap", why: "Listing the sitemap in robots.txt helps every crawler find it.", fix: "Add a Sitemap: line to robots.txt." },
  "robots-blocks-all": { severity: "high", title: "robots.txt blocks everything", why: "A blanket Disallow stops all crawling of the site.", fix: "Remove 'Disallow: /' for the * user agent unless the site is meant to be private." },
};

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const sameUrl = (a, b) => a && b && a.replace(/\/$/, "") === b.replace(/\/$/, "");

/** Does this robots.txt (rules for "*") disallow the path? Longest matching rule wins, Allow beats Disallow on a tie. */
export function robotsDisallows(robotsTxt, path) {
  let applies = false; const rules = [];
  for (const raw of String(robotsTxt || "").split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") applies = v === "*";
    else if (applies && (k === "disallow" || k === "allow") && v) rules.push({ allow: k === "allow", path: v });
  }
  let best = null;
  for (const r of rules) {
    const p = r.path.replace(/\*$/, "");
    if (path.startsWith(p) && (!best || p.length > best.len || (p.length === best.len && r.allow))) best = { len: p.length, allow: r.allow };
  }
  return Boolean(best && !best.allow);
}

/**
 * Run every check. `pages` is an array of crawl records:
 *   { url, finalUrl, status, chain[], ttfb, xRobots, inSitemap, depth, inbound, html?: false, ...extractPage fields, textHash }
 * `ctx` = { robotsTxt, sitemapUrls[], brokenTargets: Map(url -> status), siteHost }
 */
export function runChecks(pages, ctx = {}) {
  const issues = [];
  const add = (rule, url, detail = "") => issues.push({ rule, severity: RULES[rule].severity, url, detail });
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const byFinal = new Map(pages.map((p) => [p.finalUrl || p.url, p]));
  // Content checks run on real pages only: a URL that redirects is judged by where it lands, not as a page of its own.
  const html = pages.filter((p) => p.status === 200 && p.isHtml && !(p.chain && p.chain.length));

  if (ctx.robotsTxt != null) {
    if (/^\s*Disallow:\s*\/\s*$/im.test(ctx.robotsTxt.split(/User-agent:/i).find((b) => /^\s*\*/.test(b)) || "")) add("robots-blocks-all", ctx.siteHost || "");
    if (!/^\s*Sitemap:/im.test(ctx.robotsTxt)) add("sitemap-not-in-robots", ctx.siteHost || "");
  }

  for (const p of pages) {
    if (p.inSitemap) {
      if (p.status >= 400 || p.status === 0) add("status-error", p.url, `HTTP ${p.status || "no response"}`);
      else if (p.chain && p.chain.length > 0 && p.status === 200 && !sameUrl(p.url, p.finalUrl)) add("status-redirect", p.url, `redirects to ${p.finalUrl}`);
      if (ctx.robotsTxt != null && robotsDisallows(ctx.robotsTxt, new URL(p.url).pathname)) add("robots-blocked", p.url);
    }
    if (p.chain && p.chain.length > 1) add("redirect-chain", p.url, `${p.chain.length} hops: ${[p.url, ...p.chain].slice(0, 5).join(" > ")}`);
  }

  const titles = new Map(), descs = new Map(), h1s = new Map(), hashes = new Map();
  for (const p of html) {
    const noindex = /noindex/.test(p.robots) || /noindex/i.test(p.xRobots || "");
    if (noindex && p.inSitemap) add("noindex-in-sitemap", p.url);
    if (!p.canonical) add("canonical-missing", p.url);
    else if (!sameUrl(p.canonical, p.finalUrl || p.url)) {
      add("canonical-other", p.url, `canonical: ${p.canonical}`);
      const t = byFinal.get(p.canonical) || byUrl.get(p.canonical);
      if (t && (t.status !== 200 || /noindex/.test(t.robots || "") || (t.chain || []).length > 0)) add("canonical-broken", p.url, `target ${p.canonical} -> HTTP ${t.status}`);
    }
    if (!p.title) add("title-missing", p.url);
    else {
      if (p.title.length > 60) add("title-long", p.url, `${p.title.length} characters`);
      if (p.title.length < 20) add("title-short", p.url, `${p.title.length} characters`);
      (titles.get(norm(p.title)) || titles.set(norm(p.title), []).get(norm(p.title))).push(p.url);
    }
    if (!p.description) add("desc-missing", p.url);
    else {
      if (p.description.length > 160) add("desc-long", p.url, `${p.description.length} characters`);
      if (p.description.length < 70) add("desc-short", p.url, `${p.description.length} characters`);
      (descs.get(norm(p.description)) || descs.set(norm(p.description), []).get(norm(p.description))).push(p.url);
    }
    if (!p.h1s.length) add("h1-missing", p.url);
    else {
      if (p.h1s.length > 1) add("h1-multiple", p.url, `${p.h1s.length} H1s`);
      (h1s.get(norm(p.h1s[0])) || h1s.set(norm(p.h1s[0]), []).get(norm(p.h1s[0]))).push(p.url);
    }
    if (p.words < 250 && p.inSitemap && !noindex) add("thin-content", p.url, `${p.words} words`);
    if (p.jsonld.invalid) add("jsonld-invalid", p.url, `${p.jsonld.invalid} unparsable block(s)`);
    if (p.jsonld.articleFields) { const miss = Object.entries(p.jsonld.articleFields).filter(([, v]) => !v).map(([k]) => k); if (miss.length) add("jsonld-article-incomplete", p.url, `missing ${miss.join(", ")}`); }
    if (p.imagesNoAlt) add("images-no-alt", p.url, `${p.imagesNoAlt} of ${p.images}`);
    if (!p.viewport) add("viewport-missing", p.url);
    if (!p.lang) add("lang-missing", p.url);
    if (p.mixed.length) add("mixed-content", p.url, p.mixed.join(", "));
    if (p.inSitemap && p.inbound === 0) add("orphan", p.url);
    if (p.depth != null && p.depth > 3) add("deep", p.url, `${p.depth} clicks from home`);
    if (p.ttfb > 1500) add("slow-ttfb", p.url, `${Math.round(p.ttfb)} ms`);
    const generic = p.links.filter((l) => /^(click here|here|read more|more|learn more|this)$/i.test(l.text) && l.url.startsWith(`https://${ctx.siteHost || new URL(p.url).host}`)).length;
    if (generic >= 3) add("generic-anchor", p.url, `${generic} links`);
    for (const l of p.links) {
      const target = byUrl.get(l.url) || byFinal.get(l.url);
      const broken = ctx.brokenTargets?.get(l.url) || (target && (target.status >= 400 || target.status === 0) ? target.status || "no response" : null);
      if (broken) add("broken-link", p.url, `${l.url} -> HTTP ${broken}`);
      else if (target && target.chain && target.chain.length > 0 && sameUrl(l.url, target.url)) add("link-to-redirect", p.url, `${l.url} redirects`);
    }
    if (p.textHash && p.words >= 80) (hashes.get(p.textHash) || hashes.set(p.textHash, []).get(p.textHash)).push(p.url);
  }
  for (const [rule, map] of [["title-duplicate", titles], ["desc-duplicate", descs], ["h1-duplicate", h1s], ["duplicate-content", hashes]]) {
    for (const urls of map.values()) if (urls.length > 1) for (const u of urls) add(rule, u, `shared with ${urls.filter((x) => x !== u).slice(0, 3).join(", ")}${urls.length > 4 ? " and more" : ""}`);
  }
  return issues;
}

export const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

export function summarize(issues, pagesCrawled) {
  const bySeverity = { high: 0, medium: 0, low: 0 }, byRule = {};
  const affected = new Set();
  for (const i of issues) { bySeverity[i.severity]++; byRule[i.rule] = (byRule[i.rule] || 0) + 1; if (i.severity !== "low") affected.add(i.url); }
  return { pagesCrawled, bySeverity, byRule, pagesWithoutHighOrMedium: Math.max(0, pagesCrawled - affected.size) };
}
