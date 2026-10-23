// Tells you which agents to run next and in what order, from the audit, priorities, indexing, speed and AI search reports.
// Writes <state>/<site>/agent-plan.json, agent-plan.md and work-orders.json (who owns each piece of work, what must finish
// first, which pages it locks and which checks it must pass; see src/analysis/work-orders.mjs). Run `profile` first.
import { readJson, writeJson, writeText, today } from "../core/util.mjs";
import { routeAgents, planMarkdown } from "../analysis/agent-router.mjs";
import { loadPages, pipeline } from "../adapters/index.mjs";
import { ghAvailable, ensureLabel, existingTitles, openIssue } from "../lib/gh.mjs";
import { agentFacts } from "../core/agents.mjs";
import { buildWorkOrders, validateOrders, waves, ordersMarkdown, workOrderIssues } from "../analysis/work-orders.mjs";
import { resolvePolicy } from "../analysis/autonomy.mjs";

export const description = "Decide which of the agents to run next, in order, with a ready-to-paste instruction for each";

export async function run({ site, flags = {} }) {
  const s = site.paths.state;
  const profile = readJson(`${s}/site-profile.json`, null);
  let pipe = null;
  try { pipe = pipeline(await loadPages(site), today()); } catch { /* content adapter unavailable: skip the pipeline */ }
  const ymyl = readJson(`${s}/ymyl.json`, null);
  const plan = routeAgents({
    profile,
    audit: readJson(`${s}/audit.json`, null),
    priorities: readJson(`${s}/priorities.json`, null),
    inspect: readJson(`${s}/inspect-state.json`, { results: {} }).results,
    speed: readJson(`${s}/speed.json`, null),
    geo: readJson(`${s}/geo.json`, null),
    consent: readJson(`${s}/consent.json`, null),
    ymyl,
    pace: readJson(`${s}/pace.json`, null),
    citations: readJson(`${s}/citations.json`, null),
    quality: readJson(`${s}/quality.json`, null),
    facts: readJson(`${s}/facts.json`, null),
    links: readJson(`${s}/links.json`, null),
    render: readJson(`${s}/render.json`, null),
    inbound: readJson(`${s}/inbound.json`, null),
    logs: readJson(`${s}/logs.json`, null),
    rank: readJson(`${s}/rank.json`, null),
    keywords: readJson(`${s}/keywords.json`, null),
    gap: readJson(`${s}/gap.json`, null),
    aiVisibility: readJson(`${s}/ai-visibility.json`, null),
    authority: readJson(`${s}/authority.json`, null),
    forecast: readJson(`${s}/forecast.json`, null),
    linkgraph: readJson(`${s}/linkgraph.json`, null),
    vitals: readJson(`${s}/vitals.json`, null),
    changes: readJson(`${s}/changes.json`, null),
    schema: readJson(`${s}/schema.json`, null),
    entity: readJson(`${s}/entity.json`, null),
    local: readJson(`${s}/local.json`, null),
    redirects: { check: readJson(`${s}/redirects-check.json`, null), smoke: readJson(`${s}/redirects-smoke.json`, null) },
    pipeline: pipe,
    site,
    today: today(),
  });
  writeJson(`${s}/agent-plan.json`, plan);
  const facts = agentFacts();
  const sensitivePaths = (ymyl?.pages || []).filter((p) => p.status === "needs reviewer" && p.url).map((p) => String(p.url).replace(/^https?:\/\/[^/]+/, "") || "/");
  const orders = buildWorkOrders(plan, facts, { sensitivePaths });
  const problems = validateOrders(orders, new Set(Object.keys(facts)));
  if (problems.length) throw new Error(`work orders are inconsistent (a bug, please report it): ${problems.join("; ")}`);
  writeJson(`${s}/work-orders.json`, { generatedAt: plan.generatedAt, date: plan.date, waves: waves(orders), orders });
  const md = planMarkdown(plan, site.name) + "\n" + ordersMarkdown(orders);
  writeText(`${s}/agent-plan.md`, md);
  console.log(md);

  if (!ghAvailable() || flags.dry || !plan.steps.length) return;
  // With the autopilot on (repository variable SEO_AUTOPILOT=true), routine content orders become issues the
  // seo-autopilot workflow drafts, checks and merges under the same policy and limits. Never in advise mode.
  if (process.env.SEO_AUTOPILOT === "true" && plan.mode !== "advise") {
    const issues = workOrderIssues(orders, resolvePolicy({ ...(site.autopilot || {}), paused: site.autopilot?.paused || process.env.SEO_AUTOPILOT_PAUSED === "true" }));
    if (issues.length) {
      for (const l of ["seo-work-order", ...new Set(issues.flatMap((i) => i.labels.slice(1)))]) await ensureLabel(l, "0E8A16", l === "seo-work-order" ? "Work order the autopilot may draft" : "");
      const seen = await existingTitles("seo-work-order");
      for (const i of issues) if (!seen.has(i.title)) await openIssue(i.title, i.body, i.labels);
    }
  }
  const L = site.labels.agentPlan || "seo-agent-plan";
  await ensureLabel(L, "8B5CF6", "Which SEO agents to run this week");
  const title = `Agent plan, week of ${today()}`;
  if ((await existingTitles(L)).has(title)) return;
  await openIssue(title, `${plan.mode === "advise" ? "This site is in **advise mode**: agents recommend, a person makes the changes.\n\n" : ""}${plan.steps.slice(0, 8).map((x) => `${x.order}. **${x.agent}**: ${x.why}\n   - ${x.prompt}`).join("\n\n")}\n\nFull plan with evidence: the \`agent-plan.md\` report. Run each agent in Claude Code; a human approves what goes live.`, [L]);
}
