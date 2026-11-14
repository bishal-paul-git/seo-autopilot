// Central speed checks for hosted sites (D56): once a week, the home page and the top pages by Search Console clicks
// through PageSpeed Insights (phone), plus the site's real-user numbers from the Chrome UX Report, with ONE platform key
// (Worker secret PAGESPEED_API_KEY) so customers never create a key. Both are free Google APIs. The open-source CLI keeps
// the user's own key (src/jobs/speed.mjs). Stored as site memory report "speed" for the agents and the portal.
// A Worker has little CPU per invocation, so PageSpeed is asked only for the few fields used (`fields`): a full
// Lighthouse result is about a megabyte of JSON.
export const SPEED_PAGES = 4, SPEED_EVERY_DAYS = 7;
const PSI_FIELDS = "lighthouseResult(categories/performance/score,audits/largest-contentful-paint/numericValue,audits/cumulative-layout-shift/numericValue,audits/total-blocking-time/numericValue),loadingExperience(overall_category,metrics)";

/** Whether the site's speed report is missing or about a week old (a little early, so the weekly run never slips a week). */
export function speedDue(memory, now) {
  const s = memory.find((m) => m.kind === "report" && m.key === "speed")?.value;
  return !s?.generatedAt || Date.parse(now) - Date.parse(s.generatedAt) > (SPEED_EVERY_DAYS - 0.5) * 864e5;
}

/** Home page plus the top pages by clicks from the Search Console snapshot, same host only, at most `max`. */
export function speedPages(siteUrl, memory, max = SPEED_PAGES) {
  const home = new URL("/", siteUrl).toString(), host = new URL(siteUrl).hostname.replace(/^www\./, "");
  const sc = memory.find((m) => m.kind === "report" && m.key === "search_console")?.value;
  const top = [...(sc?.pages || [])].sort((a, b) => (b.clicks || 0) - (a.clicks || 0) || (b.impressions || 0) - (a.impressions || 0)).map((p) => p.url);
  const same = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname.replace(/^www\./, "") === host; } catch { return false; } };
  return [...new Set([home, ...top.filter(same)])].slice(0, Math.max(1, max));
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
async function psi(fetchImpl, key, url, base) {
  const q = new URLSearchParams({ url, strategy: "mobile", category: "performance", key, fields: PSI_FIELDS });
  try {
    const r = await fetchImpl(`${base || "https://www.googleapis.com"}/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(90_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { url, error: String(j.error?.message || `HTTP ${r.status}`).slice(0, 160) };
    const a = j.lighthouseResult?.audits || {}, f = j.loadingExperience?.metrics || {};
    const score = j.lighthouseResult?.categories?.performance?.score;
    return { url, score: typeof score === "number" ? Math.round(score * 100) : null,
      lab: { lcpMs: num(a["largest-contentful-paint"]?.numericValue), cls: num(a["cumulative-layout-shift"]?.numericValue), tbtMs: num(a["total-blocking-time"]?.numericValue) },
      field: { lcpMs: f.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null, inpMs: f.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
        cls: f.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? f.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null, category: j.loadingExperience?.overall_category || null } };
  } catch (e) { return { url, error: String(e.message || e).slice(0, 160) }; }
}

/** Real Chrome users on phones for the whole site over 28 days (75th percentile), or a note when Chrome has too little data. */
async function crux(fetchImpl, key, origin, base) {
  try {
    const r = await fetchImpl(`${base || "https://chromeuxreport.googleapis.com"}/v1/records:queryRecord?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin, formFactor: "PHONE", metrics: ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift"] }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) return { origin, note: "Chrome has too few visits to this site to report real-user speed" };
    if (!r.ok) return { origin, error: String(j.error?.message || `HTTP ${r.status}`).slice(0, 160) };
    const m = j.record?.metrics || {}, p = (k) => m[k]?.percentiles?.p75 ?? null;
    const cls = p("cumulative_layout_shift");
    return { origin, lcpMs: p("largest_contentful_paint"), inpMs: p("interaction_to_next_paint"), cls: cls == null ? null : Number(cls), period: j.record?.collectionPeriod || null };
  } catch (e) { return { origin, error: String(e.message || e).slice(0, 160) }; }
}

/** The "speed_snapshot" job. deps: { store, siteOf, apiKey, fetchImpl, now, maxPages, base: { psi, crux } (tests only) }. */
export function makeSpeedHandler({ store, siteOf, apiKey, fetchImpl = (...a) => fetch(...a), now = () => new Date().toISOString(), maxPages = SPEED_PAGES, base = {} }) {
  return async (job) => {
    const site = await siteOf(job.siteId);
    const memory = (await store.readMemory(job.siteId, "report")) || [];
    const urls = speedPages(site.url, memory, maxPages);
    const pages = [];
    for (let i = 0; i < urls.length; i += 2) pages.push(...(await Promise.all(urls.slice(i, i + 2).map((u) => psi(fetchImpl, apiKey, u, base.psi))))); // PageSpeed takes 10-30 s a page
    const origin = await crux(fetchImpl, apiKey, new URL(site.url).origin, base.crux);
    const ok = pages.filter((p) => !p.error);
    // Every page failing is a platform problem (key, quota), not a fact about the site: fail and retry, store nothing.
    if (!ok.length) throw new Error(`speed check failed: ${pages[0]?.error || "no pages"}`);
    const value = { generatedAt: now(), strategy: "mobile", source: "PageSpeed Insights and Chrome UX Report", origin, pages };
    await store.writeMemory(job.siteId, [{ kind: "report", key: "speed", value, basis: "verified", confidence: null, source: "pagespeed" }]);
    const home = ok.find((p) => p.url === urls[0]);
    return { costUsd: 0, evidence: [`Speed on phones: ${ok.length} of ${pages.length} pages measured${home?.score != null ? `; home page performance ${home.score}/100` : ""}` +
      (origin.lcpMs != null ? `; real users (75th percentile) LCP ${origin.lcpMs} ms, INP ${origin.inpMs ?? "n/a"} ms, CLS ${origin.cls ?? "n/a"}` : `; ${origin.note || "no real-user data"}`)] };
  };
}

/** What an agent sees of the speed report. */
export function speedForAgents(s) {
  if (!s) return null;
  return { generatedAt: s.generatedAt, device: "phone", realUsersSite: s.origin, pages: (s.pages || []).slice(0, 8),
    note: "Lab numbers are one test from Google's servers and vary run to run; field numbers are real Chrome users over 28 days (75th percentile) and exist only where Chrome has enough visits. Good: LCP up to 2500 ms, INP up to 200 ms, CLS up to 0.1." };
}
