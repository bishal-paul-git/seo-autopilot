// Search Console beyond web search: sitemap health, performance in Discover, News, image and video results, search
// appearance (rich results), country and device splits, and the freshest (preliminary) days. Pure: pass the API answers in.
// Sitemap problems are what an indexing monitor acts on; the rest is context the strategist and reporter use.
export const TYPES = ["discover", "googleNews", "news", "image", "video"];
const LABEL = { web: "Web search", discover: "Google Discover", googleNews: "Google News app", news: "News tab", image: "Image search", video: "Video search" };
export const typeLabel = (t) => LABEL[t] || t;

const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
const sum = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0);

/** Findings from the Sitemaps API list, compared with the sitemap the config names. */
export function sitemapFindings(list = [], { configured = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const out = [];
  const norm = (u) => String(u || "").replace(/\/$/, "");
  if (!list.length) out.push({ id: "sitemap-none-submitted", severity: "high", title: "No sitemap is submitted in Search Console", detail: `Submit ${configured || "your sitemap"} in Search Console (Indexing > Sitemaps) so Google reads it regularly.`, pages: [] });
  else if (configured && !list.some((s) => norm(s.path) === norm(configured))) out.push({ id: "sitemap-not-submitted", severity: "medium", title: "The sitemap in the config is not submitted in Search Console", detail: `Config: ${configured}. Submitted: ${list.map((s) => s.path).join(", ")}.`, pages: [] });
  for (const s of list) {
    const errors = Number(s.errors || 0), warnings = Number(s.warnings || 0);
    if (errors) out.push({ id: "sitemap-errors", severity: "high", title: `${s.path} has ${errors} error(s) in Search Console`, detail: "Open it in Search Console (Indexing > Sitemaps) for the exact errors; a sitemap Google cannot read is ignored.", pages: [s.path] });
    if (warnings) out.push({ id: "sitemap-warnings", severity: "medium", title: `${s.path} has ${warnings} warning(s) in Search Console`, detail: "Warnings often mean blocked or redirected URLs in the sitemap. List only live, indexable, canonical URLs.", pages: [s.path] });
    if (s.lastDownloaded && days(s.lastDownloaded.slice(0, 10), today) > 30) out.push({ id: "sitemap-stale", severity: "medium", title: `Google last read ${s.path} ${days(s.lastDownloaded.slice(0, 10), today)} days ago`, detail: "Check that it answers 200 with XML and is listed in robots.txt; resubmit it if it changed.", pages: [s.path] });
    if (s.isPending) out.push({ id: "sitemap-pending", severity: "low", title: `${s.path} is still pending processing`, detail: "Google has not processed it yet. Recheck next week.", pages: [s.path] });
  }
  return out;
}

/** Totals per search type for this period and the previous one: [{ type, clicks, impressions, prevClicks, change }]. */
export function typeTotals(cur = {}, prev = {}) {
  return Object.keys(cur).map((type) => {
    const c = cur[type] || [], p = prev[type] || [];
    const clicks = sum(c, "clicks"), impressions = sum(c, "impressions"), prevClicks = sum(p, "clicks");
    return { type, label: typeLabel(type), clicks, impressions, prevClicks, change: pct(clicks, prevClicks) };
  }).filter((t) => t.impressions || t.prevClicks);
}

/** Findings from search types: a real drop in Discover or News traffic, the most volatile surfaces. */
export function typeFindings(totals = []) {
  return totals.filter((t) => t.type !== "web" && t.prevClicks >= 100 && t.change != null && t.change <= -30).map((t) => ({
    id: `drop-${t.type}`, severity: "medium", title: `${t.label} clicks fell ${-t.change}% on the previous 28 days`, detail: `${t.prevClicks} → ${t.clicks} clicks. ${t.type === "discover" ? "Discover swings a lot; check whether fewer pages were published, and whether large images and fresh topics are still there." : "Check which pages lost traffic in Search Console's performance report for this search type."}`, pages: [],
  }));
}

/** Shares by a dimension (country, device, searchAppearance): [{ key, clicks, impressions, ctr, position, share }]. */
export function shares(rows = [], limit = 10) {
  const total = sum(rows, "clicks") || 1;
  return rows.map((r) => ({ key: r.keys?.[0], clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.impressions ? Math.round((r.clicks / r.impressions) * 1000) / 10 : 0, position: r.position ? Math.round(r.position * 10) / 10 : null, share: Math.round(((r.clicks || 0) / total) * 100) }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, limit);
}

/** Device finding: mobile click-through far below desktop for similar positions usually means a weak mobile snippet or page. */
export function deviceFindings(devices = []) {
  const m = devices.find((d) => d.key === "MOBILE"), dk = devices.find((d) => d.key === "DESKTOP");
  if (!m || !dk || m.impressions < 1000 || dk.impressions < 1000 || !dk.ctr) return [];
  if (m.ctr < dk.ctr * 0.6 && Math.abs((m.position || 0) - (dk.position || 0)) < 3) return [{ id: "mobile-ctr-low", severity: "medium", title: `Mobile click-through (${m.ctr}%) is far below desktop (${dk.ctr}%) at similar positions`, detail: "Check how titles and descriptions are cut on mobile, page speed on mobile, and intrusive pop-ups.", pages: [] }];
  return [];
}

export function gscMarkdown({ siteName, r }) {
  const L = [`# Search Console beyond web search: ${siteName}`, "", `Period: ${r.period.from} to ${r.period.to}, compared with the 28 days before.`, ""];
  L.push("## Sitemaps", "", ...(r.sitemaps.length ? r.sitemaps.map((s) => `- ${s.path}: last read ${s.lastDownloaded?.slice(0, 10) || "never"}, ${s.errors || 0} error(s), ${s.warnings || 0} warning(s)${(s.contents || []).map((c) => `, ${c.submitted} ${c.type} URL(s) submitted`).join("")}`) : ["- none submitted"]), "");
  L.push("## Where clicks come from", "", "| Search type | Clicks | Impressions | Previous clicks | Change |", "|---|---|---|---|---|", ...r.types.map((t) => `| ${t.label} | ${t.clicks} | ${t.impressions} | ${t.prevClicks} | ${t.change == null ? "n/a" : `${t.change}%`} |`), "");
  if (r.appearance.length) L.push("## Search appearance (web)", "", ...r.appearance.map((a) => `- ${a.key}: ${a.clicks} clicks, ${a.impressions} impressions`), "");
  L.push("## Devices", "", ...r.devices.map((d) => `- ${d.key}: ${d.share}% of clicks, CTR ${d.ctr}%, average position ${d.position ?? "n/a"}`), "");
  L.push("## Top countries", "", ...r.countries.map((c) => `- ${c.key}: ${c.share}% of clicks (${c.clicks}), ${c.impressions} impressions`), "");
  if (r.fresh.length) L.push("## Latest days (preliminary, Google may still revise them)", "", ...r.fresh.map((d) => `- ${d.date}: ${d.clicks} clicks, ${d.impressions} impressions`), "");
  L.push("## Findings", "");
  if (!r.findings.length) L.push("Nothing to fix.");
  for (const f of r.findings) L.push(`### ${f.severity.toUpperCase()}: ${f.title}`, "", f.detail, "");
  return L.join("\n") + "\n";
}
