// Consent check, sensitive-topic gate, content-pace governor and citation tracker: pure functions, providers with a mocked
// fetch (live provider calls are NOT tested against the real APIs), and the jobs wired to temp folders.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkConsent } from "../src/analysis/consent.mjs";
import { checkYmyl, topicList } from "../src/analysis/ymyl.mjs";
import { analysePace, indexingSignal } from "../src/analysis/pace.mjs";
import { analyseCitations, appendHistory, trend, normaliseQuestions, MAX_QUESTIONS } from "../src/analysis/citations.mjs";
import { brave, serpapi, dataforseo, pickProvider, domainOf } from "../src/lib/serp.mjs";
import { routeAgents } from "../src/analysis/agent-router.mjs";
import { validate, DEFAULTS } from "../src/core/config.mjs";
import { JOBS } from "../src/jobs/index.mjs";

const GA = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script><script>gtag('config','G-ABC123')</script>`;

// ---------- consent ----------
test("consent: tracking with no consent tool is high; a known CMP clears it", () => {
  const bad = checkConsent({ html: `<html>${GA}<script>(function(c,l,a,r,i,t,y){})(window,document,"clarity","script","x")</script></html>` });
  assert.deepEqual(bad.trackers.sort(), ["Google Analytics / gtag", "Microsoft Clarity"]);
  assert.equal(bad.findings.find((f) => f.id === "tracking-without-consent-tool").severity, "high");
  const ok = checkConsent({ html: `<script src="https://consent.cookiebot.com/uc.js"></script>${GA}` });
  assert.deepEqual(ok.consentTools, ["Cookiebot"]);
  assert.ok(!ok.findings.some((f) => f.id === "tracking-without-consent-tool"));
});

test("consent: detects Meta Pixel, Hotjar and GTM; cookieless analytics needs no banner", () => {
  const r = checkConsent({ html: `<script src="https://connect.facebook.net/en_US/fbevents.js"></script><script>fbq('init','1')</script><script>hj('identify')</script><script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABCD12"></script>` });
  for (const t of ["Meta Pixel", "Hotjar", "Google Tag Manager"]) assert.ok(r.trackers.includes(t), t);
  const p = checkConsent({ html: `<script src="https://plausible.io/js/script.js"></script>` });
  assert.ok(!p.findings.some((f) => f.severity === "high"));
});

test("consent: a privacy page that promises consent without a mechanism is high", () => {
  const r = checkConsent({ html: "<html><body>hello</body></html>", privacyText: "We only set analytics cookies with your consent." });
  assert.ok(r.claimsConsent);
  assert.equal(r.findings.find((f) => f.id === "privacy-claims-consent-but-no-mechanism").severity, "high");
  assert.ok(checkConsent({ html: "<html></html>", privacyText: "We use opt-in cookies" }).claimsConsent);
  assert.ok(!checkConsent({ html: "<html></html>", privacyText: "We use cookies." }).claimsConsent);
});

test("consent: Consent Mode default denied counts as a mechanism, granted is medium", () => {
  const denied = checkConsent({ html: `${GA}<script>gtag('consent','default',{'analytics_storage':'denied','ad_storage':'denied'});</script>`, privacyText: "with your consent" });
  assert.equal(denied.consentMode, true);
  assert.equal(denied.findings.filter((f) => f.severity === "high").length, 0);
  const granted = checkConsent({ html: `${GA}<script>gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied' });</script>` });
  const f = granted.findings.find((x) => x.id === "consent-mode-default-not-denied");
  assert.equal(f.severity, "medium");
  assert.match(f.evidence[0], /analytics_storage/);
});

test("consent: no trackers found says static HTML cannot see runtime tags", () => {
  const r = checkConsent({ html: "<html><body>plain</body></html>" });
  const f = r.findings.find((x) => x.id === "trackers-injected-at-runtime-unknown");
  assert.equal(f.severity, "info");
  assert.match(f.title + f.evidence.join(), /runtime/);
  assert.ok(!checkConsent({ html: "<!-- " + GA + " -->" }).trackers.length, "commented-out tags are ignored");
});

// ---------- ymyl ----------
const P = (o) => ({ title: "", url: "", text: "", ...o });

test("ymyl: flags sensitive topics and sorts them into ok, needs reviewer and held", () => {
  const r = checkYmyl([
    P({ title: "GDPR for small shops", url: "https://x.test/gdpr", author: "A", reviewedBy: "B" }),
    P({ title: "Symptoms of burnout", author: "A" }),
    P({ title: "Tax return checklist", hold: true }),
    P({ title: "Our team picnic" }),
  ]);
  assert.equal(r.flagged, 3);
  const by = (t) => r.pages.find((p) => p.title === t);
  assert.equal(by("GDPR for small shops").status, "ok");
  assert.equal(by("Symptoms of burnout").status, "needs reviewer");
  assert.deepEqual(by("Symptoms of burnout").missing, ["reviewedBy"]);
  assert.equal(by("Tax return checklist").status, "held");
  assert.equal(r.needsReviewer, 1);
});

test("ymyl: custom topics and fields, a topic can be switched off, a bad regex is ignored, sitemap sites are unchecked", () => {
  const review = { topics: { weapons: ["firearm\\w*"], children: [], finance: ["("] }, requireFields: ["author"] };
  const names = topicList(review).map((t) => t.topic);
  assert.ok(names.includes("weapons") && !names.includes("children") && !names.includes("finance"));
  const r = checkYmyl([P({ title: "Firearms licensing", author: "Z" }), P({ title: "Kids club timetable" })], review);
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].status, "ok");
  assert.equal(checkYmyl([P({ title: "How to claim a refund" })], {}, { fieldsKnown: false }).pages[0].status, "unchecked");
  assert.equal(checkYmyl([P({ title: "Insurance basics", url: "https://x.test/insurance-basics" })]).pages[0].topics[0], "finance");
});

// ---------- pace ----------
const pg = (title, publishAt, extra = {}) => ({ title, url: `https://x.test/${title}`, publishAt, ...extra });

test("pace: flags a burst and recommends a schedule that respects limits, order and never moves earlier", () => {
  const pages = ["a", "b", "c", "d", "e"].map((t) => pg(t, "2026-10-20"));
  const r = analysePace({ pages, limits: { pagesPerDay: 2, pagesPerWeek: 8 }, today: "2026-10-15" });
  assert.deepEqual(r.overDays, [{ date: "2026-10-20", count: 5 }]);
  assert.ok(r.overLimit);
  assert.deepEqual(r.schedule.map((s) => s.to), ["2026-10-20", "2026-10-20", "2026-10-21", "2026-10-21", "2026-10-22"]);
  assert.deepEqual(r.schedule.map((s) => s.title), ["a", "b", "c", "d", "e"], "stable order");
  assert.ok(r.schedule.every((s) => s.to >= s.from));
  assert.equal(r.moves.length, 3);
});

test("pace: the weekly limit spills pages into the next week, and past releases count", () => {
  const past = ["p1", "p2", "p3"].map((t, i) => pg(t, `2026-10-1${i + 2}`));
  const up = ["u1", "u2", "u3", "u4"].map((t, i) => pg(t, `2026-10-1${5 + (i % 2)}`));
  const r = analysePace({ pages: [...past, ...up], limits: { pagesPerDay: 2, pagesPerWeek: 4 }, today: "2026-10-15" });
  assert.equal(r.schedule[0].to, "2026-10-15");
  assert.equal(r.schedule[1].to, "2026-10-19", "the 7-day window ending on 10-19 has room again");
});

test("pace: never schedules before today, ignores held pages, honours the per-template limit", () => {
  const pages = [pg("old", "2026-10-01", { template: "guide" }), pg("a", "2026-10-15", { template: "guide" }), pg("b", "2026-10-15", { template: "guide" }), pg("c", "2026-10-15", { template: "faq" }), pg("h", "2026-10-15", { hold: true })];
  const r = analysePace({ pages, limits: { pagesPerDay: 5, pagesPerWeek: 20, perTemplatePerDay: 1 }, today: "2026-10-15" });
  assert.equal(r.schedule.length, 3);
  assert.ok(r.schedule.every((s) => s.to >= "2026-10-15"));
  assert.equal(r.schedule.find((s) => s.title === "a").to, "2026-10-15");
  assert.equal(r.schedule.find((s) => s.title === "b").to, "2026-10-16");
  assert.equal(r.overTemplate.length, 1);
  assert.equal(analysePace({ pages: [pg("a", "2026-10-20")], today: "2026-10-15" }).overLimit, false);
});

test("pace: many recent pages not indexed halve the recommended pace", () => {
  const recent = ["r1", "r2", "r3", "r4"].map((t, i) => pg(t, `2026-10-0${i + 1}`));
  const inspect = Object.fromEntries(recent.map((p, i) => [p.url, { coverage: i < 3 ? "Crawled - currently not indexed" : "Submitted and indexed" }]));
  const sig = indexingSignal({ pages: recent, inspect, today: "2026-10-15" });
  assert.equal(sig.slow, true);
  const r = analysePace({ pages: [...recent, pg("n1", "2026-10-16"), pg("n2", "2026-10-16")], limits: { pagesPerDay: 2, pagesPerWeek: 8 }, today: "2026-10-15", inspect });
  assert.equal(r.reducedForIndexing, true);
  assert.deepEqual(r.effectiveLimits, { pagesPerDay: 1, pagesPerWeek: 4, perTemplatePerDay: null });
  assert.deepEqual(r.schedule.map((s) => s.to), ["2026-10-16", "2026-10-17"]);
  assert.equal(r.overLimit, false, "judged against the configured limits, not the reduced ones");
});

// ---------- providers (mocked fetch) ----------
const jsonRes = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });

test("serp: provider selection follows the environment", () => {
  assert.equal(pickProvider({}), null);
  assert.equal(pickProvider({ SERPAPI_KEY: "k" }).name, "serpapi");
  assert.equal(pickProvider({ DATAFORSEO_LOGIN: "a" }), null, "needs login and password");
  assert.equal(pickProvider({ DATAFORSEO_LOGIN: "a", DATAFORSEO_PASSWORD: "b" }).name, "dataforseo");
  assert.equal(pickProvider({ BRAVE_API_KEY: "k", SERPAPI_KEY: "k" }).name, "brave");
  assert.equal(domainOf("https://www.Example.co.uk/a"), "example.co.uk");
});

test("serp: brave sends the documented request and normalises results", async () => {
  let seen;
  const fetch = async (url, init) => { seen = { url: new URL(url), init }; return jsonRes({ web: { results: [{ title: "T1", url: "https://www.a.com/x" }, { title: "T2", url: "https://b.com/y" }] } }); };
  const r = await brave.search("best widgets", "UK", { fetch, env: { BRAVE_API_KEY: "secret" } });
  assert.equal(seen.url.origin + seen.url.pathname, "https://api.search.brave.com/res/v1/web/search");
  assert.equal(seen.url.searchParams.get("country"), "GB");
  assert.equal(seen.url.searchParams.get("q"), "best widgets");
  assert.equal(seen.init.headers["X-Subscription-Token"], "secret");
  assert.deepEqual(r.results[0], { url: "https://www.a.com/x", domain: "a.com", title: "T1", position: 1 });
  assert.deepEqual(r.aiSources, []);
  assert.equal(r.raw, false);
});

test("serp: serpapi reads organic results and AI Overview references, and follows a page_token", async () => {
  const calls = [];
  const fetch = async (url) => {
    const u = new URL(url); calls.push(u);
    if (u.searchParams.get("engine") === "google_ai_overview") return jsonRes({ ai_overview: { references: [{ title: "S", link: "https://src.org/p", source: "Src" }] } });
    return jsonRes({ organic_results: [{ position: 1, title: "A", link: "https://a.com/1" }, { position: 2, title: "B", link: "https://me.com/2" }], ai_overview: { page_token: "tok" } });
  };
  const r = await serpapi.search("q", "GB", { fetch, env: { SERPAPI_KEY: "k" } });
  assert.equal(calls[0].searchParams.get("gl"), "uk");
  assert.equal(calls[1].searchParams.get("page_token"), "tok");
  assert.equal(r.results[1].position, 2);
  assert.deepEqual(r.aiSources, [{ url: "https://src.org/p", domain: "src.org" }]);
  const direct = await serpapi.search("q", "GB", { fetch: async () => jsonRes({ organic_results: [], ai_overview: { references: [{ link: "https://d.com/z" }] } }), env: { SERPAPI_KEY: "k" } });
  assert.equal(direct.aiSources[0].domain, "d.com");
});

test("serp: dataforseo posts one task with Basic auth and reads organic and ai_overview items", async () => {
  let seen;
  const fetch = async (url, init) => {
    seen = { url, init };
    return jsonRes({ tasks: [{ status_code: 20000, result: [{ items: [
      { type: "ai_overview", references: [{ type: "ai_overview_reference", url: "https://www.cited.com/a", domain: "www.cited.com", title: "C" }] },
      { type: "organic", rank_absolute: 3, url: "https://me.com/p", domain: "me.com", title: "Me" },
      { type: "people_also_ask" },
    ] }] }] });
  };
  const r = await dataforseo.search("q", "GB", { fetch, env: { DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p" } });
  assert.equal(seen.url, "https://api.dataforseo.com/v3/serp/google/organic/live/advanced");
  assert.equal(seen.init.headers.Authorization, "Basic " + Buffer.from("l:p").toString("base64"));
  const body = JSON.parse(seen.init.body);
  assert.equal(body.length, 1);
  assert.equal(body[0].location_name, "United Kingdom");
  assert.deepEqual(r.results, [{ url: "https://me.com/p", domain: "me.com", title: "Me", position: 3 }]);
  assert.deepEqual(r.aiSources, [{ url: "https://www.cited.com/a", domain: "cited.com" }]);
});

test("serp: errors never contain the key", async () => {
  const fetch = async () => jsonRes({}, 401);
  for (const [p, env] of [[brave, { BRAVE_API_KEY: "TOPSECRET" }], [serpapi, { SERPAPI_KEY: "TOPSECRET" }], [dataforseo, { DATAFORSEO_LOGIN: "TOPSECRET", DATAFORSEO_PASSWORD: "TOPSECRET" }]]) {
    await assert.rejects(() => p.search("q", "GB", { fetch, env }), (e) => /401/.test(e.message) && !/TOPSECRET/.test(e.message));
  }
  await assert.rejects(() => serpapi.search("q", "GB", { fetch: async () => { throw new Error("https://serpapi.com/?api_key=TOPSECRET"); }, env: { SERPAPI_KEY: "TOPSECRET" } }), (e) => !/TOPSECRET/.test(e.message));
});

// ---------- citations analysis ----------
test("citations: appearance, AI sources, competitors and absent questions", () => {
  const answers = [
    { q: "one", market: "GB", results: [{ url: "https://c.com", domain: "c.com", position: 1 }, { url: "https://www.me.com/a", domain: "me.com", position: 4 }], aiSources: [] },
    { q: "two", market: "GB", results: [{ url: "https://c.com", domain: "c.com", position: 1 }], aiSources: [{ url: "https://blog.me.com/z", domain: "blog.me.com" }] },
    { q: "three", market: "GB", results: [{ url: "https://c.com", domain: "c.com", position: 1 }, { url: "https://d.com", domain: "d.com", position: 2 }], aiSources: [] },
    { q: "four", market: "GB", error: "brave: HTTP 429 (rate limited)" },
  ];
  const r = analyseCitations({ domain: "www.me.com", answers });
  assert.equal(r.asked, 3);
  assert.equal(r.errors, 1);
  assert.equal(r.appears, 2);
  assert.equal(r.share, 0.667);
  assert.deepEqual(r.absent, ["three"]);
  assert.equal(r.rows[0].organicPosition, 4);
  assert.equal(r.rows[1].inAiAnswer, true);
  assert.deepEqual(r.topCited[0], { domain: "c.com", count: 3 });
  assert.ok(!r.topCited.some((x) => x.domain.endsWith("me.com")));
  assert.equal(r.mostlyAbsent, false);
  assert.equal(analyseCitations({ domain: "me.com", answers: answers.slice(2, 3).concat(answers.slice(2, 3), answers.slice(2, 3)) }).mostlyAbsent, true);
});

test("citations: history keeps the last 26 runs, one per day, and the trend groups by month", () => {
  let h = [];
  for (let i = 0; i < 30; i++) h = appendHistory(h, { date: new Date(Date.UTC(2026, 0, 1 + i * 7)).toISOString().slice(0, 10), provider: "x", asked: 10, appears: i % 10, share: (i % 10) / 10 });
  assert.equal(h.length, 26);
  assert.equal(h[0].date, "2026-01-29");
  h = appendHistory(h, { date: h.at(-1).date, provider: "x", asked: 10, appears: 9, share: 0.9 });
  assert.equal(h.length, 26);
  assert.equal(h.at(-1).appears, 9);
  const t = trend([{ date: "2026-09-02", asked: 10, appears: 1 }, { date: "2026-09-20", asked: 10, appears: 3 }, { date: "2026-10-05", asked: 10, appears: 5 }]);
  assert.deepEqual(t.map((x) => [x.month, x.share, x.runs]), [["2026-09", 0.2, 2], ["2026-10", 0.5, 1]]);
});

test("citations: questions accept strings and objects, skip the placeholder note, cap at 40", () => {
  const q = normaliseQuestions(["REPLACE THESE: x", "a?", { q: "b?", market: "US" }, "", { nope: 1 }]);
  assert.deepEqual(q, [{ q: "a?", market: "GB" }, { q: "b?", market: "US" }]);
  assert.equal(normaliseQuestions(Array.from({ length: 100 }, (_, i) => `q${i}`)).length, MAX_QUESTIONS);
});

// ---------- jobs ----------
function tmpSite(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "seo-f2-"));
  const state = join(root, ".seo-autopilot", "t"), data = join(root, "seo-autopilot");
  mkdirSync(state, { recursive: true }); mkdirSync(data, { recursive: true });
  return { root, state, data, site: { id: "t", name: "T", url: "https://me.test/", sitemap: "https://me.test/sitemap.xml", paths: { root, state, data }, limits: {}, ...extra } };
}
const withLog = async (fn) => { const log = console.log; const lines = []; console.log = (...a) => lines.push(a.join(" ")); try { await fn(); } finally { console.log = log; } return lines.join("\n"); };

test("the four jobs are registered and describe themselves", async () => {
  for (const n of ["consent", "ymyl", "pace", "citations"]) { const m = await JOBS[n](); assert.equal(typeof m.run, "function"); assert.ok(m.description.length > 10); }
});

test("citations job: no key prints how to enable one and exits cleanly; with a mocked provider it writes history and the report", async () => {
  const { site, state, data } = tmpSite();
  const { run } = await JOBS.citations();
  const out = await withLog(() => run({ site, flags: {} }, { env: {} }));
  for (const w of ["BRAVE_API_KEY", "SERPAPI_KEY", "DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "repository secret"]) assert.ok(out.includes(w), w);
  assert.ok(!existsSync(join(state, "citations.json")));

  writeFileSync(join(data, "questions.json"), JSON.stringify(["REPLACE THESE: note", "example?"]));
  assert.match(await withLog(() => run({ site, flags: {} }, { env: { BRAVE_API_KEY: "k" } })), /REPLACE THESE/);

  writeFileSync(join(data, "questions.json"), JSON.stringify(["q1?", { q: "q2?", market: "US" }, "q3?"]));
  const fetch = async (url) => jsonRes(new URL(url).searchParams.get("q") === "q1?" ? { web: { results: [{ title: "Me", url: "https://me.test/a" }, { title: "Other", url: "https://o.com" }] } } : { web: { results: [{ title: "Other", url: "https://o.com" }] } });
  const md = await withLog(() => run({ site, flags: {} }, { env: { BRAVE_API_KEY: "k" }, fetch, delayMs: 0 }));
  const j = JSON.parse(readFileSync(join(state, "citations.json"), "utf8"));
  assert.equal(j.asked, 3); assert.equal(j.appears, 1); assert.equal(j.history.length, 1);
  assert.deepEqual(j.absent, ["q2?", "q3?"]);
  assert.match(md, /Questions where the site is absent/);
  assert.ok(!md.includes("\"k\""));
  assert.match(readFileSync(join(state, "citations.md"), "utf8"), /Most cited domains/);
  await withLog(() => run({ site, flags: {} }, { env: { BRAVE_API_KEY: "k" }, fetch: async () => jsonRes({}, 429), delayMs: 0 }));
  assert.equal(JSON.parse(readFileSync(join(state, "citations.json"), "utf8")).errors, 3, "provider failures are recorded, not thrown");
});

test("consent job fetches the home page and a privacy page and writes consent.json/md", async () => {
  const { site, state } = tmpSite();
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u === "https://me.test/") return new Response(`<html>${GA}</html>`, { status: 200 });
    if (u === "https://me.test/privacy") return new Response(`<html><body>${"We only use cookies with your consent. ".repeat(20)}</body></html>`, { status: 200 });
    return new Response("no", { status: 404 });
  };
  try {
    const { run } = await JOBS.consent();
    await withLog(() => run({ site, flags: {} }));
  } finally { globalThis.fetch = saved; }
  const j = JSON.parse(readFileSync(join(state, "consent.json"), "utf8"));
  assert.equal(j.privacyUrl, "https://me.test/privacy");
  assert.deepEqual(j.findings.map((f) => f.id).sort(), ["privacy-claims-consent-but-no-mechanism", "tracking-without-consent-tool"]);
  const md = readFileSync(join(state, "consent.md"), "utf8");
  assert.match(md, /Real traffic versus measured traffic/);
});

test("ymyl and pace jobs read json content (with author/reviewedBy), write reports and never edit content", async () => {
  const t = tmpSite({ content: { type: "json", include: ["content/*.json"], routes: [{ match: "guides.json", urlPattern: "/guides/{slug}" }] }, review: { requireFields: ["author", "reviewedBy"] }, limits: { pagesPerDay: 1, pagesPerWeek: 8 } });
  mkdirSync(join(t.root, "content"));
  const file = join(t.root, "content", "guides.json");
  const items = [
    { slug: "gdpr-basics", title: "GDPR basics for shops", author: { name: "Ann" }, reviewedBy: "Dr Lee", publishAt: "2099-01-01" },
    { slug: "symptoms", title: "Common symptoms guide", author: "Bob", publishAt: "2099-01-01" },
    { slug: "picnic", title: "Team picnic", publishAt: "2099-01-01" },
  ];
  writeFileSync(file, JSON.stringify(items));
  const before = readFileSync(file, "utf8");
  await withLog(async () => { await (await JOBS.ymyl()).run({ site: t.site, flags: {} }); await (await JOBS.pace()).run({ site: t.site, flags: {} }); });
  const y = JSON.parse(readFileSync(join(t.state, "ymyl.json"), "utf8"));
  assert.equal(y.flagged, 2);
  assert.equal(y.pages.find((p) => /symptoms/.test(p.title)).status, "needs reviewer");
  assert.equal(y.pages.find((p) => /GDPR/.test(p.title)).status, "ok");
  const p = JSON.parse(readFileSync(join(t.state, "pace.json"), "utf8"));
  assert.equal(p.overLimit, true);
  assert.equal(p.moves.length, 2);
  assert.match(readFileSync(join(t.state, "pace.md"), "utf8"), /This report changes nothing/);
  assert.equal(readFileSync(file, "utf8"), before, "pace is report only");
  const out = await withLog(async () => (await JOBS.pace()).run({ site: t.site, flags: { json: true } }));
  assert.ok(JSON.parse(out).schedule);
});

// ---------- router, config ----------
test("router: a high consent finding blocks with the compliance auditor; ymyl, pace and citations add their agents", () => {
  const consent = { findings: [{ id: "tracking-without-consent-tool", severity: "high", title: "t", evidence: ["trackers found: Meta Pixel"] }] };
  const ymyl = { pages: [{ title: "Symptoms", url: "https://x.test/symptoms", topics: ["health"], missing: ["reviewedBy"], status: "needs reviewer" }] };
  const pace = { overLimit: true, overDays: [{ date: "2026-10-20", count: 5 }], overWeeks: [], moves: [{}, {}] };
  const citations = { mostlyAbsent: true, appears: 1, asked: 10, absent: ["q1"], topCited: [{ domain: "big.com", count: 6 }] };
  const plan = routeAgents({ profile: { mode: "edit", signals: {}, platform: {} }, consent, ymyl, pace, citations, today: "2026-10-15" });
  const get = (a) => plan.steps.find((s) => s.agent === a);
  assert.equal(get("seo-compliance-auditor").phase, "block");
  assert.ok(get("seo-compliance-auditor").evidence.some((e) => /Meta Pixel/.test(e)));
  assert.match(get("seo-compliance-auditor").prompt, /ymyl\.json/, "both reasons reach the one auditor entry");
  assert.ok(get("seo-strategist").evidence.some((e) => /2026-10-20/.test(e)));
  assert.ok(get("seo-ai-search-agent").evidence.includes("q1"));
  const quiet = routeAgents({ profile: { mode: "edit", signals: {}, platform: {} }, consent: { findings: [{ severity: "info" }] }, ymyl: { pages: [{ status: "ok" }] }, pace: { overLimit: false }, citations: { mostlyAbsent: false }, today: "x" });
  assert.ok(!quiet.steps.some((s) => s.agent === "seo-compliance-auditor"));
  assert.ok(!quiet.steps.some((s) => s.agent === "seo-ai-search-agent"));
});

test("config: review and the pace limits validate and have defaults", () => {
  const site = { id: "a", url: "https://a.test/", searchConsoleProperty: "https://a.test/", sitemap: "https://a.test/s.xml" };
  assert.deepEqual(validate({ sites: [{ ...site, limits: { pagesPerDay: 3, pagesPerWeek: 10 }, review: { topics: { health: ["x"] }, requireFields: ["author"] } }] }), []);
  assert.ok(validate({ sites: [{ ...site, limits: { pagesPerDay: 0 } }] }).some((e) => /pagesPerDay/.test(e)));
  assert.ok(validate({ sites: [{ ...site, review: { topics: { health: "x" } } }] }).some((e) => /review.topics/.test(e)));
  assert.ok(validate({ sites: [{ ...site, review: { requireFields: "author" } }] }).some((e) => /requireFields/.test(e)));
  assert.equal(DEFAULTS.site.limits.pagesPerDay, 2);
  assert.equal(DEFAULTS.site.limits.pagesPerWeek, 8);
});

test("the weekly workflow runs the four new jobs before the agent plan, each non-blocking, and passes the three provider secrets", () => {
  const t = readFileSync(new URL("../templates/workflows/seo-weekly.yml", import.meta.url), "utf8");
  const at = (s) => t.indexOf(s);
  for (const j of ["run consent", "run ymyl", "run pace", "run citations"]) assert.ok(at(j) > 0 && at(j) < at("run team"), j);
  for (const s of ["BRAVE_API_KEY", "SERPAPI_KEY", "DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"]) assert.match(t, new RegExp(`${s}: \\$\\{\\{ secrets\\.${s} \\}\\}`));
  const step = t.slice(at("Citations in search"), at("Which agents"));
  assert.match(step, /continue-on-error: true/);
});

test("consent: a custom banner found in the site's own scripts counts as a consent mechanism", async () => {
  const { checkConsent } = await import("../src/analysis/consent.mjs");
  const html = '<html><head><script src="/a.js"></script></head><body></body></html>';
  const bundle = 'const k="site-consent-v1";function f(v){localStorage.setItem(k,v==="granted"?"granted":"denied")}loadScript("https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4")';
  const withBanner = checkConsent({ html, privacyText: "Analytics rely on your consent.", scripts: [bundle] });
  assert.ok(withBanner.consentTools.some((t) => /custom consent/.test(t)));
  assert.ok(!withBanner.findings.some((f) => f.severity === "high"));
  const without = checkConsent({ html, privacyText: "Analytics rely on your consent.", scripts: ['loadScript("https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4")'] });
  assert.ok(without.findings.some((f) => f.id === "privacy-claims-consent-but-no-mechanism"));
});
