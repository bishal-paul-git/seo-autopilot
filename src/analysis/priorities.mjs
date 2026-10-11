// The priority engine: turns audit findings, search insights and the content pipeline into ONE ranked to-do list.
// score = impact x confidence / effort. Every item keeps its evidence, so the ranking can be questioned.
// Impact is an estimate (clicks where the site's own data allows it, otherwise severity-based points); confidence says
// how much to trust that estimate. Nothing here predicts a ranking.

const EFFORT = { S: 1, M: 2, L: 4 };
const CONF = { high: 1, medium: 0.7, low: 0.4 };
const SEV_POINTS = { high: 40, medium: 18, low: 5 };

// Effort and a short action per audit rule.
const AUDIT_EFFORT = {
  "status-error": "S", "status-redirect": "S", "redirect-chain": "S", "noindex-in-sitemap": "S", "robots-blocked": "S",
  "canonical-missing": "M", "canonical-other": "M", "canonical-broken": "S", "title-missing": "S", "title-long": "S", "title-short": "S",
  "title-duplicate": "M", "desc-missing": "M", "desc-long": "S", "desc-short": "S", "desc-duplicate": "M", "h1-missing": "S", "h1-multiple": "S",
  "h1-duplicate": "M", "thin-content": "L", "jsonld-invalid": "S", "jsonld-article-incomplete": "S", "images-no-alt": "M", "viewport-missing": "S",
  "lang-missing": "S", "mixed-content": "S", "orphan": "S", "deep": "M", "broken-link": "S", "link-to-redirect": "S", "generic-anchor": "S",
  "duplicate-content": "M", "slow-ttfb": "L", "sitemap-not-in-robots": "S", "robots-blocks-all": "S",
};

export function buildPriorities({ audit, insights, rules, pipeline, indexing, speed } = {}) {
  const items = [];
  const add = (it) => items.push({ confidence: "medium", effort: "M", ...it, score: 0 });

  // 1. Audit findings, grouped by rule so one fix covers all pages.
  if (audit?.issues?.length && rules) {
    const grouped = {};
    for (const i of audit.issues) (grouped[i.rule] ||= []).push(i);
    for (const [rule, list] of Object.entries(grouped)) {
      const r = rules[rule];
      if (!r) continue;
      const reach = Math.min(1 + Math.log2(list.length), 4);
      add({
        id: `audit:${rule}`, type: "technical", title: `${r.title} (${list.length} page${list.length > 1 ? "s" : ""})`,
        impact: SEV_POINTS[r.severity] * reach, impactUnit: "points", confidence: r.severity === "high" ? "high" : "medium", effort: AUDIT_EFFORT[rule] || "M",
        why: r.why, how: r.fix, evidence: list.slice(0, 5).map((x) => `${x.url}${x.detail ? ` (${x.detail})` : ""}`),
      });
    }
  }

  // 2. Search opportunities, valued in estimated clicks when the site's curve allows.
  const click = (n) => Math.max(1, n) * 6; // 1 estimated extra click ~ 6 points, so the two scales mix sensibly
  for (const s of insights?.strikingDistance?.slice(0, 15) || []) {
    const est = s.estimatedExtraClicks;
    add({
      id: `strike:${s.query}`, type: "content", title: `Push "${s.query}" from position ${s.position}`,
      impact: est != null ? click(est) : Math.min(30, s.impressions / 5), impactUnit: est != null ? "est. clicks" : "points",
      confidence: est != null ? "medium" : "low", effort: "M",
      why: "It already ranks and shows impressions, so a stronger page can move it up faster than a new page can rank from nothing.",
      how: `Strengthen ${s.page}: answer the query in the first paragraph, add the missing sub-topics, improve the title, and link to it from related pages.`,
      evidence: [`${s.impressions} impressions at position ${s.position}`, est != null ? `about +${est} clicks if it reached position 3 (estimate from this site's own click-through curve)` : "no click estimate: not enough data for a curve yet"],
    });
  }
  for (const u of insights?.ctrUnderperformers?.slice(0, 10) || []) {
    add({
      id: `ctr:${u.page}`, type: "snippet", title: `Rewrite the title and description of ${u.page.replace(/^https?:\/\/[^/]+/, "")}`,
      impact: click(u.estimatedLostClicks), impactUnit: "est. clicks", confidence: "medium", effort: "S",
      why: "It ranks where pages on this site normally get far more clicks, so the snippet is probably not earning the click.",
      how: "Lead with the searcher's words, state the benefit or the answer, and stay near 60 characters in the title. Log it as an experiment and compare 14 days before and after.",
      evidence: [`position ${u.position}, CTR ${(u.ctr * 100).toFixed(1)}% vs about ${(u.expectedCtr * 100).toFixed(1)}% expected, ~${u.estimatedLostClicks} clicks missed`],
    });
  }
  for (const c of insights?.cannibalization?.slice(0, 8) || []) {
    add({
      id: `cannibal:${c.query}`, type: "structure", title: `Resolve competition for "${c.query}"`,
      impact: Math.min(60, c.impressions / 4), impactUnit: "points", confidence: "medium", effort: "M",
      why: "Two of your pages split the impressions for one query, so neither ranks as well as one strong page would.",
      how: "Choose the page that should own it. Merge or redirect the other (or differentiate its topic), then point internal links at the winner.",
      evidence: c.pages.map((p) => `${p.page} position ${p.position}, ${p.impressions} impressions`),
    });
  }
  for (const d of insights?.decay?.slice(0, 8) || []) {
    add({
      id: `decay:${d.page}`, type: "refresh", title: `Refresh ${d.page.replace(/^https?:\/\/[^/]+/, "")} (visibility fell ${Math.abs(Math.round(d.change * 100))}%)`,
      impact: Math.min(50, d.impressionsBefore / 4), impactUnit: "points", confidence: "low", effort: "M",
      why: "Impressions dropped sharply against the previous period. That can be seasonality, a competitor, or content going stale.",
      how: "Check the live results for the page's main queries, update anything outdated, and strengthen the answer. Do not rewrite blindly.",
      evidence: [`impressions ${d.impressionsBefore} to ${d.impressionsNow}, clicks ${d.clicksBefore} to ${d.clicksNow}`],
    });
  }
  for (const g of insights?.contentGaps?.slice(0, 8) || []) {
    add({
      id: `gap:${g.topic}`, type: "content", title: `Write a page for "${g.topic}"`,
      impact: Math.min(60, g.impressions / 3), impactUnit: "points", confidence: "medium", effort: "L",
      why: "People already see you for these searches but no page is built around the topic.",
      how: `One focused page that satisfies the search intent, linked from your hubs. Queries: ${g.topQueries.slice(0, 4).join("; ")}.`,
      evidence: [`${g.impressions} impressions across ${g.queries} queries`],
    });
  }

  // 2b. Core Web Vitals: only pages rated poor on real-user or lab data.
  const slow = (speed?.results || []).filter((r) => !r.error && ((r.field.lcp ?? 0) > 4000 || (r.field.inp ?? 0) > 500 || (r.field.cls ?? 0) > 0.25 || r.lab.score < 50));
  if (slow.length) add({
    id: "speed:poor", type: "speed", title: `${slow.length} page(s) rate poor on speed`,
    impact: Math.min(60, slow.length * 12), impactUnit: "points", confidence: slow.some((r) => r.field.lcp != null) ? "medium" : "low", effort: "M",
    why: "Core Web Vitals are a ranking signal and slow pages lose visitors before they read anything. The effect on rankings is usually modest, so treat this as a tie-breaker, not a first fix.",
    how: "Start with each page's top fix in the speed report (usually image size, render-blocking scripts or unused JavaScript).", evidence: slow.slice(0, 5).map((r) => `${r.url} (score ${r.lab.score})`),
  });

  // 3. Indexing and pipeline.
  if (indexing?.length) add({
    id: "indexing:request", type: "indexing", title: `Request indexing for ${Math.min(indexing.length, 10)} pages today`,
    impact: Math.min(50, indexing.length * 4), impactUnit: "points", confidence: "medium", effort: "S",
    why: "Google cannot rank pages it has not indexed, and requests are the only way to nudge it (about ten a day).",
    how: "Open the request-indexing list and press Request indexing for each page.", evidence: indexing.slice(0, 5),
  });
  if (pipeline?.tracked && pipeline.upcoming < 7) add({
    id: "pipeline:low", type: "pipeline", title: `Only ${pipeline.upcoming} page(s) scheduled: approve more topics`,
    impact: 25, impactUnit: "points", confidence: "medium", effort: "S",
    why: "A steady release schedule needs a queue behind it.", how: "Review the open topic proposals and approve the ones you want drafted.", evidence: [`${pipeline.queued} approved but undated, ${pipeline.upcoming} scheduled`],
  });

  for (const it of items) it.score = Number(((it.impact * CONF[it.confidence]) / EFFORT[it.effort]).toFixed(1));
  items.sort((a, b) => b.score - a.score);
  return items.map((it, i) => ({ rank: i + 1, ...it }));
}
