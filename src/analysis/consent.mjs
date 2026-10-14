// Consent and measurement check. Pure: pass the delivered HTML, the privacy/cookie page text and any script sources in.
// Static HTML cannot show tags a tag manager or banner injects at runtime, so that limit is reported, never hidden.

const TRACKERS = [
  ["Google Analytics / gtag", /googletagmanager\.com\/gtag\/js\?id=(G-|UA-|AW-)|\bgtag\(\s*['"]config['"]\s*,\s*['"](G-|UA-|AW-)/i],
  ["Google Tag Manager", /googletagmanager\.com\/gtm\.js|googletagmanager\.com\/ns\.html|['"]GTM-[A-Z0-9]{4,}['"]/i],
  ["Google Analytics (analytics.js)", /google-analytics\.com\/(analytics|ga)\.js/i],
  ["Microsoft Clarity", /clarity\.ms\/tag\/|\bclarity\(\s*['"]set['"]|\(window,\s*document,\s*["']clarity["']/i],
  ["Meta Pixel", /connect\.facebook\.net\/[^"']*fbevents\.js|\bfbq\(\s*['"]init['"]/i],
  ["Hotjar", /static\.hotjar\.com|\bhj\(\s*['"]identify|_hjSettings/i],
  ["LinkedIn Insight", /snap\.licdn\.com\/li\.lms-analytics|_linkedin_partner_id/i],
  ["TikTok Pixel", /analytics\.tiktok\.com\/i18n\/pixel|\bttq\.load\(/i],
  ["Plausible / Fathom (cookieless)", /plausible\.io\/js|usefathom\.com|cdn\.usefathom/i],
];
// Cookieless analytics generally need no consent banner, so they never trigger the "tracking without consent" finding.
const COOKIELESS = new Set(["Plausible / Fathom (cookieless)"]);

const CMPS = [
  ["Cookiebot", /cookiebot\.com/i], ["OneTrust", /onetrust|optanon/i], ["CookieYes", /cookieyes\.com|cky-consent/i],
  ["Osano", /osano\.com|osano-cm/i], ["Termly", /termly\.io/i], ["iubenda", /iubenda\.com|_iub\.csConfiguration/i],
  ["Complianz", /complianz/i], ["Usercentrics", /usercentrics/i], ["Klaro", /klaro(\.js|-config)/i],
];

const CLAIMS = /\byour consent\b|\bwith consent\b|\bopt[- ]?in\b|\bwe (?:will )?ask (?:for )?your (?:consent|permission)\b/i;

const strip = (h) => String(h || "").replace(/<!--[\s\S]*?-->/g, "");

/** A site's own consent logic (a custom banner) in its JavaScript: wording around "consent" next to granted/denied, or a stored choice. */
const STORED_CHOICE = /(localStorage|sessionStorage|document\.cookie)[\s\S]{0,900}(granted|denied)|(granted|denied)[\s\S]{0,900}(localStorage|sessionStorage|document\.cookie)/;
/** Heuristic: the script talks about consent and stores a granted/denied choice. A third-party consent platform is found by name instead. */
const CUSTOM_CONSENT = { test: (s) => /consent/i.test(s) && STORED_CHOICE.test(s) };

export function checkConsent({ html = "", privacyText = "", scripts = [] } = {}) {
  const src = strip(html) + "\n" + scripts.join("\n");
  const trackers = TRACKERS.filter(([, re]) => re.test(src)).map(([n]) => n);
  const consentTools = CMPS.filter(([, re]) => re.test(src)).map(([n]) => n);
  if (scripts.some((s) => CUSTOM_CONSENT.test(s))) consentTools.push("custom consent logic in the site's scripts");
  const modeMatch = src.match(/gtag\(\s*['"]consent['"]\s*,\s*['"]default['"]\s*,\s*\{([\s\S]*?)\}\s*\)/i);
  const consentMode = Boolean(modeMatch);
  const pairs = modeMatch ? [...modeMatch[1].matchAll(/['"]?(analytics_storage|ad_storage|ad_user_data|ad_personalization)['"]?\s*:\s*['"](granted|denied)['"]/gi)] : [];
  const grants = pairs.filter((m) => m[2].toLowerCase() === "granted").map((m) => m[1]);
  const modeDenied = consentMode && grants.length === 0 && pairs.length > 0;
  const hasMechanism = consentTools.length > 0 || modeDenied;
  const claimMatch = String(privacyText || "").match(CLAIMS);
  const claimsConsent = Boolean(claimMatch);
  const consentTracking = trackers.filter((t) => !COOKIELESS.has(t));

  const findings = [];
  if (consentTracking.length && !hasMechanism) findings.push({ id: "tracking-without-consent-tool", severity: "high", title: "Tracking scripts load with no consent tool in the page", evidence: [`trackers found: ${consentTracking.join(", ")}`, "no known consent platform and no Consent Mode default of denied"], fix: "Add a consent banner (Cookiebot, CookieYes, Osano, Termly, iubenda or similar), or Google Consent Mode with analytics_storage set to denied until the visitor agrees, and load the trackers only after consent." });
  if (claimsConsent && !hasMechanism) findings.push({ id: "privacy-claims-consent-but-no-mechanism", severity: "high", title: "The privacy or cookie page says visitors consent, but the site has no way to give or refuse it", evidence: [`policy wording: "${claimMatch[0]}"`, "no consent tool, no denied Consent Mode default and no custom consent logic found in the delivered HTML or the site's scripts"], fix: "Either add a working consent mechanism, or change the policy to say what actually happens. A policy that promises consent the site never asks for is a compliance risk." });
  if (consentMode && grants.length) findings.push({ id: "consent-mode-default-not-denied", severity: "medium", title: "Consent Mode default grants storage before the visitor chooses", evidence: [`granted by default: ${grants.join(", ")}`], fix: "Set the default to 'denied' for analytics_storage, ad_storage, ad_user_data and ad_personalization, and update to 'granted' only when the visitor accepts." });
  if (!consentTracking.length) findings.push({ id: "trackers-injected-at-runtime-unknown", severity: "info", title: "No tracking found in the delivered HTML, which does not prove there is none", evidence: ["tags injected at runtime by JavaScript or a tag manager do not appear in static HTML"], fix: "If you know analytics is installed, check it in a browser's network tab before and after clicking accept." });

  return { trackers, consentTools, consentMode, consentModeGranted: grants, claimsConsent, findings };
}

export function consentMarkdown(r, siteName = "", pages = {}) {
  const sev = { high: "HIGH", medium: "MEDIUM", info: "INFO" };
  return `# ${siteName ? siteName + ": " : ""}consent and measurement

Checked: ${pages.home || "home page"}; privacy page: ${pages.privacy || "not found"}.
Trackers seen: ${r.trackers.join(", ") || "none"}. Consent tools: ${r.consentTools.join(", ") || "none"}. Consent Mode default: ${r.consentMode ? (r.consentModeGranted.length ? "grants " + r.consentModeGranted.join(", ") : "denied") : "not set"}.

${r.findings.length ? r.findings.map((f) => `## ${sev[f.severity]}: ${f.title}\n${f.evidence.map((e) => `- ${e}`).join("\n")}\n**Fix:** ${f.fix}`).join("\n\n") : "No consent problems found in the delivered HTML."}

## Real traffic versus measured traffic
Where visitors can refuse analytics (which is what a consent banner is for), your reports count only those who accept. Search Console counts clicks regardless, so the two numbers will not match, and the gap is normal. Report both; do not hide the gap or tune the banner to close it.

This check reads delivered HTML only. Tags added by JavaScript or a tag manager at runtime cannot be seen here.
`;
}
