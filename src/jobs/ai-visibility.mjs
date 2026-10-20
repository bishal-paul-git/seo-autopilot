// AI visibility tracker: asks AI answer engines (with live web search) your real customer questions, several times each,
// and records whether they mention the business, cite the site, and who they cite instead.
//   npx seo-autopilot run ai-visibility [--runs 2] [--engines perplexity,openai]
// Questions: <data>/questions.json (shared with `citations`). Names to look for: research.aliases in the config plus the
// site name and brand terms. Competitors: research.competitors (domains) and research.competitorNames.
// Keys (any): PERPLEXITY_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY. Each answer costs the provider's
// normal API price; questions x engines x runs calls are made, capped at 40 questions.
// Writes ai-visibility.json (with raw answers and history) and ai-visibility.md in the state folder.
import { readJson, writeJson, writeText, today, sleep } from "../core/util.mjs";
import { enabledEngines, ENGINES } from "../lib/ai-engines.mjs";
import { normaliseQuestions } from "../analysis/citations.mjs";
import { analyse, appendHistory, setHash, visibilityMarkdown } from "../analysis/ai-visibility.mjs";

export const description = "AI visibility: how often ChatGPT, Claude, Gemini and Perplexity mention and cite you on your real questions (needs at least one AI key)";

export async function run({ site, flags = {} }, deps = {}) {
  const env = deps.env || process.env, f = deps.fetch || globalThis.fetch;
  const only = flags.engines ? String(flags.engines).split(",") : site.research?.engines || null;
  const engines = enabledEngines(env, only);
  if (!engines.length) { console.log(`ai-visibility: no AI engine key is set, so nothing was asked. Set any of: ${ENGINES.map((e) => e.name).join(", ")} (PERPLEXITY_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY).`); return; }
  const raw = readJson(`${site.paths.data}/questions.json`, []);
  if (raw.some((x) => /^replace these/i.test(String(x?.q ?? x)))) { console.log("ai-visibility: questions.json still has the example list. Put your real customer questions there first, so no credits are spent on examples."); return; }
  const questions = normaliseQuestions(raw).map((x) => x.q);
  if (!questions.length) { console.log("ai-visibility: add your real customer questions to questions.json."); return; }
  const runs = Math.max(1, Math.min(5, Number(flags.runs || site.research?.aiRuns || 2)));
  const domain = new URL(site.url).hostname.replace(/^www\./, "");
  const names = [site.name, ...(site.brandTerms || []), ...(site.research?.aliases || [])].filter(Boolean);
  const competitors = [...(site.research?.competitors || []).map((d) => ({ domain: d })), ...(site.research?.competitorNames || []).map((n) => ({ name: n }))];

  const answers = [];
  let i = 0;
  for (const q of questions) for (const e of engines) for (let run = 1; run <= runs; run++) {
    if (i++) await sleep(deps.delayMs ?? 1500);
    try { answers.push({ q, run, ...(await e.ask(q, { fetch: f, env })) }); }
    catch (err) { answers.push({ q, run, engine: e.name, error: err.message }); console.log(`ai-visibility: ${e.name} "${q}" failed: ${err.message}`); }
  }
  const r = analyse(answers, { domain, names, competitors });
  const s = site.paths.state, hash = setHash(questions);
  const history = appendHistory(readJson(`${s}/ai-visibility.json`, {}).history, { date: today(), setHash: hash, engines: r.engines, runs, answers: r.asked, mentionShare: r.totals.mentionShare, citationShare: r.totals.citationShare });
  // Raw answers are kept (trimmed) as the evidence behind every number.
  const evidence = answers.map((a) => ({ q: a.q, engine: a.engine, model: a.model, run: a.run, error: a.error, refused: a.refused, text: String(a.text || "").slice(0, 4000), citations: (a.citations || []).slice(0, 20) }));
  writeJson(`${s}/ai-visibility.json`, { generatedAt: new Date().toISOString(), setHash: hash, runs, ...r, history, answers: evidence });
  const md = visibilityMarkdown(r, { siteName: site.name, history, runs });
  writeText(`${s}/ai-visibility.md`, md);
  console.log(md);
}
