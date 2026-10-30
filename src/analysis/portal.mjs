// The client portal snapshot: one JSON document per site, built from the reports the other jobs already wrote, that the
// hosted portal (cloud/portal) shows to the agency and to the client. Pure: the job reads the files and passes them in.
// Plain numbers only, each traceable to a report; nothing here estimates or invents. Missing reports give empty sections.

export const SNAPSHOT_VERSION = 1;
// Page score: 100, minus audit issues by severity, minus 20 when Google reports the page as not indexed,
// 10 when the page is thin (under 300 words) and 5 when it has no meta description. A simple, explainable checklist.
const SEV = { high: 25, medium: 10, low: 3 };
export const DEFAULT_LOCATION_PATTERN = "^/(?:areas|locations|service-areas|areas-we-cover|areas-we-serve)/([^/]+)(?:/([^/]+))?/?$";

const round = (n, d = 1) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const pathOf = (u = "") => { const rest = String(u).split("//").slice(1).join("//") || String(u); const i = rest.indexOf("/"); return i < 0 ? "/" : rest.slice(i) || "/"; };
const titleCase = (s = "") => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const isIndexed = (coverage) => /^submitted and indexed$|^indexed, not submitted in sitemap$/i.test(coverage || "");

/** Query totals for a list of Search Console rows ({ query, page, clicks, impressions, position }). */
function byQuery(rows = []) {
  const a = new Map();
  for (const r of rows) {
    const x = a.get(r.query) || { i: 0, c: 0, pw: 0, pages: new Map() };
    x.i += r.impressions || 0; x.c += r.clicks || 0; x.pw += (r.position || 0) * (r.impressions || 0);
    x.pages.set(r.page || "", (x.pages.get(r.page || "") || 0) + (r.impressions || 0));
    a.set(r.query, x);
  }
  return a;
}
function totals(a) {
  let i = 0, c = 0, pw = 0;
  for (const v of a.values()) { i += v.i; c += v.c; pw += v.pw; }
  return { impressions: i, clicks: c, ctr: i ? round((c / i) * 100, 2) : 0, position: i ? round(pw / i) : null, queries: a.size };
}

/** Keywords people searched (top `limit` by impressions), with position now and in the window before. */
export function keywordRows(gscRows = {}, limit = 80) {
  const cur = byQuery(gscRows.rows), prev = byQuery(gscRows.prevRows);
  const kw = [...cur].map(([q, v]) => {
    const p = prev.get(q), top = [...v.pages].sort((x, y) => y[1] - x[1])[0]?.[0] || "";
    return { q, i: v.i, c: v.c, pos: v.i ? round(v.pw / v.i) : null, prevPos: p?.i ? round(p.pw / p.i) : null, page: top ? pathOf(top) : "" };
  }).sort((x, y) => y.i - x.i || x.q.localeCompare(y.q));
  return { period: { cur: totals(cur), prev: totals(prev), window: gscRows.window || null, prevWindow: gscRows.prevWindow || null }, keywords: kw.slice(0, limit) };
}

/** Every crawled page with its score, index state, issues and search totals. */
export function pageRows({ audit = {}, inspect = {}, pageDaily = {} } = {}) {
  const issues = new Map();
  for (const it of audit.issues || []) issues.set(it.url, [...(issues.get(it.url) || []), it]);
  return (audit.pages || []).filter((p) => p.status === 200).map((p) => {
    const iss = issues.get(p.url) || [], cov = inspect[p.url]?.coverage ?? null;
    const score = 100 - iss.reduce((s, i) => s + (SEV[i.severity] || 0), 0) - (cov == null || isIndexed(cov) ? 0 : 20) - ((p.words || 0) < 300 ? 10 : 0) - (p.description ? 0 : 5);
    let i = 0, c = 0;
    for (const v of Object.values(pageDaily[p.url] || {})) { c += v[0] || 0; i += v[1] || 0; }
    return { path: pathOf(p.url), title: p.title || null, words: p.words ?? null, score: Math.max(0, Math.min(100, score)), indexed: cov, issues: iss.map((x) => x.rule), i, c, types: p.types || [], ttfb: p.ttfb ?? null };
  }).sort((a, b) => b.i - a.i || a.path.localeCompare(b.path));
}

/** Location pages grouped by area (first path segment after the locations folder) with towns under each. */
export function locationRows(pages = [], pattern = DEFAULT_LOCATION_PATTERN) {
  let re;
  try { re = new RegExp(pattern); } catch { return []; }
  const areas = new Map();
  for (const p of pages) {
    const m = re.exec(p.path);
    if (!m) continue;
    const area = titleCase(m[1]), town = m[2] ? titleCase(m[2]) : "";
    const a = areas.get(area) || { area, towns: [], i: 0, indexed: 0, pages: 0 };
    a.i += p.i; a.pages += 1; a.indexed += isIndexed(p.indexed) ? 1 : 0;
    if (town) a.towns.push({ name: town, indexed: isIndexed(p.indexed), i: p.i, score: p.score });
    areas.set(area, a);
  }
  return [...areas.values()].sort((a, b) => b.pages - a.pages || a.area.localeCompare(b.area));
}

function coverageRows(inspect = {}) {
  const counts = new Map();
  for (const v of Object.values(inspect)) counts.set(v.coverage || "Unknown", (counts.get(v.coverage || "Unknown") || 0) + 1);
  const coverage = [...counts].sort((a, b) => b[1] - a[1]);
  const notIndexed = Object.entries(inspect).filter(([, v]) => !isIndexed(v.coverage)).map(([u, v]) => ({ url: pathOf(u), state: v.coverage || "Unknown" })).slice(0, 40);
  return { coverage, notIndexed };
}

/** Agent run log lines (agent-runs.jsonl) reduced to what a person reads: who ran, when, on what, at what cost. */
export function runRows(lines = []) {
  return lines.map((r) => ({ at: r.at, agent: r.agent, task: String(r.task || "").slice(0, 160), turns: r.turns ?? null, cost: r.costUsd ?? null, error: r.error || null, tools: (r.toolCalls || []).length }));
}

/**
 * The whole snapshot. `reports` holds the parsed state files by name (missing ones undefined); `site` is the configured
 * site; `ga4` is the optional traffic summary from GA4 (null when not connected).
 */
export function buildSnapshot({ site = {}, reports = {}, ga4 = null, now = new Date().toISOString(), options = {} }) {
  const r = reports;
  const { period, keywords } = keywordRows(r.gscRows || {}, options.keywords || 80);
  const pages = pageRows({ audit: r.audit || {}, inspect: r.inspect?.results || {}, pageDaily: r.pageDaily || {} });
  const { coverage, notIndexed } = coverageRows(r.inspect?.results || {});
  const runs = runRows(r.runs || []);
  const plan = (r.plan?.steps || []).map((s) => ({ agent: s.agent, phase: s.phase, rank: s.rank, why: s.why, evidence: (s.evidence || []).slice(0, 6) }));
  const speedQuota = (r.speed?.results || []).some((x) => /quota/i.test(x.error || ""));
  const integrations = [
    { name: "Google Search Console", ok: !!r.gscRows, note: r.gscRows ? "Daily reports and URL inspection" : "Not connected yet: add the service account to the Search Console property" },
    { name: "Google Analytics 4", ok: !!ga4 && !ga4.error, note: ga4 ? (ga4.error || "Visits and where they come from") : "Not connected: set ga4PropertyId and give the service account Viewer access" },
    { name: "AI agents", ok: runs.length > 0 || plan.length > 0, note: runs.length || plan.length ? "Agents plan, research and draft; a person approves risky changes" : "No agent run yet" },
    { name: "PageSpeed", ok: !!r.speed && !speedQuota, note: speedQuota ? "Shared quota used up; add PAGESPEED_API_KEY" : r.speed ? "Speed checks run" : "Not run yet" },
  ];
  const proposals = (Array.isArray(r.proposals) ? r.proposals : []).slice(0, 12).map((x) => ({ title: x.title, query: x.primaryQuery || x.query || null, why: String(x.why || "").slice(0, 400), type: x.type || x.kind || null }));
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: now,
    site: { id: site.id, name: site.name, url: site.url, platform: r.profile?.platform?.name || null, hosting: r.profile?.hosting || null, market: options.market || null, schedule: options.schedule || null },
    period, keywords,
    history: (r.history || []).slice(-120),
    audit: r.audit ? { pages: r.audit.summary?.pagesCrawled ?? (r.audit.pages || []).length, bySeverity: r.audit.summary?.bySeverity || null, byRule: r.audit.summary?.byRule || null, at: r.audit.generatedAt || null } : null,
    priorities: (r.priorities?.items || []).slice(0, 8).map((i) => ({ rank: i.rank, title: i.title, why: i.why, impact: i.impact ?? null, effort: i.effort ?? null, confidence: i.confidence ?? null, type: i.type ?? null, evidence: i.evidence ?? null })),
    plan, planAt: r.plan?.generatedAt || null,
    runs: runs.slice(-30),
    drafts: proposals.slice(0, 8).map((p) => ({ title: p.title, query: p.query })),
    proposals,
    candidates: (r.candidates?.candidates || []).length,
    window: r.insights?.window || null, sample: r.insights?.sample || null,
    rank: r.rank ? { summary: r.rank.summary || null, rows: (r.rank.rows || []).slice(0, 20).map((x) => ({ query: x.query, position: x.position, previous: x.previous, change: x.change, intent: x.intent })) } : null,
    coverage, notIndexed,
    targets: Object.entries(r.backlog || {}).map(([k, v]) => ({ q: v.query || k, status: v.status || null, i: v.impressions ?? null, pos: v.position ?? null, covered: v.covered ?? null, kinds: v.kinds || [] })).sort((a, b) => (b.i || 0) - (a.i || 0)).slice(0, 40),
    pages,
    locations: locationRows(pages, options.locationPattern || DEFAULT_LOCATION_PATTERN),
    search: r.gsc ? { period: r.gsc.period || null, countries: r.gsc.countries || [], devices: r.gsc.devices || [], types: r.gsc.types || [] } : null,
    ga4,
    integrations,
    digest: String(r.digest || "").slice(0, 6000),
  };
}

/** GA4 runReport rows by one dimension, current and previous window, into [{ key, sessions, prev, users }]. */
export function ga4Breakdown(cur = [], prev = [], limit = 10) {
  const p = new Map(prev.map((x) => [x.key, x.sessions]));
  return cur.map((x) => ({ ...x, prev: p.get(x.key) ?? 0 })).sort((a, b) => b.sessions - a.sessions).slice(0, limit);
}
