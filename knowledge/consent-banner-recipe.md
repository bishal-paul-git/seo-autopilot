# Recipe: a consent banner that really gates analytics

Use this when the `consent` job reports `tracking-without-consent-tool` or `privacy-claims-consent-but-no-mechanism`, or when you add analytics to a site. It is the pattern Erudience runs in production, written so it works on any stack. The `consent` job recognises it (consent wording next to a stored `granted` or `denied` choice), so after you ship it the finding clears.

This is engineering guidance, not legal advice. Whether analytics needs consent depends on where the business and its visitors are. UK and EU rules (PECR, the ePrivacy rules) have generally required it for analytics cookies, and the UK rules have been changing. Have a qualified person confirm what your site needs and what your privacy page should say. Asking first is the safe default.

## The logic (any framework)
1. **Load nothing that measures visitors until they accept.** Treat analytics, session recording, ad pixels and any "custom head code" pasted into a CMS as measurement code.
2. **Ask once, with two equal choices.** "Accept" and "Reject" have the same size, weight and position. Do not pre-select one, and do not hide "Reject" behind a second screen.
3. **Store the choice in the browser** (`localStorage`), under a versioned key so you can ask again if what you collect changes. If storage is blocked, treat it as no choice and load nothing.
4. **Let people change their mind.** Put a "Cookie settings" link in the footer that clears the choice and shows the banner again. Scripts that already loaded cannot be unloaded, so withdrawing consent reloads the page. Decide the reload from whether the tag is loaded, not from the stored choice: "Cookie settings" has already cleared the choice, and a check of "was it granted before?" then misses the withdrawal and analytics keeps running.
5. **Do not delay the page.** Show the banner after the page has rendered and position it fixed (it should not push content down). Keep it out of prerendered HTML if your build prerenders.
6. **Say what you use.** The banner names the tools ("Google Analytics") and links to the privacy page. The privacy page describes exactly this behaviour, and nothing the site does not do.

Google Consent Mode is a different approach: the tag loads at once with storage set to `denied` and sends cookieless pings until consent. If you use it, the default must be `denied` (the `consent` job flags a `granted` default). Loading nothing until consent, as below, is the simpler and stricter choice.

## Plain JavaScript (any site, including static HTML)
Save as `/consent.js`, set your measurement ID, and include it on every page with `<script src="/consent.js" defer></script>`. Remove any other Google Analytics snippet from the page, or it will load before the visitor chooses. Add a footer link: `<a href="#" onclick="openCookieSettings(); return false;">Cookie settings</a>`.

```js
// Load analytics only after the visitor accepts. The choice is stored in this browser; "Cookie settings" asks again.
(function () {
  var KEY = "site-consent-v1";
  var GA_ID = "G-XXXXXXXXXX"; // your GA4 measurement ID
  function getChoice() {
    try { var v = window.localStorage.getItem(KEY); return v === "granted" || v === "denied" ? v : null; }
    catch (e) { return null; } // storage blocked: no choice, nothing loads
  }
  function loadAnalytics() {
    if (window.__analyticsLoaded) return;
    window.__analyticsLoaded = true;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID);
  }
  function choose(value) {
    try { window.localStorage.setItem(KEY, value); } catch (e) { /* ignore */ }
    hideBanner();
    if (value === "granted") loadAnalytics();
    // Loaded scripts cannot be unloaded. Check what is loaded, not the stored choice: "Cookie settings" clears the choice
    // first, so "was it granted before?" would miss a withdrawal and leave analytics running.
    if (value === "denied" && window.__analyticsLoaded) window.location.reload();
  }
  var banner = null;
  function hideBanner() { if (banner) { banner.remove(); banner = null; } }
  function showBanner() {
    if (banner) return;
    banner = document.createElement("div");
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Analytics cookies");
    banner.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;padding:16px;background:#fff;color:#111;border:1px solid #ccc;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.15);z-index:9999;font:14px/1.5 system-ui,sans-serif";
    banner.innerHTML = '<p style="margin:0 0 12px">We use Google Analytics to see how the site is used. It sets cookies only if you accept. <a href="/privacy">Privacy policy</a></p>' +
      '<div style="display:flex;gap:12px"><button type="button" data-choice="denied" style="flex:1;padding:10px;border:2px solid #111;background:#fff;color:#111;border-radius:8px;font-weight:700">Reject</button>' +
      '<button type="button" data-choice="granted" style="flex:1;padding:10px;border:2px solid #111;background:#111;color:#fff;border-radius:8px;font-weight:700">Accept</button></div>';
    banner.addEventListener("click", function (e) { var c = e.target.getAttribute && e.target.getAttribute("data-choice"); if (c) choose(c); });
    document.body.appendChild(banner);
  }
  window.openCookieSettings = function () {
    try { window.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    showBanner();
  };
  var choice = getChoice();
  if (choice === "granted") loadAnalytics();
  else if (choice === null) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showBanner);
    else showBanner();
  }
})();
```

## React (Vite, Next.js client components, Remix)
The consent state lives in one small module; the banner and the script loader both read it. This is the shape of Erudience's `src/lib/consent.ts`, `ConsentBanner.tsx` and its script loader.

```tsx
// consent.ts
import { useEffect, useState } from "react";
export type Consent = "granted" | "denied" | null;
const KEY = "site-consent-v1", EVENT = "site-consent-change";

export function getConsent(): Consent {
  try { const v = window.localStorage.getItem(KEY); return v === "granted" || v === "denied" ? v : null; } catch { return null; }
}
export function setConsent(value: "granted" | "denied") {
  try { window.localStorage.setItem(KEY, value); } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVENT));
  // Reload when the tag is on the page: reopenConsent() clears the stored choice, so checking it would miss a withdrawal.
  if (value === "denied" && document.getElementById("ga-script")) window.location.reload();
}
export function reopenConsent() {
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVENT));
}
export function useConsent(): Consent {
  const [value, setValue] = useState<Consent>(null);
  useEffect(() => {
    const update = () => setValue(getConsent());
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener(EVENT, update); window.removeEventListener("storage", update); };
  }, []);
  return value;
}
```

```tsx
// ConsentBanner.tsx: render once near the root of the app.
import { useEffect, useState } from "react";
import { getConsent, setConsent, useConsent } from "./consent";

export function ConsentBanner() {
  const consent = useConsent();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []); // client only: never in server or prerendered HTML
  if (!mounted || consent !== null || getConsent() !== null) return null;
  return (
    <div role="dialog" aria-label="Analytics cookies" className="consent-banner">
      <p>We use Google Analytics to see how the site is used. It sets cookies only if you accept. <a href="/privacy">Privacy policy</a></p>
      <div className="consent-actions">
        <button type="button" onClick={() => setConsent("denied")}>Reject</button>
        <button type="button" onClick={() => setConsent("granted")}>Accept</button>
      </div>
    </div>
  );
}
```

```tsx
// Analytics.tsx: the only place the tag is added. Render it next to the banner.
import { useEffect } from "react";
import { useConsent } from "./consent";

export function Analytics({ id }: { id: string }) {
  const consent = useConsent();
  useEffect(() => {
    if (consent !== "granted" || document.getElementById("ga-script")) return;
    const s = document.createElement("script");
    s.id = "ga-script"; s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    document.head.appendChild(s);
    const w = window as unknown as { dataLayer: unknown[]; gtag: (...a: unknown[]) => void };
    w.dataLayer = w.dataLayer || [];
    w.gtag = function () { w.dataLayer.push(arguments); };
    w.gtag("js", new Date()); w.gtag("config", id);
  }, [consent, id]);
  return null;
}
```

Footer link: `<button type="button" onClick={reopenConsent}>Cookie settings</button>`. Give the two banner buttons the same styles. In Next.js, mark these files `"use client"` and do not also add Google's `@next/third-parties` tag, which would load before consent.

## Astro
Put the plain JavaScript above in `public/consent.js` and load it from your base layout, so it runs on every page without a framework island:

```astro
---
// src/layouts/Base.astro (excerpt)
---
<html lang="en">
  <head>
    <script is:inline src="/consent.js" defer></script>
  </head>
  <body>
    <slot />
    <footer><a href="#" onclick="openCookieSettings(); return false;">Cookie settings</a></footer>
  </body>
</html>
```

`is:inline` keeps Astro from bundling it, so the measurement ID stays in one plain file. If you prefer a React island, use the React files above with `client:only="react"`, so the banner is never in the prerendered HTML.

## Check it worked
1. Run `seo-autopilot run consent`. The `tracking-without-consent-tool` finding should be gone, and the report should list your custom consent logic.
2. In a private browser window, open the site with the network panel open. Before you click anything there must be no request to `googletagmanager.com` or `google-analytics.com`. Click Reject: still none, and reloading does not ask again. Use "Cookie settings", click Accept: the tag loads.
3. Read your privacy page against what the banner does. If they disagree, change the page.
