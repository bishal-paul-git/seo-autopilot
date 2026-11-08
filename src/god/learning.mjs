// Learning from results (R1-D1). Pure: no I/O; the scheduler reads and writes the results as site memory.
//
// The hosted path has no daily Search Console series for most sites, so the measurable outcome is the audit itself:
// when the agency accepts advice, each recommendation is recorded with the problems found on that page at that moment.
// Later scans show whether those problems went away. Absence is only counted when the page was crawled again, so a
// page that was not re-read is "not rechecked", never "resolved". Lessons summarise outcomes per agent, plus the agency's
// own refusals, and feed back into planning and into the agents' input. Directional: an audit cannot show traffic impact.

const DAY = 864e5;
export const SETTLE_DAYS = 3;   // give people time to make the change before judging it
export const FINAL_DAYS = 30;   // after this, an unresolved item is closed as not implemented (or no effect)
export const REFUSALS_TO_PAUSE = 2, REFUSAL_WINDOW_DAYS = 30;

/** Comparable form of a page address: no scheme, no www, no trailing slash, lower-case host. */
export function normUrl(u) {
  try { const x = new URL(String(u)); return `${x.hostname.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "") || ""}${x.search}`; }
  catch { return String(u || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, ""); }
}
const rulesOn = (audit, url) => [...new Set((audit?.issues || []).filter((i) => normUrl(i.url) === url).map((i) => i.rule))].sort();
const severityOn = (audit, url) => (audit?.issues || []).filter((i) => normUrl(i.url) === url);

/**
 * When the agency accepts an advice result: one experiment per job, one item per recommendation with an address.
 * Returns null when nothing in it can be checked by an audit (no addresses).
 */
export function openExperiment(job, audit, now) {
  const recs = job.outputs?.proposal?.recommendations || [];
  const items = recs.filter((r) => r.url).slice(0, 8).map((r) => {
    const url = normUrl(r.url);
    return { url, title: String(r.title || "").slice(0, 200), baseline: rulesOn(audit, url), status: "open" };
  });
  if (!items.length) return null;
  return { job: job.id, agent: job.inputs?.agent || job.kind.replace(/^agent:/, ""), kind: job.kind, openedAt: now, baselineAuditAt: audit?.generatedAt || null, items, status: "open" };
}

/** Re-check an experiment against a newer audit. Returns the updated experiment (same object shape). */
export function evaluateExperiment(exp, audit, now) {
  if (!audit?.generatedAt || Date.parse(audit.generatedAt) - Date.parse(exp.openedAt) < SETTLE_DAYS * DAY) return exp; // too early
  const crawled = new Set((audit.crawled || []).map(normUrl));
  const items = exp.items.map((it) => {
    if (["resolved", "not_implemented"].includes(it.status)) return it;
    if (!crawled.has(it.url)) return { ...it, status: it.status === "open" ? "not_rechecked" : it.status, checkedAt: audit.generatedAt };
    const now_ = rulesOn(audit, it.url), left = it.baseline.filter((r) => now_.includes(r));
    const added = severityOn(audit, it.url).filter((i) => i.severity === "high" && !it.baseline.includes(i.rule));
    let status = !it.baseline.length ? "no_baseline" : !left.length ? "resolved" : left.length < it.baseline.length ? "partly" : "unchanged";
    if (added.length) status = "worse";
    return { ...it, status, remaining: left, newHigh: added.map((i) => i.rule), checkedAt: audit.generatedAt };
  });
  const old = Date.parse(audit.generatedAt) - Date.parse(exp.openedAt) >= FINAL_DAYS * DAY;
  const finalItems = old ? items.map((it) => (["unchanged", "partly"].includes(it.status) ? { ...it, status: it.status === "unchanged" ? "not_implemented" : it.status, final: true } : it)) : items;
  const done = finalItems.every((it) => ["resolved", "not_implemented", "worse", "no_baseline"].includes(it.status) || (old && it.status !== "open"));
  return { ...exp, items: finalItems, status: done ? "closed" : "open", lastCheckedAt: audit.generatedAt };
}

/**
 * Lessons per agent: how its accepted advice turned out, and how often the agency declined its work recently.
 * experiments: experiment values; jobs: the site's jobs (for refusals). Returns [{ key, value, confidence }].
 */
export function lessonsFrom(experiments, jobs = [], now) {
  const by = new Map();
  const get = (a) => by.get(a) || by.set(a, { agent: a, checked: 0, resolved: 0, partly: 0, unchanged: 0, worse: 0, notImplemented: 0, refusals: 0 }).get(a);
  for (const e of experiments) for (const it of e.items || []) {
    const s = get(e.agent);
    if (it.status === "resolved") { s.checked++; s.resolved++; }
    else if (it.status === "partly") { s.checked++; s.partly++; }
    else if (it.status === "unchanged") { s.checked++; s.unchanged++; }
    else if (it.status === "worse") { s.checked++; s.worse++; }
    else if (it.status === "not_implemented") { s.checked++; s.notImplemented++; }
  }
  const since = Date.parse(now) - REFUSAL_WINDOW_DAYS * DAY;
  for (const j of jobs) if (j.status === "rejected" && j.kind.startsWith("agent:") && Date.parse(j.updatedAt || j.createdAt || now) >= since) get(j.kind.slice(6)).refusals++;
  const out = [];
  for (const s of by.values()) {
    if (!s.checked && !s.refusals) continue;
    const parts = [];
    if (s.checked) parts.push(`${s.resolved} of ${s.checked} checked recommendations were fixed by later scans${s.partly ? `, ${s.partly} partly` : ""}${s.worse ? `, ${s.worse} got worse` : ""}${s.notImplemented ? `, ${s.notImplemented} not done after ${FINAL_DAYS} days` : ""}`);
    if (s.refusals) parts.push(`the agency declined its work ${s.refusals} time${s.refusals > 1 ? "s" : ""} in the last ${REFUSAL_WINDOW_DAYS} days`);
    out.push({ key: `agent:${s.agent}`, value: { ...s, text: `${s.agent}: ${parts.join("; ")}.` }, confidence: Math.min(0.9, Math.round((0.3 + 0.1 * (s.checked + s.refusals)) * 100) / 100) });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Apply lessons to the planner's jobs: work the agency declined repeatedly is paused (until the refusals age out);
 * advice that has never been fixed after several checks drops a priority step. Returns { keep, deferred, adjusted }.
 */
export function applyLessons(jobs, lessons) {
  const map = new Map(lessons.map((l) => [l.key, l.value]));
  const keep = [], deferred = [], adjusted = [];
  for (const j of jobs) {
    const l = map.get(j.kind);
    if (l && l.refusals >= REFUSALS_TO_PAUSE) { deferred.push({ kind: j.kind, reason: `paused: the agency declined this ${l.refusals} times in the last ${REFUSAL_WINDOW_DAYS} days` }); continue; }
    if (l && l.checked >= 3 && l.resolved + l.partly === 0) {
      const p = Math.min(5, (j.priority || 3) + 1);
      adjusted.push({ kind: j.kind, priority: p, reason: `lower priority: none of its last ${l.checked} checked recommendations were fixed` });
      keep.push({ ...j, priority: p, why: `${j.why || ""} (lower priority: earlier advice was not acted on)`.trim() });
      continue;
    }
    keep.push(j);
  }
  return { keep, deferred, adjusted };
}

/**
 * One learning pass for a site, from its memory and jobs: open experiments for advice the agency accepted, re-check
 * open ones against the latest audit, and recompute lessons. Returns the memory rows to write (only real changes are
 * stored by the memory functions, which keep history).
 */
export function learn({ memory, jobs, now }) {
  const audit = memory.find((m) => m.kind === "report" && m.key === "audit")?.value || null;
  const existing = new Map(memory.filter((m) => m.kind === "experiment").map((m) => [m.key, m.value]));
  const rows = [];
  for (const j of jobs) {
    if (j.status !== "completed" || !j.outputs?.proposal?.recommendations || existing.has(`exp:${j.id}`)) continue;
    const e = openExperiment(j, audit, j.updatedAt || now);
    if (e) { existing.set(`exp:${j.id}`, e); rows.push({ kind: "experiment", key: `exp:${j.id}`, value: e, basis: "verified", confidence: null, source: "learning" }); }
  }
  for (const [key, e] of existing) {
    if (e.status !== "open" || !audit) continue;
    const next = evaluateExperiment(e, audit, now);
    if (JSON.stringify(next) !== JSON.stringify(e)) { existing.set(key, next); const i = rows.findIndex((r) => r.key === key); const row = { kind: "experiment", key, value: next, basis: "verified", confidence: null, source: "learning" }; if (i >= 0) rows[i] = row; else rows.push(row); }
  }
  const lessons = lessonsFrom([...existing.values()], jobs, now);
  for (const l of lessons) rows.push({ kind: "lesson", key: l.key, value: l.value, basis: "inferred", confidence: l.confidence, source: "learning" });
  return { rows, lessons, experiments: [...existing.values()] };
}
