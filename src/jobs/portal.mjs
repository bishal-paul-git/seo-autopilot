// Client portal snapshot: gathers the latest reports into portal.json, the one document the hosted portal (cloud/portal)
// shows the agency and the client: search totals, keywords, pages with scores, locations, index state, agents' work and,
// when GA4 is connected, visits and where they come from. With --push it sends the snapshot to the portal.
//   npx seo-autopilot run portal [--push]
// With a GitHub token it also lists the open proposal issues, and applies the decisions people made on them in the portal
// (approve: label, comment and start drafting; hold: seo-hold; decline: comment and close), then tells the portal.
// --push needs SEO_PORTAL_URL (the portal's ingest address) and SEO_PORTAL_TOKEN (the site's token, from "Connect a
// website" in the portal). The token only lets this site add snapshots; it is never logged or put in an error.
import { readFileSync, existsSync } from "node:fs";
import { readJson, writeJson } from "../core/util.mjs";
import { buildSnapshot, ga4Breakdown, issueRows, decisionActions } from "../analysis/portal.mjs";
import { ghAvailable, openIssues, applyAction, api } from "../lib/gh.mjs";
import { traffic } from "../lib/ga4.mjs";
import { getToken, SCOPES } from "../lib/google-auth.mjs";

export const description = "Client portal snapshot (portal.json) from the latest reports; --push sends it to the hosted portal";

const lines = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
const text = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");

/** Every report the snapshot uses, by name. Absent files stay undefined. */
export function readReports(dir) {
  const j = (f) => { try { return readJson(`${dir}/${f}`, undefined); } catch { return undefined; } }; // a half-written file counts as missing
  return {
    gscRows: j("gsc-rows.json"), audit: j("audit.json"), inspect: j("inspect-state.json"), pageDaily: j("page-daily.json"),
    history: j("history.json"), priorities: j("priorities.json"), plan: j("agent-plan.json"), proposals: j("agent-proposals.json"),
    candidates: j("proposals.json"), insights: j("insights.json"), rank: j("rank.json"), backlog: j("keyword-backlog.json"),
    speed: j("speed.json"), profile: j("site-profile.json"), gsc: j("gsc.json"),
    runs: lines(`${dir}/agent-runs.jsonl`), digest: text(`${dir}/weekly-digest.md`),
  };
}

/** GA4 visits for the snapshot, or null when not connected; a failure becomes { error } so the portal can say why. */
async function ga4For(site, deps) {
  if (!site.ga4PropertyId) return null;
  try {
    const token = deps.ga4Token || (await getToken([SCOPES.analytics])).token;
    const t = await traffic(site.ga4PropertyId, token, { fetchFn: deps.fetch || globalThis.fetch });
    const sum = (rows) => rows.reduce((s, x) => s + x.sessions, 0);
    return {
      days: t.days,
      sessions: sum(t.total.cur), prevSessions: sum(t.total.prev), users: t.total.cur.reduce((s, x) => s + x.users, 0),
      channels: ga4Breakdown(t.channels.cur, t.channels.prev, 8), sources: ga4Breakdown(t.sources.cur, t.sources.prev, 10),
      countries: ga4Breakdown(t.countries.cur, t.countries.prev, 10), devices: ga4Breakdown(t.devices.cur, t.devices.prev, 4),
    };
  } catch (e) { return { error: e.message }; }
}

/** POST the snapshot to the portal. Errors carry the status and the portal's message, never the token. */
export async function push(snapshot, { env = process.env, fetch: f = globalThis.fetch, applied } = {}) {
  const url = env.SEO_PORTAL_URL, token = env.SEO_PORTAL_TOKEN;
  if (!url || !token) throw new Error("portal: set SEO_PORTAL_URL and SEO_PORTAL_TOKEN (from \"Connect a website\" in the portal) to push.");
  if (!/^https:\/\//.test(url)) throw new Error("portal: SEO_PORTAL_URL must start with https://");
  let r;
  try { r = await f(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...(snapshot ? { snapshot } : {}), ...(applied ? { applied } : {}) }), signal: AbortSignal.timeout(60000) }); }
  catch (e) { throw new Error(`portal: push failed (${e.name || "network error"})`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`portal: HTTP ${r.status}${j.error ? `: ${String(j.error).replaceAll(token, "***").slice(0, 200)}` : ""}${r.status === 401 ? " (the token is wrong or was revoked; make a new one in the portal)" : ""}`);
  return j;
}

/** Apply the portal's decisions on GitHub; returns the ids of the decisions fully applied. */
export async function applyDecisions(decisions, issues, { site, env = process.env, gh = api } = {}) {
  const open = new Map(issues.map((i) => [i.number, i])), applied = [];
  const ref = env.GITHUB_REF_NAME || "main";
  for (const d of decisions || []) {
    const issue = open.get(d.issue);
    // Closed or unknown issue: nothing to do, but acknowledge so the portal stops waiting.
    if (!issue) { applied.push(d.id); continue; }
    const kinds = new Set(["seo-proposal", "seo-topic", "seo-work-order", site.labels?.proposal, site.labels?.topic].filter(Boolean));
    if (d.decision === "approve" && !issue.labels.some((l) => kinds.has(l))) { console.log(`portal: issue #${d.issue} is not a proposal; left for a person.`); continue; }
    let ok = true;
    for (const a of decisionActions(d, issue, { approvedLabel: site.labels?.approved || "approved", ref })) ok = (await applyAction(a, { f: gh })) && ok;
    if (ok) applied.push(d.id);
    console.log(`portal: ${d.decision} #${d.issue}${ok ? "" : " (GitHub refused part of it; will retry next run)"}.`);
  }
  return applied;
}

/** `deps`: fetch, env, ga4Token, now, gh (GitHub API stand-in). For tests. */
export async function run({ site, flags = {} }, deps = {}) {
  const s = site.paths.state, env = deps.env || process.env, gh = deps.gh || (ghAvailable() ? api : null);
  const L = site.labels || {};
  const rawIssues = gh ? await openIssues([L.proposal || "seo-proposal", L.topic || "seo-topic", "seo-work-order"], { f: gh }).catch(() => []) : [];
  const issues = issueRows(rawIssues, L);
  const snapshot = buildSnapshot({ site, reports: readReports(s), ga4: await ga4For(site, deps), issues, now: deps.now, options: site.portal || {} });
  writeJson(`${s}/portal.json`, snapshot);
  const size = Buffer.byteLength(JSON.stringify(snapshot));
  console.log(`portal: ${site.id}: ${snapshot.keywords.length} keyword(s), ${snapshot.pages.length} page(s), ${snapshot.locations.length} location area(s), ${issues.length} open proposal(s)${snapshot.ga4 ? (snapshot.ga4.error ? "; GA4 unavailable" : "; GA4 included") : ""}; ${Math.round(size / 1024)} KB.`);
  if (!flags.push) return;
  const j = await push(snapshot, { env, fetch: deps.fetch });
  console.log(`portal: pushed${j.at ? ` at ${j.at}` : ""}; ${(j.decisions || []).length} decision(s) waiting.`);
  if (!(j.decisions || []).length) return;
  if (!gh) { console.log("portal: GITHUB_TOKEN / GITHUB_REPOSITORY not set; decisions stay waiting."); return; }
  const applied = await applyDecisions(j.decisions, issues, { site, env, gh });
  if (applied.length) await push(null, { env, fetch: deps.fetch, applied });
}
