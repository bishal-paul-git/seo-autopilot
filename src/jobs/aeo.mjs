// AEO tracker: asks Google's AI answers (AI Overview, AI Mode) or ChatGPT with web search, through DataForSEO, the buyer
// questions in the site's `aeo` config, and records whether each answer mentions the site (name or alias, Arabic included) or
// cites its domain, and which other sites it cites instead.
//   npx seo-autopilot run aeo [--mode ai_overview|ai_mode|llm_responses] [--limit 5] [--lang ar] [--force]
// Config: site.aeo (docs/aeo.md) and site.market (location + languages). Credentials: DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD.
// Money: every call goes through ONE cost guard for the run (monthly cap, balance floor, ledger) and the run also stops at
// aeo.maxCostPerRunUsd. The report shows the cost measured from the API responses, not an estimate.
// Writes aeo.json (answers, history) and aeo.md in the state folder. Runs at most once per `aeo.schedule` period unless --force.
import { readJson, writeJson, writeText, today as todayFn, sleep } from "../core/util.mjs";
import { dataforseo, DFS_ESTIMATE_USD } from "../lib/ai-engines.mjs";
import { costGuardFor, dataforseoEnabled, BudgetError } from "../lib/dataforseo.mjs";
import { resolveAeo, AEO_MODES, AEO_SCHEDULES } from "../lib/aeo-config.mjs";
import { analyseAeo, aeoMarkdown } from "../analysis/aeo.mjs";
import { inLanguage, marketLabel } from "../lib/market.mjs";

export const description = "AI answers: do Google's AI Overview / AI Mode or ChatGPT answers to your buyer questions mention or cite you (DataForSEO, capped per run, Arabic supported)";

// What one call may cost at least, used only to decide whether the next prompt still fits under the per-run cap before the first
// real cost is known; afterwards 1.5x the dearest call so far is used. The real cost always comes from the response.
export const FLOOR_ESTIMATE_USD = DFS_ESTIMATE_USD;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/**
 * Ask every prompt once in `mode`. Stops (and says why) when the per-run cap would be passed or the guard refuses.
 * Returns { answers, spentUsd, stoppedBy }. `engine` is injectable for tests.
 */
export async function collect({ prompts, mode, market, guard, maxCostUsd, env = process.env, engine = dataforseo, delayMs = 300 }) {
  const answers = [];
  let spent = 0, dearest = 0, stoppedBy = null;
  for (const [i, p] of prompts.entries()) {
    const base = { q: p.text, lang: p.lang, mode };
    if (stoppedBy) { answers.push({ ...base, skipped: stoppedBy }); continue; }
    const next = Math.max(FLOOR_ESTIMATE_USD[mode], dearest * 1.5);
    if (maxCostUsd != null && spent + next > maxCostUsd) { stoppedBy = `the per-run cap of $${maxCostUsd} (spent $${spent.toFixed(4)}, next call about $${next.toFixed(4)})`; answers.push({ ...base, skipped: stoppedBy }); continue; }
    if (i) await sleep(delayMs);
    try {
      const a = await engine.ask(p.text, { guard, market, mode, lang: p.lang, env });
      spent += a.costUsd || 0; dearest = Math.max(dearest, a.costUsd || 0);
      answers.push({ ...base, model: a.model, text: a.text, citations: a.citations, unresolved: a.unresolved, present: a.present, costUsd: a.costUsd });
    } catch (e) {
      if (e instanceof BudgetError) { stoppedBy = `the cost guard refused (${e.reason}): ${e.message}`; answers.push({ ...base, skipped: stoppedBy }); }
      else answers.push({ ...base, error: e.message });
    }
  }
  return { answers, spentUsd: Number(spent.toFixed(6)), stoppedBy };
}

/** `deps`: env, fetch, guard, now, today, delayMs, engine. For tests and one-off scripts. */
export async function run({ site, flags = {} }, deps = {}) {
  const env = deps.env || process.env, s = site.paths.state, day = deps.today || todayFn();
  const aeo = resolveAeo(site);
  if (!aeo) { console.log('aeo: this site has no "aeo" block in seo-autopilot.config.json, so nothing was asked. Add prompts, aliases and a mode (docs/aeo.md).'); return; }
  const mode = flags.mode || aeo.mode;
  if (!Object.hasOwn(AEO_MODES, mode)) throw new Error(`aeo: unknown mode "${mode}". Use one of: ${Object.keys(AEO_MODES).join(", ")}`);
  if (!deps.guard && !dataforseoEnabled(env)) { console.log("aeo: DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are not set, so nothing was asked."); return; }
  const file = `${s}/aeo.json`, prev = readJson(file, {});
  const limited = flags.limit != null || flags.lang != null;
  const period = AEO_SCHEDULES[aeo.schedule], last = (prev.history || []).at(-1);
  if (!flags.force && !limited && last && (period == null || daysBetween(last.date, day) < period)) {
    console.log(`aeo: schedule is ${aeo.schedule}; the last run was ${last.date}.${period == null ? " Run with --force." : ` The next is due ${new Date(Date.parse(last.date) + period * 864e5).toISOString().slice(0, 10)}, or run with --force.`}`);
    return;
  }
  let prompts = aeo.prompts;
  if (flags.lang) { inLanguage(aeo.market, flags.lang); prompts = prompts.filter((p) => p.lang === flags.lang); }
  if (flags.limit != null) { const n = Number(flags.limit); if (!Number.isInteger(n) || n < 1) throw new Error("aeo: --limit must be a whole number of 1 or more"); prompts = prompts.slice(0, n); }
  if (!prompts.length) { console.log("aeo: no prompts match, nothing was asked."); return; }
  const f = deps.fetch || globalThis.fetch;
  const guard = costGuardFor(site, "aeo", { env, fetch: f, guard: deps.guard, now: deps.now });
  const domain = new URL(site.url).hostname.replace(/^www\./, "");
  const { answers, spentUsd, stoppedBy } = await collect({ prompts, mode, market: aeo.market, guard, maxCostUsd: Number(flags["max-cost"] ?? aeo.maxCostPerRunUsd), env, engine: deps.engine, delayMs: deps.delayMs });
  const r = analyseAeo(answers, { domain, names: [site.name, ...(site.brandTerms || []), ...aeo.aliases].filter(Boolean) });
  const entry = { date: day, mode, limited, asked: r.totals.asked, answered: r.totals.answered, mentioned: r.totals.mentioned, cited: r.totals.cited, costUsd: r.totals.costUsd };
  const history = [...(prev.history || []), entry].slice(-120);
  // Raw answers are kept (trimmed) as the evidence behind every number.
  const evidence = answers.map((a) => ({ q: a.q, lang: a.lang, mode: a.mode, model: a.model, error: a.error, skipped: a.skipped, costUsd: a.costUsd, text: String(a.text || "").slice(0, 3000), citations: (a.citations || []).slice(0, 25) }));
  writeJson(file, { generatedAt: new Date().toISOString(), mode, market: marketLabel(aeo.market), domain, ...r, stoppedBy, spentUsd, history, answers: evidence });
  const md = aeoMarkdown(r, { mode, siteName: site.name || domain, date: day, capUsd: Number(flags["max-cost"] ?? aeo.maxCostPerRunUsd), stoppedBy, market: marketLabel(aeo.market) });
  writeText(`${s}/aeo.md`, md);
  console.log(md);
}
