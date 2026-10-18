// Decides which agents to run next, in what order, and with what instruction, from the reports the jobs already produce.
// Deterministic and explainable: every recommendation says which finding caused it. Pure: pass the data in, get a plan back.
// Order of work: know the site, fix what blocks crawling and indexing, fix the page-level and content issues, then grow and report.

const RULE_GROUPS = {
  "redirect-guardian": ["status-error", "status-redirect", "redirect-chain", "link-to-redirect", "broken-link"],
  "technical-fixer": ["robots-blocked", "noindex-in-sitemap", "canonical-missing", "canonical-other", "canonical-broken", "robots-blocks-all", "sitemap-not-in-robots", "viewport-missing", "lang-missing", "mixed-content", "h1-missing", "h1-multiple", "title-missing", "desc-missing"],
  "schema-engineer": ["schema-required-missing", "jsonld-invalid", "jsonld-article-incomplete", "og-missing"],
  "international": ["hreflang-invalid", "hreflang-no-self", "hreflang-not-reciprocal"],
  "media-optimizer": ["images-no-alt"],
  "content-pruner": ["thin-content", "duplicate-content", "orphan", "deep"],
  "performance-fixer": ["slow-ttfb"],
  "snippet-optimizer": ["title-long", "title-short", "title-duplicate", "desc-long", "desc-short", "desc-duplicate", "generic-anchor"],
  "refresher": ["h1-long", "heading-skip", "h2-generic", "h2-repeated", "few-subheadings"],
};

const PHASES = { onboard: 0, block: 1, fix: 2, content: 3, grow: 4, report: 5 };
const short = (u) => String(u || "").replace(/^https?:\/\/[^/]+/, "") || "/";

function countBy(issues) {
  const m = new Map();
  for (const i of issues || []) { if (!m.has(i.rule)) m.set(i.rule, []); m.get(i.rule).push(i); }
  return m;
}

export function routeAgents({ profile = null, audit = null, priorities = null, inspect = {}, speed = null, geo = null, pipeline = null, consent = null, ymyl = null, pace = null, citations = null, quality = null, redirects = null, facts = null, links = null, site = {}, today = "" } = {}) {
  const plan = [];
  const add = (agent, phase, why, evidence = [], prompt = "") => {
    // Entries are stored as "seo-<agent>"; a second reason for the same agent adds its evidence instead of a second step.
    const e = plan.find((p) => p.agent === `seo-${agent}`);
    if (e) { e.evidence.push(...evidence.filter((x) => !e.evidence.includes(x))); return; }
    plan.push({ agent: `seo-${agent}`, phase: Object.keys(PHASES)[phase], rank: phase, why, evidence: evidence.slice(0, 6), prompt });
  };
  const items = priorities?.items || [];
  const byRule = countBy(audit?.issues);
  const issueCount = (rules) => rules.reduce((n, r) => n + (byRule.get(r)?.length || 0), 0);
  const issueUrls = (rules) => [...new Set(rules.flatMap((r) => (byRule.get(r) || []).map((i) => short(i.url))))].slice(0, 5);
  const ruleEvidence = (rules) => rules.filter((r) => byRule.has(r)).map((r) => `${r}: ${byRule.get(r).length} page(s), e.g. ${issueUrls([r]).join(", ")}`);

  if (!profile) add("onboarder", 0, "There is no site profile yet. Every other agent adapts to the platform, so start here.", [], "Use the seo-onboarder agent to profile this site, confirm what agents may change and fill in the Project rules.");
  const advise = profile && profile.mode === "advise";
  const how = advise ? " This site is in advise mode: recommend exact changes for a person to make; do not try to edit files." : "";

  if (profile && profile.rendering === "js-dependent") add("technical-fixer", 1, "The page content is not in the delivered HTML, so crawlers and AI tools may see an empty page.", ["rendering: js-dependent"], "Use the seo-technical-fixer agent to plan prerendering or server rendering for the key page types." + how);
  if (profile?.signals?.noindexOnHome) add("technical-fixer", 1, "The home page carries a noindex signal.", ["noindex on the home page"], "Use the seo-technical-fixer agent to confirm whether the home page noindex is intentional, and remove it if not." + how);

  for (const [agent, rules] of Object.entries(RULE_GROUPS)) {
    const n = issueCount(rules);
    if (!n) continue;
    const phase = ["redirect-guardian", "technical-fixer"].includes(agent) ? PHASES.block : ["snippet-optimizer", "content-pruner", "refresher"].includes(agent) ? PHASES.content : PHASES.fix;
    add(agent, phase, `${n} audit finding(s) in this agent's area.`, ruleEvidence(rules), `Use the seo-${agent} agent on the audit findings: ${rules.filter((r) => byRule.has(r)).join(", ")}.` + how);
  }

  const redirectProblems = [...(redirects?.check?.errors || []), ...(redirects?.smoke?.results || []).filter((r) => !r.ok).map((r) => `live: ${r.path} ${r.detail}`)];
  if (redirectProblems.length) add("redirect-guardian", PHASES.block, `${redirectProblems.length} problem(s) in the redirect map or on the live site's redirects.`, redirectProblems.slice(0, 5), "Use the seo-redirect-guardian agent on the redirects job's reports (redirects-check.json, redirects-smoke.json): fix the map, regenerate the rules, and re-run the smoke test after deploy." + how);
  const coverageBad = Object.entries(inspect || {}).filter(([, v]) => v?.coverage && v.coverage !== "Submitted and indexed" && !/redirect|alternate|duplicate/i.test(v.coverage));
  if (coverageBad.length || items.some((i) => i.type === "indexing")) add("indexing-monitor", PHASES.block, `${coverageBad.length || "Some"} page(s) are not indexed, and the request list needs checking before anyone acts on it.`, coverageBad.slice(0, 4).map(([u, v]) => `${short(u)}: ${v.coverage}`), "Use the seo-indexing-monitor agent to group the unindexed pages by cause and correct the request-indexing list.");
  const slow = (speed?.results || []).filter((r) => r.rating === "poor" || r.score != null && r.score < 50);
  if (slow.length || items.some((i) => i.id === "speed:poor")) add("performance-fixer", PHASES.fix, `${slow.length || "Some"} page(s) rate poor on speed.`, slow.slice(0, 4).map((r) => `${short(r.url)}: ${r.score ?? r.rating}`), "Use the seo-performance-fixer agent on the slowest page types in the speed report." + how);

  const ofType = (t) => items.filter((i) => i.type === t);
  if (ofType("structure").length) add("cannibalization-resolver", PHASES.content, `${ofType("structure").length} query(ies) have two or more of your pages competing.`, ofType("structure").slice(0, 4).map((i) => i.title), "Use the seo-cannibalization-resolver agent on the competing queries in the priorities report." + how);
  if (ofType("snippet").length) add("snippet-optimizer", PHASES.content, `${ofType("snippet").length} page(s) get impressions but fewer clicks than their position should.`, ofType("snippet").slice(0, 4).map((i) => i.title), "Use the seo-snippet-optimizer agent on the click-through underperformers." + how);
  const misaligned = (quality?.alignment || []).filter((a) => a.weak.includes("title") || a.weak.includes("description"));
  if (misaligned.length) add("snippet-optimizer", PHASES.content, `${misaligned.length} page(s) do not reflect their own top search query in the title or description.`, misaligned.slice(0, 4).map((a) => `${short(a.url)}: "${a.query}" weak in ${a.weak.join(", ")}`), "Use the seo-snippet-optimizer agent on the pages in quality.json whose title or description misses their top query." + how);
  const linkItems = links?.items || [];
  if (linkItems.length) add("refresher", PHASES.content, `${new Set(linkItems.map((i) => i.to)).size} weakly linked page(s) have related pages that could link to them.`, linkItems.slice(0, 4).map((i) => `${short(i.from)} -> ${short(i.to)} (${i.reason})`), "Use the seo-refresher agent on links.json: add the internal links that help a reader, one page per pull request, with descriptive anchor text." + how);
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
  if (why.length) add("compliance-auditor", highConsent.length ? PHASES.block : PHASES.content, why.join(" "), ev, asks.join(" "));
  if (pace?.overLimit) add("strategist", PHASES.content, `The publishing schedule goes over the pace limits (${pace.overDays?.length || 0} day(s), ${pace.overWeeks?.length || 0} week(s)).`, [...(pace.overDays || []).slice(0, 3).map((d) => `${d.date}: ${d.count} pages`), `${pace.moves?.length || 0} page(s) would move in the recommended schedule`], "Use the seo-strategist agent to review pace.json: adopt the recommended schedule or explain why the burst is needed. Releasing many pages at once looks like scaled content.");
  if (citations?.mostlyAbsent) add("ai-search-agent", PHASES.grow, `The site appears for only ${citations.appears} of ${citations.asked} tracked questions in search results and AI answers.`, [...(citations.absent || []).slice(0, 4), ...(citations.topCited || []).slice(0, 2).map((c) => `cited instead: ${c.domain}`)], "Use the seo-ai-search-agent on the questions in citations.json where the site is absent: see what the cited pages answer and close the gap." + how);

  const types = profile?.signals?.structuredData || [];
  if (profile && !types.some((t) => /Organization|LocalBusiness|Corporation|Person/.test(t))) add("entity-reputation", PHASES.fix, "The home page has no Organization or Person markup, so the business is a weak entity to search engines and AI tools.", ["structured data on the home page: " + (types.join(", ") || "none")], "Use the seo-entity-reputation agent to define the entity, its profiles and its consistent description.");
  if (types.some((t) => /LocalBusiness|Dentist|Store|Restaurant|ProfessionalService/.test(t)) || site.local) add("local-agent", PHASES.grow, "The site is a local business (marked up as one, or flagged local in the config).", types.filter((t) => /Local|Dentist|Store|Restaurant|Professional/.test(t)), "Use the seo-local-agent to check the profile, listings consistency and location pages.");
  if (profile?.signals?.hreflang) add("international", PHASES.fix, "The site has language or region versions.", ["hreflang present"], "Use the seo-international agent to check language targeting end to end.");
  if (/Shopify|Magento|WooCommerce/i.test(profile?.platform?.name || "") || types.some((t) => /^Product$|Offer/.test(t))) add("ecommerce", PHASES.fix, "The site sells products.", types.filter((t) => /Product|Offer/.test(t)), "Use the seo-ecommerce agent on category, product and faceted-navigation pages.");

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
