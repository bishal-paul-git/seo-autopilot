// Brief 01 items 4 and 5: the consent and conversion recipes' code is run here, so the playbooks cannot drift into code
// that does not work; plus the GA4 client and the conversions summary (mocked responses only).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkConsent } from "../src/analysis/consent.mjs";
import { eventCounts, keyEvents } from "../src/lib/ga4.mjs";
import { summarizeConversions } from "../src/analysis/conversions.mjs";

const read = (f) => readFileSync(fileURLToPath(new URL(`../knowledge/${f}`, import.meta.url)), "utf8");
const blocks = (md, lang) => [...md.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))].map((m) => m[1]);
const consentJs = blocks(read("consent-banner-recipe.md"), "js")[0];

/** A tiny browser: enough DOM for the consent script (createElement, head/body append, events, localStorage, reload). */
function fakeBrowser(stored = null) {
  const store = new Map(stored ? [["site-consent-v1", stored]] : []);
  const el = (tag) => ({ tag, attrs: {}, style: {}, children: [], listeners: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; }, addEventListener(t, f) { this.listeners[t] = f; }, remove() { this.removed = true; } });
  const head = { children: [], appendChild(c) { this.children.push(c); } };
  const body = { children: [], appendChild(c) { this.children.push(c); } };
  const window = { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, location: { reloaded: 0, reload() { this.reloaded++; } } };
  const document = { readyState: "complete", head, body, createElement: el, addEventListener() {} };
  new Function("window", "document", consentJs)(window, document);
  const banner = () => body.children.find((c) => c.attrs.role === "dialog" && !c.removed);
  const click = (choice) => banner().listeners.click({ target: { getAttribute: (k) => (k === "data-choice" ? choice : null) } });
  const tags = () => head.children.filter((c) => c.tag === "script" && /googletagmanager/.test(c.src || ""));
  return { window, store, banner, click, tags };
}

test("consent recipe: the product's consent check recognises it as a working consent mechanism", () => {
  const r = checkConsent({ html: `<html><head><script src="/consent.js" defer></script></head><body></body></html>`, privacyText: "We use analytics only with your consent.", scripts: [consentJs] });
  assert.ok(r.consentTools.some((t) => /custom consent logic/.test(t)), JSON.stringify(r.consentTools));
  assert.deepEqual(r.findings.filter((f) => f.severity === "high"), []);
});

test("consent recipe: nothing loads before a choice; Accept loads the tag once; Reject loads nothing", () => {
  const b = fakeBrowser();
  assert.ok(b.banner(), "the banner is shown");
  assert.equal(b.tags().length, 0, "no tag before a choice");
  b.click("granted");
  assert.equal(b.tags().length, 1);
  assert.equal(b.store.get("site-consent-v1"), "granted");
  assert.equal(b.banner(), undefined, "the banner closes");
  assert.equal(typeof b.window.gtag, "function");
  const r = fakeBrowser(); r.click("denied");
  assert.equal(r.tags().length, 0);
  assert.equal(r.store.get("site-consent-v1"), "denied");
});

test("consent recipe: a returning visitor is not asked again, and withdrawing consent reloads the page", () => {
  const back = fakeBrowser("granted");
  assert.equal(back.banner(), undefined);
  assert.equal(back.tags().length, 1, "accepted before: the tag loads at once");
  back.window.openCookieSettings();
  assert.ok(back.banner(), "Cookie settings shows the banner again");
  back.click("denied");
  assert.equal(back.window.location.reloaded, 1, "loaded scripts cannot be unloaded, so the page reloads");
  const refused = fakeBrowser("denied");
  assert.equal(refused.banner(), undefined);
  assert.equal(refused.tags().length, 0);
});

test("conversion recipe: track() sends cleaned categories and never throws without the tag", async () => {
  const src = blocks(read("conversion-tracking-recipe.md"), "js")[0];
  const sent = [];
  globalThis.window = { gtag: (...a) => sent.push(a) };
  try {
    const { track } = await import(`data:text/javascript,${encodeURIComponent(src)}`);
    track("generate_lead", { lead_source: "contact", empty: "", none: undefined, long: "x".repeat(150) });
    assert.deepEqual(sent, [["event", "generate_lead", { lead_source: "contact", long: "x".repeat(100) }]]);
    globalThis.window = {};
    assert.doesNotThrow(() => track("cta_click", {}));
  } finally { delete globalThis.window; }
});

const fakeFetch = (routes, calls = []) => async (url, init = {}) => {
  calls.push({ url, init });
  const hit = routes.find(([re]) => re.test(url));
  const [status, body] = hit ? hit[1](url) : [404, {}];
  return { ok: status < 400, status, json: async () => body };
};

test("GA4 client: runReport shape, key events across pages, and plain-English errors without the token", async () => {
  const calls = [];
  const f = fakeFetch([
    [/:runReport$/, () => [200, { rows: [{ dimensionValues: [{ value: "page_view" }], metricValues: [{ value: "900" }] }, { dimensionValues: [{ value: "generate_lead" }], metricValues: [{ value: "12" }] }] }]],
    [/keyEvents\?.*pageToken=p2/, () => [200, { keyEvents: [{ eventName: "purchase" }] }]],
    [/keyEvents\?/, () => [200, { keyEvents: [{ eventName: "generate_lead" }], nextPageToken: "p2" }]],
  ], calls);
  assert.deepEqual(await eventCounts("123", "SECRET", { fetchFn: f }), [{ name: "page_view", count: 900 }, { name: "generate_lead", count: 12 }]);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.dimensions, [{ name: "eventName" }]);
  assert.deepEqual(body.dateRanges, [{ startDate: "28daysAgo", endDate: "yesterday" }]);
  assert.deepEqual(await keyEvents("123", "SECRET", { fetchFn: f }), ["generate_lead", "purchase"]);
  const denied = fakeFetch([[/./, () => [403, { error: { message: "User does not have sufficient permissions" } }]]]);
  await assert.rejects(eventCounts("123", "SECRET", { fetchFn: denied }), (e) => /HTTP 403 \(give the service account Viewer access/.test(e.message) && !/SECRET/.test(e.message));
});

test("conversions summary: missing, unmarked and never-received key events, and an empty property", () => {
  const ev = [{ name: "page_view", count: 900 }, { name: "cta_click", count: 40 }, { name: "tool_complete", count: 5 }];
  const r = summarizeConversions(ev, ["purchase", "tool_complete"], ["generate_lead", "tool_complete", "cta_click"]);
  assert.deepEqual(r.findings.map((f) => f.id), ["conversion-event-missing", "conversion-not-key-event", "key-event-never-received"]);
  assert.deepEqual(r.findings[1].evidence, ["cta_click: 40 events, not a key event"]);
  assert.deepEqual(r.custom.map((e) => e.name), ["cta_click", "tool_complete"], "automatic events are not listed as conversions");
  assert.equal(summarizeConversions(ev, null, ["cta_click"]).findings.length, 0, "without key events, marking is not judged");
  assert.ok(summarizeConversions([], [], ["generate_lead"]).findings.some((f) => f.id === "ga4-no-events"));
});
