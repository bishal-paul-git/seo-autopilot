// Consent and measurement check: fetches the home page and the privacy/cookie page, reports tracking without consent.
// Read-only. Writes <state>/<site>/consent.json and consent.md.   npx seo-autopilot run consent
import { checkConsent, consentMarkdown } from "../analysis/consent.mjs";
import { writeJson, writeText } from "../core/util.mjs";

export const description = "Consent and measurement check: tracking without a consent tool, policy claims the site does not meet";

const PRIVACY_PATHS = ["/privacy", "/privacy-policy", "/cookies", "/cookie-policy", "/legal/privacy"];

async function get(url) {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "seo-autopilot-consent/1.0" }, signal: AbortSignal.timeout(15000) });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

/** The site's own JavaScript bundles (same origin, a few, size-capped): custom consent banners live there, not in the HTML. */
async function ownScripts(html, origin) {
  const urls = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => { try { return new URL(m[1], origin).href; } catch { return null; } })
    .filter((u) => u && u.startsWith(origin + "/")).slice(0, 12);
  const out = [];
  for (const u of urls) { const t = await get(u); if (t && t.length < 3_000_000) out.push(t); }
  return out;
}

export async function run({ site }) {
  const origin = new URL(site.url).origin;
  const html = (await get(site.url)) || "";
  if (!html) console.log(`consent: could not fetch ${site.url}`);
  let privacyText = "", privacyUrl = null;
  for (const p of PRIVACY_PATHS) {
    const t = await get(origin + p);
    if (t && t.length > 500) { privacyText += " " + t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ").replace(/\s+/g, " "); privacyUrl = privacyUrl || origin + p; }
  }
  const result = checkConsent({ html, privacyText, scripts: await ownScripts(html, origin) });
  writeJson(`${site.paths.state}/consent.json`, { generatedAt: new Date().toISOString(), home: site.url, privacyUrl, ...result });
  const md = consentMarkdown(result, site.name, { home: site.url, privacy: privacyUrl });
  writeText(`${site.paths.state}/consent.md`, md);
  console.log(md);
}
