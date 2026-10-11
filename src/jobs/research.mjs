// Weekly keyword research from real evidence: what people actually searched before seeing the site.
// 1. Pulls Search Console queries (last 28 days vs the 28 before). No keyword-volume tool is needed or assumed.
// 2. Sorts them into near-miss (position 5 to 20), question-style, new-and-uncovered and rising queries.
// 3. Keeps a running backlog in <state>/<site>/keyword-backlog.json (nothing is deleted, only re-scored).
// 4. Opens at most limits.topicsPerWeek topic issues for uncovered queries that have real impressions.
// With an AI key it also records up to 10 long-tail IDEAS in the backlog. Ideas have no volume data, are flagged as
// unverified, and never become issues on their own.
import { getToken, SCOPES, searchAnalytics } from "../lib/google-auth.mjs";
import { readJson, writeJson, writeText, today, dayOf, clean } from "../core/util.mjs";
import { ghAvailable, ensureLabel, existingTitles, openIssue } from "../lib/gh.mjs";
import { askJson, NO_FAKE_RULES } from "../lib/llm.mjs";
import { ingest } from "../lib/ingest.mjs";
import { loadPages, makeCovered } from "../adapters/index.mjs";

export const description = "Weekly keyword research from Search Console, a keyword backlog, and topic proposals";

const QUESTION = /^(how|what|why|can|does|do|is|are|should|which|when)\b/i;

export async function run({ site }) {
  const { token } = await getToken([SCOPES.searchConsole]);
  const q = searchAnalytics(site, token);
  const end = Date.now() - 2 * 864e5;
  const recent = await q(dayOf(end - 27 * 864e5), dayOf(end), ["query"], 1000);
  const earlier = await q(dayOf(end - 55 * 864e5), dayOf(end - 28 * 864e5), ["query"], 1000);
  const before = new Map(earlier.map((r) => [r.keys[0], r]));
  const brand = [...(site.ignoreQueries || []), ...(site.brandTerms || [])].map((x) => x.toLowerCase());
  const covered = makeCovered(await loadPages(site));

  const backlogFile = `${site.paths.state}/keyword-backlog.json`;
  const backlog = readJson(backlogFile, {});
  const found = [];
  for (const r of recent) {
    const query = clean(r.keys[0], 90).toLowerCase();
    if (!query || brand.some((x) => query.includes(x))) continue;
    const prev = before.get(r.keys[0]);
    const kinds = [];
    if (r.position > 5 && r.position < 20 && r.impressions >= 3) kinds.push("near-miss");
    if (QUESTION.test(query) && r.impressions >= 2) kinds.push("question");
    if (prev && r.impressions >= 5 && r.impressions >= prev.impressions * 1.5) kinds.push("rising");
    const isCovered = covered(query);
    if (!isCovered && r.impressions >= 2) kinds.push("uncovered");
    if (!kinds.length) continue;
    const score = Math.round(r.impressions * (1 + (kinds.includes("near-miss") ? 0.5 : 0) + (kinds.includes("rising") ? 0.5 : 0)) * (isCovered ? 0.5 : 1));
    found.push({ query, kinds, impressions: r.impressions, clicks: r.clicks, position: Number(r.position.toFixed(1)), covered: isCovered, score });
  }
  found.sort((a, b) => b.score - a.score);
  for (const f of found) backlog[f.query] = { ...(backlog[f.query] || { firstSeen: today(), status: "new" }), ...f, lastSeen: today() };

  const ideas = await askJson(
    `You suggest long-tail topics for a website's guides. ${NO_FAKE_RULES}`,
    `Existing search queries that already bring impressions (data): ${JSON.stringify(found.slice(0, 15).map((f) => f.query))}.\nSuggest up to 10 related practical questions a customer might search that these do NOT already cover. JSON array of strings, each under 80 characters.`,
    { maxTokens: 500 });
  if (Array.isArray(ideas)) for (const i of ideas.slice(0, 10)) {
    const idea = clean(i, 80).toLowerCase();
    if (idea && !covered(idea) && !backlog[idea]) backlog[idea] = { query: idea, kinds: ["idea"], unverified: true, note: "AI suggestion, no volume data", firstSeen: today(), lastSeen: today(), status: "new", score: 0 };
  }
  writeJson(backlogFile, backlog);

  const section = (k) => `## ${k}\n${found.filter((f) => f.kinds.includes(k)).slice(0, 12).map((f) => `- "${f.query}": pos ${f.position}, ${f.impressions} impr, ${f.clicks} clicks${f.covered ? " (page exists)" : ""}`).join("\n") || "- none"}`;
  const md = `# Keyword research ${today()}\n\nSource: Search Console, last 28 days vs the 28 before (${recent.length} queries). No volume data: scores are impressions weighted by opportunity.\n\n` +
    ["near-miss", "uncovered", "question", "rising"].map(section).join("\n\n") +
    `\n\n## AI ideas (unverified)\n${Object.values(backlog).filter((b) => b.unverified && b.firstSeen === today()).map((b) => `- ${b.query}`).join("\n") || "- none"}\n`;
  writeText(`${site.paths.state}/keyword-research.md`, md);
  console.log(md);

  if (ghAvailable()) {
    const L = site.labels;
    await ensureLabel(L.topic, "5B8DEF", "Proposed new page awaiting approval");
    await ensureLabel(L.approved, "10B981", "Owner approved this proposal");
    const titles = await existingTitles(L.topic);
    const topics = readJson(site.paths.topics, {});
    const rules = topics.draftRules || "one new page, 700+ words, direct answer in the first 40 to 60 words, FAQ, official sources (https) where the topic is regulated, no invented numbers or results.";
    let made = 0;
    for (const f of found.filter((x) => x.kinds.includes("uncovered") && x.impressions >= 5)) {
      if (made >= site.limits.topicsPerWeek) break;
      const title = `Topic: new page for "${f.query}"`;
      if (titles.has(title) || backlog[f.query]?.status === "proposed") continue;
      const body = `**Evidence:** Search Console shows "${f.query}" with ${f.impressions} impressions, ${f.clicks} clicks, average position ${f.position} (last 28 days). No existing page covers it.\n\n**Proposed work:** ${rules}\n\n**To approve:** add the label \`${L.approved}\`. To decline, close the issue.`;
      if (await openIssue(title, body, [L.topic])) { backlog[f.query].status = "proposed"; made++; }
    }
    writeJson(backlogFile, backlog);
  }

  await ingest(site, { topics: Object.values(backlog).filter((b) => b.lastSeen === today()).slice(0, 200).map((b) => ({
    query: b.query, kind: (b.kinds || []).join(","), impressions: b.impressions ?? 0, position: b.position ?? null, status: b.status || "new", unverified: Boolean(b.unverified) })) });
}
