// Decides which agents to run next, in what order, and with what instruction, from the reports the jobs already produce.
// Deterministic and explainable: every recommendation says which finding caused it. Pure: pass the data in, get a plan back.
// Order of work: know the site, fix what blocks crawling and indexing, fix the page-level and content issues, then grow and report.

import { detectVerticals, PACKS } from "./verticals.mjs";

const RULE_GROUPS = {
  "redirect-guardian": ["status-error", "status-redirect", "redirect-chain", "link-to-redirect", "broken-link"],
  "technical-fixer": ["robots-blocked", "noindex-in-sitemap", "canonical-missing", "canonical-other", "canonical-broken", "robots-blocks-all", "sitemap-not-in-robots", "viewport-missing", "lang-missing", "mixed-content", "h1-missing", "h1-multiple", "title-missing", "desc-missing"],
  "schema-engineer": ["schema-required-missing", "jsonld-invalid", "jsonld-article-incomplete", "og-missing"],
  "international": ["hreflang-invalid", "hreflang-no-self", "hreflang-not-reciprocal"],
  "media-optimizer": ["images-no-alt"],
  "content-pruner": ["thin-content", "duplicate-content"],
  "internal-linker": ["orphan", "deep", "generic-anchor"],
  "performance-fixer": ["slow-ttfb"],
  // Titles, descriptions and the heading outline have one owner; refreshing a page that lost visibility is a different job.
  "snippet-optimizer": ["title-long", "title-short", "title-duplicate", "desc-long", "desc-short", "desc-duplicate", "h1-long", "heading-skip", "h2-generic", "h2-repeated", "few-subheadings"],
};

const PHASES = { onboard: 0, block: 1, fix: 2, content: 3, grow: 4, report: 5 };
// Findings about the whole site (robots.txt, sitemap discovery): their single URL stands for every page.
const SITE_WIDE_RULES = new Set(["robots-blocks-all", "sitemap-not-in-robots"]);
const short = (u) => String(u || "").replace(/^https?:\/\/[^/]+/, "") || "/";

function countBy(issues) {
  const m = new Map();
  for (const i of issues || []) { if (!m.has(i.rule)) m.set(i.rule, []); m.get(i.rule).push(i); }
  return m;
}

export function routeAgents({ profile = null, audit = null, priorities = null, inspect = {}, speed = null, geo = null, pipeline = null, consent = null, ymyl = null, pace = null, citations = null, quality = null, redirects = null, facts = null, links = null, render = null, inbound = null, logs = null, rank = null, keywords = null, gap = null, aiVisibility = null, authority = null, forecast = null, linkgraph = null, vitals = null, changes = null, schema = null, entity = null, site = {}, today = "" } = {}) {
  const plan = [];
  const advise = profile && profile.mode === "advise";
  const how = advise ? " This site is in advise mode: recommend exact changes for a person to make; do not try to edit files." : "";
  // targets: every page path the step concerns (not just the examples in evidence), so work orders can lock pages.
  // Steps with no targets concern the whole site.
  const add = (agent, phase, why, evidence = [], prompt = "", targets = []) => {
    // Entries are stored as "seo-<agent>"; a second reason for the same agent adds to that step instead of making a second one.
    // Its instruction is kept too (it names the report to read); an earlier, more urgent phase wins.
    const e = plan.find((p) => p.agent === `seo-${agent}`);
    if (e) {
      e.evidence.push(...evidence.filter((x) => !e.evidence.includes(x)));
      e.targets.push(...targets.filter((t) => !e.targets.includes(t)));
      if (!e.why.includes(why)) e.why += " " + why;
      const extra = prompt.replace(how, "");
      if (extra && !e.prompt.includes(extra)) e.prompt = e.prompt.replace(how, "") + " " + extra.replace(/^Use the seo-[a-z-]+ agent\b/i, "Also use it") + how;
      if (phase < e.rank) { e.rank = phase; e.phase = Object.keys(PHASES)[phase]; }
      return;
    }
    plan.push({ agent: `seo-${agent}`, phase: Object.keys(PHASES)[phase], rank: phase, why, evidence: evidence.slice(0, 6), prompt, targets: [...new Set(targets)] });
  };
  const items = priorities?.items || [];
  const byRule = countBy(audit?.issues);
  const issueCount = (rules) => rules.reduce((n, r) => n + (byRule.get(r)?.length || 0), 0);
  const issueUrls = (rules) => [...new Set(rules.flatMap((r) => (byRule.get(r) || []).map((i) => short(i.url))))].slice(0, 5);
  const ruleEvidence = (rules) => rules.filter((r) => byRule.has(r)).map((r) => `${r}: ${byRule.get(r).length} page(s), e.g. ${issueUrls([r]).join(", ")}`);

  if (!profile) add("onboarder", 0, "There is no site profile yet. Every other agent adapts to the platform, so start here.", [], "Use the seo-onboarder agent to profile this site, confirm what agents may change and fill in the Project rules.");

  if (profile && profile.rendering === "js-dependent") add("technical-fixer", 1, "The page content is not in the delivered HTML, so crawlers and AI tools may see an empty page.", ["rendering: js-dependent"], "Use the seo-technical-fixer agent to plan prerendering or server rendering for the key page types." + how);
  if (profile?.signals?.noindexOnHome) add("technical-fixer", 1, "The home page carries a noindex signal.", ["noindex on the home page"], "Use the seo-technical-fixer agent to confirm whether the home page noindex is intentional, and remove it if not." + how);

  for (const [agent, rules] of Object.entries(RULE_GROUPS)) {
    const n = issueCount(rules);
    if (!n) continue;
    const phase = ["redirect-guardian", "technical-fixer"].includes(agent) ? PHASES.block : ["snippet-optimizer", "content-pruner", "internal-linker"].includes(agent) ? PHASES.content : PHASES.fix;
    add(agent, phase, `${n} audit finding(s) in this agent's area.`, ruleEvidence(rules), `Use the seo-${agent} agent on the audit findings: ${rules.filter((r) => byRule.has(r)).join(", ")}.` + how, rules.flatMap((r) => (byRule.get(r) || []).map((i) => (SITE_WIDE_RULES.has(r) ? "*" : short(i.url)))));
  }

  const renderHigh = (render?.results || []).filter((r) => (r.findings || []).some((f) => f.severity === "high" || f.id === "rendered-text-missing"));
  if (renderHigh.length) add("technical-fixer", PHASES.block, `${renderHigh.length} page(s) deliver HTML that differs from what visitors see (stale prerendered text, or content only after JavaScript).`, renderHigh.slice(0, 4).map((r) => `${short(r.url)}: ${r.findings.filter((f) => f.severity !== "low").map((f) => f.id).join(", ")}`), "Use the seo-technical-fixer agent on render.json: regenerate prerendered text from the same source as the page, or prerender what only appears after JavaScript." + how, renderHigh.map((r) => short(r.url)));
  const redirectProblems = [...(redirects?.check?.errors || []), ...(redirects?.smoke?.results || []).filter((r) => !r.ok).map((r) => `live: ${r.path} ${r.detail}`)];
  if (redirectProblems.length) add("redirect-guardian", PHASES.block, `${redirectProblems.length} problem(s) in the redirect map or on the live site's redirects.`, redirectProblems.slice(0, 5), "Use the seo-redirect-guardian agent on the redirects job's reports (redirects-check.json, redirects-smoke.json): fix the map, regenerate the rules, and re-run the smoke test after deploy." + how);
  const coverageBad = Object.entries(inspect || {}).filter(([, v]) => v?.coverage && v.coverage !== "Submitted and indexed" && !/redirect|alternate|duplicate/i.test(v.coverage));
  if (coverageBad.length || items.some((i) => i.type === "indexing")) add("indexing-monitor", PHASES.block, `${coverageBad.length || "Some"} page(s) are not indexed, and the request list needs checking before anyone acts on it.`, coverageBad.slice(0, 4).map(([u, v]) => `${short(u)}: ${v.coverage}`), "Use the seo-indexing-monitor agent to group the unindexed pages by cause and correct the request-indexing list.", coverageBad.map(([u]) => short(u)));
  const slow = (speed?.results || []).filter((r) => r.rating === "poor" || r.score != null && r.score < 50);
  if (slow.length || items.some((i) => i.id === "speed:poor")) add("performance-fixer", PHASES.fix, `${slow.length || "Some"} page(s) rate poor on speed.`, slow.slice(0, 4).map((r) => `${short(r.url)}: ${r.score ?? r.rating}`), "Use the seo-performance-fixer agent on the slowest page types in the speed report." + how, slow.map((r) => short(r.url)));

  const ofType = (t) => items.filter((i) => i.type === t);
  if (ofType("structure").length) add("cannibalization-resolver", PHASES.content, `${ofType("structure").length} query(ies) have two or more of your pages competing.`, ofType("structure").slice(0, 4).map((i) => i.title), "Use the seo-cannibalization-resolver agent on the competing queries in the priorities report." + how);
  if (ofType("snippet").length) add("snippet-optimizer", PHASES.content, `${ofType("snippet").length} page(s) get impressions but fewer clicks than their position should.`, ofType("snippet").slice(0, 4).map((i) => i.title), "Use the seo-snippet-optimizer agent on the click-through underperformers." + how);
  const misaligned = (quality?.alignment || []).filter((a) => a.weak.includes("title") || a.weak.includes("description"));
  if (misaligned.length) add("snippet-optimizer", PHASES.content, `${misaligned.length} page(s) do not reflect their own top search query in the title or description.`, misaligned.slice(0, 4).map((a) => `${short(a.url)}: "${a.query}" weak in ${a.weak.join(", ")}`), "Use the seo-snippet-optimizer agent on the pages in quality.json whose title or description misses their top query." + how, misaligned.map((a) => short(a.url)));
  const linkItems = links?.items || [];
  if (linkItems.length) add("internal-linker", PHASES.content, `${new Set(linkItems.map((i) => i.to)).size} weakly linked page(s) have related pages that could link to them.`, linkItems.slice(0, 4).map((i) => `${short(i.from)} -> ${short(i.to)} (${i.reason})`), "Use the seo-internal-linker agent on links.json: add the internal links that help a reader, one page per pull request, with descriptive anchor text." + how, linkItems.map((i) => short(i.from)));
  if (ofType("refresh").length) add("refresher", PHASES.content, `${ofType("refresh").length} page(s) lost visibility.`, ofType("refresh").slice(0, 4).map((i) => i.title), "Label the refresh issues `approved`, or use the seo-refresher agent on one page at a time. Diagnose before editing.");
  if (ofType("content").length) {
    add("researcher", PHASES.content, `${ofType("content").length} topic or striking-distance opportunity(ies) are open.`, ofType("content").slice(0, 4).map((i) => i.title), "Use the seo-researcher agent to turn the best opportunities into briefs.");
    if (ofType("content").some((i) => /^strike:/.test(i.id))) add("competitor-analyst", PHASES.grow, "Queries sit just off the first page; the pages above you show what is missing.", ofType("content").filter((i) => /^strike:/.test(i.id)).slice(0, 3).map((i) => i.title), "Use the seo-competitor-analyst agent on the striking-distance queries.");
  }
  if (ofType("ai-search").length || (geo?.findings || []).length) add("ai-search-agent", PHASES.fix, "The AI search readiness report has open findings.", [...ofType("ai-search").map((i) => i.title), ...(geo?.findings || []).map((f) => f.title || f.id)].slice(0, 5), "Use the seo-ai-search-agent to test real questions and close the gaps.");

  if ((facts?.unverified || []).length) add("fact-checker", facts.strict ? PHASES.block : PHASES.content, `${facts.unverified.length} claim(s) in the content have no verified fact and no source.`, facts.unverified.slice(0, 5).map((c) => `${c.where}: ${c.claim}`), "Use the seo-fact-checker agent on facts.json: for each unverified claim, find a real source, add it to the verified-facts file with the owner, or recommend removing it. Never invent a source.");
  if (pipeline && (pipeline.queued > 0 || pipeline.upcoming > 0)) add("fact-checker", PHASES.content, `${(pipeline.queued || 0) + (pipeline.upcoming || 0)} page(s) are waiting to go live. Check their claims first.`, (pipeline.schedule || []).slice(0, 4).map((s) => `${s.date} ${s.title}`), "Use the seo-fact-checker agent on every queued page before it is released.");

  // Compliance: one entry for the auditor, ranked by its most urgent reason (a consent failure blocks, the rest are content-phase).
  const why = [], ev = [], asks = [];
  const highConsent = (consent?.findings || []).filter((f) => f.severity === "high");
  if (highConsent.length) { why.push("The consent check found a high-severity problem (tracking or policy wording without a working consent mechanism)."); ev.push(...highConsent.map((f) => `${f.id}: ${f.evidence?.[0] || f.title}`)); asks.push("Use the seo-compliance-auditor agent on the consent.json findings: confirm what loads before consent and what the privacy page promises, and say what to change." + how); }
  const needRev = (ymyl?.pages || []).filter((p) => p.status === "needs reviewer");
  if (needRev.length) { why.push(`${needRev.length} sensitive-topic page(s) have no named author or reviewer.`); ev.push(...needRev.slice(0, 4).map((p) => `${short(p.url || p.title)}: ${p.topics.join("/")}, missing ${p.missing.join(", ")}`)); asks.push("Use the seo-compliance-auditor agent on the ymyl.json pages that need a reviewer: say what claims need a qualified sign-off and what to hold back." + how); }
  if (why.length) add("compliance-auditor", highConsent.length ? PHASES.block : PHASES.content, why.join(" "), ev, asks.join(" "), highConsent.length ? [] : needRev.filter((p) => p.url).map((p) => short(p.url)));
  if (pace?.overLimit) add("strategist", PHASES.content, `The publishing schedule goes over the pace limits (${pace.overDays?.length || 0} day(s), ${pace.overWeeks?.length || 0} week(s)).`, [...(pace.overDays || []).slice(0, 3).map((d) => `${d.date}: ${d.count} pages`), `${pace.moves?.length || 0} page(s) would move in the recommended schedule`], "Use the seo-strategist agent to review pace.json: adopt the recommended schedule or explain why the burst is needed. Releasing many pages at once looks like scaled content.");
  if (citations?.mostlyAbsent) add("ai-search-agent", PHASES.grow, `The site appears for only ${citations.appears} of ${citations.asked} tracked questions in search results and AI answers.`, [...(citations.absent || []).slice(0, 4), ...(citations.topCited || []).slice(0, 2).map((c) => `cited instead: ${c.domain}`)], "Use the seo-ai-search-agent on the questions in citations.json where the site is absent: see what the cited pages answer and close the gap." + how);

  const types = profile?.signals?.structuredData || [];
  if (profile && !types.some((t) => /Organization|LocalBusiness|Corporation|Person/.test(t))) add("entity-reputation", PHASES.fix, "The home page has no Organization or Person markup, so the business is a weak entity to search engines and AI tools.", ["structured data on the home page: " + (types.join(", ") || "none")], "Use the seo-entity-reputation agent to define the entity, its profiles and its consistent description, then brief the seo-schema-engineer to add the markup.");
  if (profile?.signals?.hreflang) add("international", PHASES.fix, "The site has language or region versions.", ["hreflang present"], "Use the seo-international agent to check language targeting end to end.");
  // Vertical packs: every specialist agent of each pack that applies (detected, or set with `verticals` in the config).
  for (const { pack, why } of detectVerticals({ profile, site })) {
    for (const [name, ask] of Object.entries(PACKS[pack].agents)) add(name.replace(/^seo-/, ""), pack === "ecommerce" ? PHASES.fix : PHASES.grow, `${PACKS[pack].title} pack: ${why.join("; ")}.`, why, ask + how);
  }

  // Server logs: what Googlebot really requested. Waste and uncrawled sitemap pages are fix-phase; the rest is context.
  const logFindings = (logs?.findings || []).filter((f) => ["crawl-waste", "sitemap-not-crawled", "no-googlebot"].includes(f.id) && f.severity !== "low");
  if (logFindings.length) add("log-analyst", PHASES.fix, `The access logs show ${logFindings.length} crawling problem(s).`, logFindings.map((f) => f.title), "Use the seo-log-analyst agent on logs.json: judge the window first, then the crawl waste and the sitemap pages Googlebot did not request, with the agent that should fix each.", [...(logs.googlebot?.errors || []).map((e) => e.path), ...(logs.googlebot?.redirects || []).map((e) => e.path)]);
  // Inbound links: links into pages that now error are value already earned and being lost; patterns go to a person.
  if ((inbound?.reclaim || []).length) add("backlink-auditor", PHASES.fix, `${inbound.reclaim.length} page(s) with inbound links now answer an error, so those links are wasted.`, inbound.reclaim.slice(0, 4).map((x) => `${x.target}: ${x.status}, ${x.links} link(s)`), "Use the seo-backlink-auditor agent on inbound.json: confirm each broken target, choose the closest live page and hand the redirects to the seo-redirect-guardian.", inbound.reclaim.map((x) => x.target));
  if ((inbound?.review || []).length) add("backlink-auditor", PHASES.grow, `${inbound.review.length} inbound-link pattern(s) need a person's look (sitewide links or one dominant anchor).`, inbound.review.slice(0, 3).map((x) => x.note.split(".")[0]), "Use the seo-backlink-auditor agent to review the patterns in inbound.json with the owner. Recommend a disavow only with a manual action or confirmed arranged links.");
  // Research suite: rankings that slipped, traffic outside its normal range, topics with no page, competitor gaps,
  // AI answers that cite others, and sites that link to several competitors but not to you.
  const losers = rank?.summary?.losers || [], droppedOut = rank?.summary?.lost || [];
  const belowNormal = forecast?.site?.clicks?.verdict === "below the normal range" ? forecast.site.clicks : null;
  if (losers.length >= 3 || droppedOut.length || belowNormal) add("serp-analyst", PHASES.fix, [losers.length >= 3 && `${losers.length} tracked queries lost ground this week`, droppedOut.length && `${droppedOut.length} dropped out`, belowNormal && `clicks fell below their normal range (${belowNormal.actual} vs ${belowNormal.expected} expected)`].filter(Boolean).join("; ") + ".", [...losers.slice(0, 4).map((r) => `${r.query}: ${r.previous} to ${r.position}`), ...droppedOut.slice(0, 2).map((q) => `${q}: no impressions this week`)], "Use the seo-serp-analyst agent on rank.json and forecast.json: separate real losses from normal movement, find what changed on the results page (features, new competitors) and name the agent to fix each.");
  if ((keywords?.gaps || []).length) add("topic-mapper", PHASES.grow, `${keywords.gaps.length} topic(s) with real demand have no page that owns them.`, keywords.gaps.slice(0, 4).map((g) => `${g.parent}: ${g.demand.value} (${g.demand.basis})`), "Use the seo-topic-mapper agent on keywords.json: confirm which gaps fit the business and the material it has, and map them to hub and supporting pages.");
  if ((gap?.topics || []).length) add("competitor-analyst", PHASES.grow, `Competitors rank for ${(gap.gap?.missing || []).length + (gap.gap?.weak || []).length} queries where you are absent or on page two.`, gap.topics.slice(0, 4).map((t) => `${t.topic}: ${t.competitors.join(", ")}`), "Use the seo-competitor-analyst agent on gap.json: study the competitor pages behind the most gap queries and say what you could do better with your own material.");
  if (aiVisibility?.asked && aiVisibility.totals?.citationShare < 0.25) add("ai-search-agent", PHASES.grow, `AI answers cite the site in only ${Math.round(aiVisibility.totals.citationShare * 100)}% of ${aiVisibility.asked} recorded answers.`, (aiVisibility.gaps || []).slice(0, 4).map((g) => `${g.q}${g.citedInstead?.length ? ` (cited instead: ${g.citedInstead.join(", ")})` : ""}`), "Use the seo-ai-search-agent on ai-visibility.json: for the questions where no engine cites the site, see what the cited sources answer and close the gap." + how);
  if ((authority?.intersect || []).length) add("link-builder", PHASES.grow, `${authority.intersect.length} site(s) link to several of your competitors but not to you.`, authority.intersect.slice(0, 4).map((x) => `${x.domain}: links to ${x.linksTo.join(", ")}`), "Use the seo-link-builder agent on authority.json: check why each intersect site links to competitors and whether the business honestly belongs there. Drafts only; a person sends.");
  if ((authority?.profile?.lostDomains || []).length >= 3) add("backlink-auditor", PHASES.grow, `${authority.profile.lostDomains.length} referring domain(s) were lost since the last run.`, authority.profile.lostDomains.slice(0, 5), "Use the seo-backlink-auditor agent on authority.json: check whether each lost link or its page went away, and which are worth reclaiming.");
  // Site intelligence: link weight, real-user speed, unexpected page changes, structured data and the entity.
  if ((linkgraph?.underLinked || []).length || (linkgraph?.orphans || []).length) add("internal-linker", PHASES.content, [linkgraph.underLinked?.length && `${linkgraph.underLinked.length} page(s) earn search demand but get little internal link weight`, linkgraph.orphans?.length && `${linkgraph.orphans.length} orphan page(s)`].filter(Boolean).join("; ") + ".", [...(linkgraph.underLinked || []).slice(0, 3).map((x) => `${short(x.url)}: ${x.impressions} impressions, internal score ${x.score}`), ...(linkgraph.orphans || []).slice(0, 2).map((x) => `${short(x.url)}: no links in`)], "Use the seo-internal-linker agent on linkgraph.json: link the under-linked pages from the suggested strong, related pages, one page per pull request, with descriptive anchors.", [...(linkgraph.underLinked || []).flatMap((x) => (x.donors || []).map((d) => short(d.url))), ...(linkgraph.orphans || []).map((x) => short(x.url))]);
  const vitalFails = [vitals?.origin, ...(vitals?.pages || [])].filter((x) => x?.current?.passes === false || (x?.regressions || []).length);
  if (vitalFails.length) add("performance-fixer", PHASES.fix, `Real Chrome users get a poor or worsening experience on ${vitalFails.length} measured target(s) (Chrome UX Report).`, vitalFails.slice(0, 4).map((x) => `${x.url ? short(x.url) : "whole site"}: ${x.current?.passes === false ? "fails Core Web Vitals" : ""}${(x.regressions || []).map((g) => ` ${g.metric} ${g.from} to ${g.to}`).join(",")}`), "Use the seo-performance-fixer agent on vitals.json: fix what real users feel first (the metric and page types that fail), then confirm with the next Chrome UX Report period.");
  const ownChanged = (changes?.results || []).filter((r) => r.kind === "yours" && (r.changes || []).some((c) => c.important && ["noindex", "canonical", "status", "redirect"].includes(c.field)));
  if (ownChanged.length) add("technical-fixer", PHASES.block, `${ownChanged.length} of your key pages changed indexability, canonical or status since the last check.`, ownChanged.slice(0, 4).map((r) => `${short(r.url)}: ${r.changes.filter((c) => c.important).map((c) => c.field).join(", ")}`), "Use the seo-technical-fixer agent on changes.json: confirm whether each change to noindex, canonical, status or redirects was intended, and restore it if not.", ownChanged.map((r) => short(r.url)));
  const theirChanged = (changes?.results || []).filter((r) => r.kind === "competitor" && (r.changes || []).some((c) => c.important));
  if (theirChanged.length) add("competitor-analyst", PHASES.grow, `${theirChanged.length} competitor page(s) that outrank you were rewritten.`, theirChanged.slice(0, 4).map((r) => short(r.url)), "Use the seo-competitor-analyst agent on changes.json: what did they add or change, and does it reveal something searchers want that your page lacks?");
  const schemaErrors = (schema?.results || []).filter((r) => r.invalid || (r.checks || []).some((c) => c.problems.some((p) => p.level === "error")));
  const schemaDrafts = (schema?.results || []).filter((r) => (r.suggestions || []).length);
  if (schemaErrors.length || schemaDrafts.length) add("schema-engineer", PHASES.fix, [schemaErrors.length && `${schemaErrors.length} page(s) have structured data errors or claims the page does not show`, schemaDrafts.length && `${schemaDrafts.length} page(s) have drafted markup to add`].filter(Boolean).join("; ") + ".", [...schemaErrors.slice(0, 3).map((r) => short(r.url)), ...schemaDrafts.slice(0, 2).map((r) => `${short(r.url)}: ${r.suggestions.map((s) => s.type).join(", ")}`)], "Use the seo-schema-engineer agent on schema.json: fix the errors, then add the drafted markup in the templates, filling every placeholder only with facts a person confirms.", [...schemaErrors, ...schemaDrafts].map((r) => short(r.url)));
  if (entity && (entity.knowledgeGraph?.found === false || entity.wikidata?.found === false || (entity.actions || []).length)) add("entity-reputation", PHASES.grow, "Search engines and AI assistants may not recognise the business as one clear entity.", (entity.actions || []).slice(0, 3).map((a) => a.split(":")[0]), "Use the seo-entity-reputation agent on entity.json: make the entity unambiguous and link its official profiles with sameAs.");
  if (!plan.some((p) => p.rank <= PHASES.block)) add("link-builder", PHASES.grow, "Nothing is blocking crawling or indexing, so building authority is the next lever.", [], "Use the seo-link-builder agent to find honest link opportunities for the best pages. Drafts only; a person sends.");
  add("strategist", PHASES.content, "A short ranked plan keeps the week focused.", [], "Use the seo-strategist agent for the five actions that matter this week.");
  add("reporter", PHASES.report, "Report what moved and whether past changes worked.", [], "Use the seo-reporter agent for the weekly or monthly report.");

  plan.sort((a, b) => a.rank - b.rank);
  plan.forEach((p, i) => { p.order = i + 1; });
  return { generatedAt: new Date().toISOString(), date: today, mode: profile?.mode || "unknown", steps: plan };
}

export function planMarkdown(plan, siteName = "") {
  return `# ${siteName ? siteName + ": " : ""}which agents to run, in order

Mode: ${plan.mode}. Built from the audit, priorities, indexing, speed and AI search reports. Work top to bottom; blockers come first because content work is wasted on pages search engines cannot crawl or index.

${plan.steps.map((s) => `## ${s.order}. ${s.agent} (${s.phase})
**Why:** ${s.why}
${s.evidence.length ? s.evidence.map((e) => `- ${e}`).join("\n") + "\n" : ""}**Say:** ${s.prompt}`).join("\n\n")}
`;
}
