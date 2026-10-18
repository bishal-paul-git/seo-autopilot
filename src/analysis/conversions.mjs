// Which conversion events GA4 receives and which are marked as key events. Pure: pass the API results in.

/** GA4's automatic and enhanced-measurement events: always present, never a conversion by themselves. */
export const AUTOMATIC = new Set(["page_view", "session_start", "first_visit", "user_engagement", "scroll", "click", "file_download", "form_start", "form_submit", "video_start", "video_progress", "video_complete", "view_search_results"]);
export const SUGGESTED = ["generate_lead", "tool_complete", "view_calendar", "cta_click"];

/**
 * `events` = [{ name, count }] from the Data API, `marked` = key event names from the Admin API (null when unavailable),
 * `expected` = events the site should send (config conversions.events, default ["generate_lead"]).
 */
export function summarizeConversions(events = [], marked = null, expected = ["generate_lead"]) {
  const got = new Map(events.map((e) => [e.name, e.count]));
  const keys = marked == null ? null : new Set(marked);
  const custom = events.filter((e) => !AUTOMATIC.has(e.name)).sort((a, b) => b.count - a.count);
  const findings = [];
  const missing = expected.filter((n) => !got.has(n));
  if (missing.length) findings.push({ id: "conversion-event-missing", severity: "high", title: "An expected conversion event was not received", evidence: missing.map((n) => `${n}: no events in the period`), fix: "Send the event when the outcome happens (see conversion-tracking-recipe.md). If consent is required, check it fires after the visitor accepts." });
  if (keys) {
    const notMarked = expected.filter((n) => got.has(n) && !keys.has(n));
    if (notMarked.length) findings.push({ id: "conversion-not-key-event", severity: "medium", title: "A conversion event arrives but is not marked as a key event", evidence: notMarked.map((n) => `${n}: ${got.get(n)} events, not a key event`), fix: "In GA4 admin, mark the event as a key event so it is reported as a conversion." });
    const empty = [...keys].filter((n) => !got.has(n));
    if (empty.length) findings.push({ id: "key-event-never-received", severity: "low", title: "A key event received nothing in the period", evidence: empty.map((n) => `${n}: marked, 0 events`), fix: "Check the event name matches what the site sends, or unmark a goal that no longer exists." });
  }
  if (!events.length) findings.push({ id: "ga4-no-events", severity: "high", title: "GA4 received no events at all in the period", evidence: ["the Data API returned no rows"], fix: "Check the measurement ID on the site, that the tag loads after consent, and that the right property is configured." });
  return { received: events.length, custom, keyEvents: keys ? [...keys] : null, expected, findings };
}
