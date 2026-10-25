// Gathers everything the dashboards show for one site, from the saved state and the content adapter.
// Shared by the single-file dashboard (`run dashboard`) and the local management app (`seo-autopilot ui`).
import { readFileSync, existsSync, statSync } from "node:fs";
import { readJson, today } from "./util.mjs";
import { loadPages, pipeline } from "../adapters/index.mjs";
import { RULES } from "../audit/rules.mjs";
import { workView } from "./work-state.mjs";

const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");

/** Audit findings grouped by rule, each with the reason it matters and how to fix it. */
function auditView(audit) {
  if (!audit) return null;
  const groups = {};
  for (const i of audit.issues || []) (groups[i.rule] ||= []).push(i);
  const order = { high: 0, medium: 1, low: 2 };
  const rules = Object.entries(groups).map(([rule, list]) => ({
    rule, severity: RULES[rule]?.severity || "low", title: RULES[rule]?.title || rule, why: RULES[rule]?.why || "", fix: RULES[rule]?.fix || "",
    count: list.length, examples: list.slice(0, 4).map((x) => ({ url: x.url, detail: x.detail })),
  })).sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
  return { generatedAt: audit.generatedAt, summary: audit.summary, rules, opportunities: (audit.opportunities || []).slice(0, 20) };
}

export async function collectSiteData(site) {
  const s = site.paths.state;
  const targets = readJson(`${site.paths.backlinks}/targets.json`, []);
  const bstate = readJson(`${s}/backlinks-state.json`, { targets: {} }).targets;
  const backlinks = targets.map((t) => {
    const r = bstate[t.id] || {};
    return { target_id: t.id, name: t.name, submit_url: t.submitUrl, mode: t.mode, status: r.status || (t.mode === "auto" ? "pending" : t.mode), attempts: r.attempts || 0, note: (r.history?.at(-1)?.reason || t.notes || "").slice(0, 200) };
  });
  const inspectFile = `${s}/inspect-state.json`;
  const history = readJson(`${s}/history.json`, []);
  return {
    site: { id: site.id, name: site.name, url: site.url, property: site.searchConsoleProperty },
    generated: today(),
    dataMode: "saved snapshot",
    dataAsOf: history.at(-1)?.day || null,
    work: workView(site),
    lastSynced: existsSync(inspectFile) ? statSync(inspectFile).mtime.toISOString() : null,
    history,
    inspect: readJson(inspectFile, { results: {} }).results,
    backlog: readJson(`${s}/keyword-backlog.json`, {}),
    backlinks,
    digest: read(`${s}/weekly-digest.md`),
    news: read(`${s}/news-digest.md`),
    requestIndexing: read(`${s}/request-indexing.md`),
    pipeline: pipeline(await loadPages(site), today()),
    priorities: readJson(`${s}/priorities.json`, { items: [] }).items.slice(0, 30),
    audit: auditView(readJson(`${s}/audit.json`, null)),
    insights: readJson(`${s}/insights.json`, null),
    experiments: read(`${s}/experiments.md`),
    geo: readJson(`${s}/geo.json`, null),
    speed: readJson(`${s}/speed.json`, null),
  };
}
