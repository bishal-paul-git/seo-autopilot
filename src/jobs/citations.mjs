// AI answer and SERP citation tracker: asks a SERP provider your real customer questions and records whether the site is
// cited, who is, and how that changes. Needs one provider key (see the help printed when none is set). Sequential, capped at 40.
// Writes <state>/<site>/citations.json (with run history) and citations.md.   npx seo-autopilot run citations [--json]
import { readJson, writeJson, writeText, today, sleep } from "../core/util.mjs";
import { pickProvider, SETUP_HELP } from "../lib/serp.mjs";
import { normaliseQuestions, analyseCitations, appendHistory, citationsMarkdown } from "../analysis/citations.mjs";

export const description = "Track whether the site is cited in search results and AI answers for your key questions (needs a SERP provider key)";

/** `deps` lets tests inject fetch, env and a zero delay. */
export async function run({ site, flags = {} }, deps = {}) {
  const env = deps.env || process.env;
  const provider = pickProvider(env);
  if (!provider) { console.log(SETUP_HELP); return; }
  const file = `${site.paths.data}/questions.json`;
  const raw = readJson(file, []);
  if (raw.some((x) => /^replace these/i.test(String(x?.q ?? x)))) { console.log(`citations: ${file} still has the "REPLACE THESE" example list. Put your real questions there first so no search credits are spent on examples.`); return; }
  const questions = normaliseQuestions(raw, site.citations?.market || "GB");
  if (!questions.length) { console.log(`citations: no questions to check. Add your real customer questions to ${file} (strings or {"q": "...", "market": "GB"}).`); return; }
  const delay = deps.delayMs ?? 1200;
  const domain = new URL(site.url).hostname;
  const answers = [];
  for (const [i, { q, market }] of questions.entries()) {
    if (i) await sleep(delay);
    try { answers.push({ q, market, ...(await provider.search(q, market, { fetch: deps.fetch || globalThis.fetch, env })) }); }
    catch (e) { answers.push({ q, market, error: e.message }); console.log(`citations: "${q}" failed: ${e.message}`); }
  }
  const r = analyseCitations({ domain, answers });
  const s = site.paths.state;
  const history = appendHistory(readJson(`${s}/citations.json`, {}).history, { date: today(), provider: provider.name, asked: r.asked, appears: r.appears, share: r.share });
  writeJson(`${s}/citations.json`, { generatedAt: new Date().toISOString(), provider: provider.name, ...r, history });
  const md = citationsMarkdown(r, history, site.name, provider.name);
  writeText(`${s}/citations.md`, md);
  console.log(flags.json ? JSON.stringify(r, null, 2) : md);
}
