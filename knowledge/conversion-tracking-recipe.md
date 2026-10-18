# Recipe: privacy-safe conversion tracking in GA4

Use this when the digest or the `conversions` job shows that GA4 receives page views but no conversions, or when you want to know which pages bring leads and not just visits. It is the pattern Erudience runs in production (`src/lib/track.ts` and a click tracker), made framework-neutral. It assumes analytics loads only after consent (see [the consent banner recipe](consent-banner-recipe.md)): every call below does nothing until the GA4 tag is present.

## Rules
1. **Never send personal data.** No names, emails, phone numbers, company names, free text the visitor typed, or URLs with personal query strings. GA4's terms forbid it, and you do not need it to measure conversions. Send categories you chose ("contact", "book"), never values the visitor entered.
2. **Use few, stable event names.** Google recommends `generate_lead` for a lead; use it rather than inventing one. Keep your own names short, lower case, with underscores.
3. **One event per real outcome.** Send `generate_lead` when the lead is saved (after the form succeeds), not when the button is clicked. A click is `cta_click`, a separate and weaker signal.
4. **Mark the outcomes as key events in GA4.** Until an event is marked as a key event, GA4 counts it but does not report it as a conversion. Do this in the GA4 admin under Events or Key events (the menu has moved between interface versions); events appear there after they are first received.

## Suggested events
| Event | When | Parameters (categories only) |
|---|---|---|
| `generate_lead` | a lead form was saved | `lead_source`: `contact`, `book`, `quote`, the tool's name |
| `tool_complete` | a visitor finished a calculator, checklist or quiz | `tool`: the tool's name |
| `view_calendar` | the booking calendar was shown after a form | none |
| `cta_click` | a click on a link to a conversion page | `cta_target`: the path, `cta_location`: the page section |

Mark `generate_lead` as a key event. Mark `tool_complete` too if finishing the tool is a goal in itself.

## The helper (any framework)
```js
// track.js: send a GA4 event if the tag is loaded (after consent). Never send personal data.
export function track(event, params = {}) {
  try {
    if (typeof window === "undefined" || typeof window.gtag !== "function") return;
    const clean = {};
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === "") continue;
      clean[k] = typeof v === "string" ? v.slice(0, 100) : v;
    }
    window.gtag("event", event, clean);
  } catch (e) {
    // analytics must never break the page
  }
}
```

After a form saves, call `track("generate_lead", { lead_source: "contact" })`. After a tool shows its result, call `track("tool_complete", { tool: "roi_calculator" })`.

## Counting call-to-action clicks without editing every button
One listener on the document catches clicks on links to your conversion pages. Set the list to your own pages.

```js
// cta-tracker.js: counts clicks on links that lead to a conversion page.
import { track } from "./track.js";
const CTA_PAGES = new Set(["/contact", "/book", "/quote"]);
document.addEventListener("click", (e) => {
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!a) return;
  let url;
  try { url = new URL(a.getAttribute("href"), window.location.href); } catch { return; }
  if (url.origin !== window.location.origin) return;
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (!CTA_PAGES.has(path)) return;
  const section = a.closest("[data-cta-location]")?.getAttribute("data-cta-location") || "page";
  track("cta_click", { cta_target: path, cta_location: section });
}, { capture: true });
```

In React, import both files once from your app entry. In Astro, add `<script>import "../scripts/cta-tracker.js";</script>` to the base layout (Astro bundles it). On a static site, load them as modules: `<script type="module" src="/cta-tracker.js"></script>`.

## Check it worked
1. With consent given, open GA4 Realtime (or DebugView with the Google Analytics Debugger) and submit a test lead. `generate_lead` should appear with `lead_source` and nothing personal.
2. Run `seo-autopilot run conversions` (it needs `ga4PropertyId` and Viewer access for the service account). It lists the events GA4 received in the last 28 days, which ones are marked as key events, and which of the suggested events are missing or not marked.
3. Remove test submissions from your lead list, and do not count them in a report.
