// Fast reaction (D57): compares the latest data with what came before and flags sudden problems, so the matching
// specialist can run the same day instead of waiting for its weekly turn. Pure: pass the reports in, get alerts back.
// Each alert says what changed, with the numbers or URLs behind it. Small-data guards keep quiet sites from raising
// alarms on noise: a click drop needs enough clicks the week before, and "new" problems need an earlier reading to
// compare with (the first scan or inspection of a page never raises an alert).
//
// Alert kinds and who gets them:
//   clicks_drop     site clicks down >= 30% week over week                      seo-serp-analyst
//   deindexed       an important page Google had indexed is now not indexed      seo-indexing-monitor
//   blocked         noindex or robots.txt blocking newly on an important page     seo-technical-fixer
//   server_errors   new 5xx (or no response) on an important page                seo-technical-fixer
//   page_errors     new 4xx on an important page                                 seo-redirect-guardian
import { weekOverWeek } from "./search-history.mjs";

export const ALERT_RULES = { clicksDrop: 0.3, minClicks: 50, minDays: 6, topPages: 20, cooldownDays: 7, batchHours: 36 };
export const ALERT_AGENTS = { clicks_drop: "seo-serp-analyst", deindexed: "seo-indexing-monitor", blocked: "seo-technical-fixer", server_errors: "seo-technical-fixer", page_errors: "seo-redirect-guardian" };

/** A comparable form of a URL: host without www, path without a trailing slash, no query or fragment. (No URL parser:
 *  this runs for every inspected page and finding inside a Worker's few milliseconds.) */
export function urlKey(u) {
  const m = /^[a-z]+:\/\/(?:www\.)?([^/?#]+)([^?#]*)/i.exec(String(u || ""));
  return m ? `${m[1].toLowerCase()}${m[2].replace(/\/+$/, "")}` : String(u || "");
}
const short = (u) => String(u || "").replace(/^https?:\/\/[^/]+/, "") || "/";

/**
 * The pages that matter most: the home page plus the top pages by clicks, then impressions, in the Search Console
 * snapshot, counting only pages with at least one click or 100 impressions in 28 days (a page nobody sees is not urgent).
 */
export function importantPages(siteUrl, searchConsole, n = ALERT_RULES.topPages) {
  const home = siteUrl ? new URL("/", siteUrl).toString() : null;
  const top = (searchConsole?.pages || []).filter((p) => (p.clicks || 0) >= 1 || (p.impressions || 0) >= 100).sort((a, b) => (b.clicks || 0) - (a.clicks || 0) || (b.impressions || 0) - (a.impressions || 0)).slice(0, n).map((p) => p.url);
  return new Map([home, ...top].filter(Boolean).map((u) => [urlKey(u), u]));
}

const INDEXED = /^(submitted and indexed|indexed, not submitted in sitemap)/i;
export const isIndexed = (r) => Boolean(r) && (r.verdict === "PASS" || INDEXED.test(r.coverage || ""));
const intentional = (r) => /redirect|alternate/i.test(r?.coverage || "");
const blockedBy = (r) => [r?.indexing === "BLOCKED_BY_META_TAG" && "noindex tag", r?.indexing === "BLOCKED_BY_HTTP_HEADER" && "noindex header", r?.robots === "DISALLOWED" && "robots.txt"].filter(Boolean);

/** Status code from a compact audit issue's detail ("HTTP 503", "HTTP no response"); null when unknown. */
const statusOf = (i) => { const m = /HTTP (\d{3}|no response)/.exec(i?.detail || ""); return m ? (m[1] === "no response" ? 0 : Number(m[1])) : null; };

/** The error and blocking findings of one compact audit, by URL key (shared shape for the current and previous scan). */
export function auditSignals(audit) {
  const errors = new Map(), blocked = new Map();
  for (const i of audit?.issues || []) {
    if (i.rule === "status-error") errors.set(urlKey(i.url), { url: i.url, status: statusOf(i) });
    if (i.rule === "noindex-in-sitemap") blocked.set(urlKey(i.url), { url: i.url, why: "noindex tag" });
    if (i.rule === "robots-blocked") blocked.set(urlKey(i.url), { url: i.url, why: "robots.txt" });
  }
  for (const e of audit?.signals?.errors || []) if (!errors.has(urlKey(e.url)) || errors.get(urlKey(e.url)).status == null) errors.set(urlKey(e.url), { url: e.url, status: e.status ?? null });
  for (const u of audit?.signals?.noindex || []) if (!blocked.has(urlKey(u))) blocked.set(urlKey(u), { url: u, why: "noindex tag" });
  const all = (audit?.issues || []).some((i) => i.rule === "robots-blocks-all");
  return { errors, blocked, all };
}

/**
 * Inputs: { siteUrl, history (report "history"), inspect (report "inspect"), audit (report "audit", with .previous when an
 * earlier scan existed), searchConsole (report "search_console"), now }. Returns [{ id, kind, agent, title, evidence, urls }].
 */
export function detectAlerts({ siteUrl = null, history = null, inspect = null, audit = null, searchConsole = null, now = new Date().toISOString() } = {}, o = ALERT_RULES) {
  const out = [];
  const add = (kind, id, title, evidence, urls = []) => out.push({ id: `${kind}:${id}`, kind, agent: ALERT_AGENTS[kind], title, evidence: evidence.slice(0, 8), urls: urls.slice(0, 10) });
  const important = importantPages(siteUrl, searchConsole, o.topPages);

  // 1. Clicks down sharply week over week, with enough clicks and enough days on both sides to mean something.
  const w = weekOverWeek(history);
  if (w && w.now.days >= o.minDays && w.prev.days >= o.minDays && w.prev.clicks >= o.minClicks && w.clicksChange != null && w.clicksChange <= -o.clicksDrop) {
    add("clicks_drop", "site", `Clicks fell ${Math.round(-w.clicksChange * 100)}% week over week`, [
      `Search Console clicks, 7 days to ${w.to}: ${w.now.clicks} vs ${w.prev.clicks} the 7 days before`,
      `impressions ${w.now.impressions} vs ${w.prev.impressions}${w.impressionsChange != null ? ` (${Math.round(w.impressionsChange * 100)}%)` : ""}`,
      `average position ${w.now.position ?? "n/a"} vs ${w.prev.position ?? "n/a"}`]);
  }

  // 2. Inspection: an important page Google had indexed at its previous inspection is now not indexed. Only a change in
  //    the latest batch counts (changedAt), so a page is reported once, when its state changes.
  if (inspect?.results) {
    const since = Date.parse(inspect.generatedAt || now) - o.batchHours * 3600e3;
    const lost = [], newlyBlocked = [];
    for (const [url, r] of Object.entries(inspect.results)) {
      if (!r?.prev || !(Date.parse(r.changedAt || r.checkedAt) >= since) || !important.has(urlKey(url))) continue;
      const why = blockedBy(r);
      if (why.length && !blockedBy(r.prev).length) { newlyBlocked.push([url, `${short(url)}: ${why.join(" and ")} (Google URL inspection, ${String(r.checkedAt).slice(0, 10)})`]); continue; }
      if (isIndexed(r.prev) && !isIndexed(r) && !intentional(r)) lost.push([url, r]);
    }
    if (lost.length) add("deindexed", lost.map(([u]) => urlKey(u)).sort().join(","), `${lost.length} important page${lost.length === 1 ? "" : "s"} dropped out of Google's index`,
      lost.map(([u, r]) => `${short(u)}: was "${r.prev.coverage || r.prev.verdict}" on ${String(r.prev.checkedAt || "").slice(0, 10)}, now "${r.coverage || r.verdict}" (Google URL inspection)`), lost.map(([u]) => u));
    if (newlyBlocked.length) add("blocked", newlyBlocked.map(([u]) => urlKey(u)).sort().join(","), `Google now sees a block on ${newlyBlocked.length} important page${newlyBlocked.length === 1 ? "" : "s"}`,
      newlyBlocked.map(([, e]) => e), newlyBlocked.map(([u]) => u));
  }

  // 3. The audit: new errors and new blocks on important pages since the previous scan. The first scan has nothing to
  //    compare with and raises nothing.
  if (audit?.previous) {
    const cur = auditSignals(audit), prev = auditSignals(audit.previous);
    const fresh = (m, p) => [...m].filter(([k]) => important.has(k) && !p.has(k)).map(([, v]) => v);
    const errs = fresh(cur.errors, prev.errors);
    // An unknown status (an older scan kept no detail) goes with the 4xx group: the redirect guardian owns status errors.
    const server = errs.filter((e) => e.status != null && (e.status >= 500 || e.status === 0)), client = errs.filter((e) => !server.includes(e));
    const scanned = `scan of ${String(audit.generatedAt || "").slice(0, 10)} vs ${String(audit.previous.generatedAt || "").slice(0, 10)}`;
    if (server.length) add("server_errors", server.map((e) => urlKey(e.url)).sort().join(","), `${server.length} important page${server.length === 1 ? "" : "s"} now fail${server.length === 1 ? "s" : ""} with a server error`,
      server.map((e) => `${short(e.url)}: HTTP ${e.status || "no response"} (${scanned})`), server.map((e) => e.url));
    if (client.length) add("page_errors", client.map((e) => urlKey(e.url)).sort().join(","), `${client.length} important page${client.length === 1 ? "" : "s"} now return${client.length === 1 ? "s" : ""} an error`,
      client.map((e) => `${short(e.url)}: ${e.status ? `HTTP ${e.status}` : "error status"} (${scanned})`), client.map((e) => e.url));
    const blocks = fresh(cur.blocked, prev.blocked);
    if (cur.all && !prev.all) blocks.unshift({ url: siteUrl || "/", why: "robots.txt blocks the whole site (Disallow: /)" });
    if (blocks.length) add("blocked", blocks.map((b) => urlKey(b.url)).sort().join(","), `Search engines are newly blocked from ${blocks.length} important page${blocks.length === 1 ? "" : "s"}`,
      blocks.map((b) => `${short(b.url)}: ${b.why} (${scanned})`), blocks.map((b) => b.url));
  }
  return out;
}

const OPEN = new Set(["proposed", "scoped", "queued", "running", "awaiting_review"]);
/**
 * The alerts not yet handled: an alert with the same id led to a job in the last cooldownDays days, or a run of the same
 * specialist is already about to happen (it reads the same data). jobs: [{ kind, status, inputs, createdAt }].
 */
export function unhandledAlerts(alerts, jobs, now, o = ALERT_RULES) {
  const t = Date.parse(now), recent = (j) => { const c = Date.parse(j.createdAt); return !Number.isFinite(c) || t - c < o.cooldownDays * 864e5; };
  return alerts.filter((a) => !jobs.some((j) => (recent(j) && (j.inputs?.alerts || []).includes(a.id)) || (j.kind === `agent:${a.agent}` && OPEN.has(j.status))));
}
