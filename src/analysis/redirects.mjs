// Redirect map: check it, turn it into server rules, and judge a smoke test of the live site. Pure: no network, no writes.
// Ported from Erudience (scripts/check-redirects.mjs, generate-htaccess.mjs, smoke-redirects.mjs) and made host-neutral.
//
// The map is data the site owner keeps, by default <dataDir>/redirects.json:
//   { "redirects": { "/old-page": "/new-page", "/old-guide": "https://other-site.example/guide" },
//     "gone": ["/retired-page"], "goneSections": ["/old-section"] }
// "redirects" become permanent (301) redirects. "gone" pages had no close replacement and answer 410 Gone, which tells
// search engines the removal is deliberate; sending them to the home page instead is treated as a soft 404.
// "goneSections" retire a whole path prefix (the section page and everything under it), after the exact redirects, so a
// mapped page inside a retired section still redirects.

/** "/a/", "https://site/a" (same host) and "a" all become "/a". Other hosts stay full URLs. Returns null when unusable. */
export function normPath(v, siteUrl) {
  const s = String(v ?? "").trim();
  if (!s || /\s/.test(s)) return null;
  let host = null;
  try { host = new URL(siteUrl).host; } catch { /* no site URL: paths only */ }
  if (/^https?:\/\//i.test(s)) {
    let u;
    try { u = new URL(s); } catch { return null; }
    if (host && u.host !== host) return u.toString();
    return trim(u.pathname + u.search);
  }
  return trim(s.startsWith("/") ? s : "/" + s);
}
const trim = (p) => (p.length > 1 ? p.replace(/\/+$/, "") || "/" : p);
const external = (p) => /^https?:\/\//i.test(p);

/** Read the map (also Erudience's { map } shape). Entries that are not usable paths are reported, not dropped silently. */
export function parseMap(raw, siteUrl) {
  const redirects = new Map(), gone = [], goneSections = [], bad = [];
  const src = raw?.redirects ?? raw?.map ?? {};
  for (const [o, t] of Object.entries(src)) {
    if (o.startsWith("_")) continue;
    const from = normPath(o, siteUrl), to = normPath(t, siteUrl);
    if (!from || !to || external(from)) { bad.push(`${o} -> ${t}`); continue; }
    redirects.set(from, to);
  }
  for (const g of raw?.gone ?? []) { const p = normPath(g, siteUrl); if (!p || external(p)) bad.push(String(g)); else gone.push(p); }
  for (const g of raw?.goneSections ?? []) { const p = normPath(g, siteUrl); if (!p || external(p) || p === "/") bad.push(String(g)); else goneSections.push(p); }
  return { redirects, gone: [...new Set(gone)], goneSections: [...new Set(goneSections)], bad };
}

/**
 * Problems that would break the site or waste a redirect. `live` is the set of paths that are real pages now; `scheduled`
 * the set of paths that will be (queued or dated pages). Errors stop a release; warnings wait.
 */
export const inSection = (path, section) => path === section || path.startsWith(section + "/");

export function checkRedirects({ redirects, gone, goneSections = [], bad = [] }, live = new Set(), scheduled = new Set()) {
  const errors = bad.map((b) => `unusable entry: ${b}`), warnings = [];
  for (const [from, to] of redirects) {
    if (from === to) { errors.push(`${from} redirects to itself`); continue; }
    if (live.has(from)) errors.push(`${from} is a live page, so a redirect would hide it`);
    if (redirects.has(to)) {
      const seen = new Set([from]); let t = to;
      while (redirects.has(t) && !seen.has(t)) { seen.add(t); t = redirects.get(t); }
      errors.push(seen.has(t) ? `${from} -> ${to}: redirect loop` : `${from} -> ${to}: chain (the target redirects again, finally to ${t}); point it straight at ${t}`);
    } else if (gone.includes(to)) errors.push(`${from} -> ${to}: the target is marked gone`);
    else if (goneSections.some((g) => inSection(to, g))) errors.push(`${from} -> ${to}: the target is in a retired section`);
    else if (external(to)) warnings.push(`${from} -> ${to}: another site, not checked here (the smoke test checks the redirect, not the other site)`);
    else if (!live.has(to)) {
      if (scheduled.has(to)) warnings.push(`${from} -> ${to}: the target is scheduled but not live yet`);
      else errors.push(`${from} -> ${to}: the target is not a page on this site`);
    }
  }
  for (const g of gone) {
    if (redirects.has(g)) errors.push(`${g} is both redirected and marked gone`);
    if (live.has(g)) errors.push(`${g} is marked gone but is a live page`);
  }
  for (const g of goneSections) for (const p of live) if (inSection(p, g)) errors.push(`${p} is a live page inside the retired section ${g}`);
  return { errors, warnings, redirects: redirects.size, gone: gone.length, goneSections: goneSections.length };
}

const rx = (p) => p.replace(/^\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const BEGIN = "# BEGIN seo-autopilot redirects", END = "# END seo-autopilot redirects";

/**
 * Server rules for one host type. Apache and nginx answer 410 for gone pages. Netlify and Vercel are only given the
 * redirects; gone pages are left to the platform (delete the page so it answers 404, or set a 410 where the platform
 * supports one), because a redirect file is not a reliable place for a 410. Netlify lists them as comments; for Vercel the
 * caller prints them (vercel.json rejects keys it does not know).
 * With `live` (the set of live paths), a redirect to a page that is not live yet is held back, so visitors are not sent to
 * a 404; it is written by the first run after the target goes live. Use waiting() to list them.
 */
export function generate({ redirects, gone, goneSections = [] }, format, { live = null } = {}) {
  const list = [...redirects].filter(([f, t]) => f !== t && !redirects.has(t) && (!live || external(t) || live.has(t)));
  const goneOnly = gone.filter((g) => !redirects.has(g) && !goneSections.some((sec) => inSection(g, sec)));
  if (format === "apache") {
    return [BEGIN, "# Generated from the redirect map; edit the map, not these lines. Needs mod_rewrite (RewriteEngine On).",
      ...list.map(([f, t]) => `RewriteRule ^${rx(f)}/?$ ${t} [R=301,L]`),
      ...chunk(goneOnly, 25).map((c) => `RewriteRule ^(${c.map(rx).join("|")})/?$ - [G,L]`),
      ...(goneSections.length ? [`RewriteRule ^(${goneSections.map(rx).join("|")})(/.*)?$ - [G,L]`] : []), END].join("\n");
  }
  if (format === "nginx") {
    return [BEGIN, "# Generated from the redirect map. Include inside the server { } block.",
      ...list.map(([f, t]) => `location ~ ^/${rx(f)}/?$ { return 301 ${t}; }`),
      ...goneOnly.map((g) => `location ~ ^/${rx(g)}/?$ { return 410; }`),
      ...(goneSections.length ? [`location ~ ^/(${goneSections.map(rx).join("|")})(/.*)?$ { return 410; }`] : []), END].join("\n");
  }
  if (format === "netlify") {
    return [BEGIN, ...list.map(([f, t]) => `${f}  ${t}  301`), ...goneOnly.map((g) => `# gone (handle on the platform): ${g}`), ...goneSections.map((g) => `# gone section (handle on the platform): ${g}/*`), END].join("\n");
  }
  // Only the "redirects" array: merge it into vercel.json by hand (the file holds other settings, and unknown keys fail).
  if (format === "vercel") return JSON.stringify({ redirects: list.map(([f, t]) => ({ source: f, destination: t, permanent: true })) }, null, 2);
  throw new Error(`unknown format "${format}": use apache, nginx, netlify or vercel`);
}
/** Redirects generate() holds back because the target is not live yet. */
export const waiting = ({ redirects }, live) => [...redirects].filter(([f, t]) => f !== t && !redirects.has(t) && !external(t) && !live.has(t));

const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

/** Put a generated block into existing file text between the markers, or append it. Keeps the file's line endings. */
export function replaceBlock(text, block) {
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const b = block.replace(/\r?\n/g, eol);
  const i = text.indexOf(BEGIN), j = text.indexOf(END);
  if (i >= 0 && j > i) return text.slice(0, i) + b + text.slice(j + END.length);
  return text + (text && !text.endsWith(eol) ? eol : "") + b + eol;
}

/**
 * What the live site should answer: every redirect (301 to its exact target), every gone page (410), a made-up URL inside
 * each retired section (410) and one made-up URL elsewhere (404).
 */
export function smokePlan({ redirects, gone, goneSections = [] }, { max = 200, probe = "/seo-autopilot-check-not-a-page" } = {}) {
  return [
    ...[...redirects].slice(0, max).map(([path, to]) => ({ path, expect: "redirect", to })),
    ...gone.slice(0, max).map((path) => ({ path, expect: "gone" })),
    ...goneSections.map((g) => ({ path: g + probe, expect: "gone" })),
    { path: probe, expect: "missing" },
  ];
}

/**
 * Judge one answer. `res` = { status, location } where location is the Location header made absolute. A 308 counts as
 * permanent; 302 and 307 are temporary and fail. A gone page answering 404 is a warning (gone, but not said so).
 * `siteUrls` may list several bases (the tested origin and the production URL): a staging host often answers with the
 * production domain in Location, and that is the same path.
 */
export function judge(check, res, siteUrls) {
  const bases = [].concat(siteUrls);
  const where = res.location ? (bases.map((b) => normPath(res.location, b)).find((p) => p && !external(p)) ?? normPath(res.location, bases[0])) : null;
  if (check.expect === "redirect") {
    if (res.status !== 301 && res.status !== 308) return { ok: false, detail: `expected 301 to ${check.to}, got ${res.status}${where ? ` to ${where}` : ""}` };
    if (where !== check.to) return { ok: false, detail: `redirects to ${where}, expected ${check.to}` };
    return { ok: true };
  }
  if (check.expect === "gone") {
    if (res.status === 410) return { ok: true };
    if (res.status === 404) return { ok: true, warn: "answers 404, not 410 (fine, but 410 says the removal is deliberate)" };
    return { ok: false, detail: `expected 410, got ${res.status}${where ? ` to ${where}` : ""}` };
  }
  if (res.status === 404 || res.status === 410) return { ok: true };
  return { ok: false, detail: res.status === 200 ? "a URL that does not exist answers 200 (soft 404): search engines may index error pages" : `a URL that does not exist answers ${res.status}${where ? ` to ${where}` : ""}` };
}
