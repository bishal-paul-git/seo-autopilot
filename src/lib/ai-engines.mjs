// AI answer engines for the AI visibility tracker. Each asks one question with live web search on and returns
// { engine, model, text, citations: [{ url, domain, title }] }. Bring your own keys; every engine is optional.
// Raw fetch on purpose: the core stays dependency-free. `fetchFn` is injectable so tests never touch the network.
// Keys go in headers only and are never logged or put in errors.
// Request and response shapes follow each provider's public documentation; they have not been exercised live here.
//
//   engine       env                  default model (override)
//   perplexity   PERPLEXITY_API_KEY   sonar             (SEO_AI_PERPLEXITY_MODEL)
//   openai       OPENAI_API_KEY       gpt-5             (SEO_AI_OPENAI_MODEL)   Responses API with the web_search tool
//   anthropic    ANTHROPIC_API_KEY    claude-opus-5-5   (SEO_AI_ANTHROPIC_MODEL) Messages API with web_search_20260209
//   gemini       GEMINI_API_KEY       gemini-2.5-flash  (SEO_AI_GEMINI_MODEL)   generateContent with google_search grounding
//   dataforseo   DATAFORSEO_LOGIN + _PASSWORD   modes ai_overview | ai_mode | llm_responses (SEO_AI_DATAFORSEO_MODEL, default gpt-4.1-mini,
//                for llm_responses). Opt-in only (name it in research.engines or use the `aeo` job), always through the cost guard.
import { domainOf, realTarget } from "./serp.mjs";
import { requireGuard, dataforseoEnabled, costOf } from "./dataforseo.mjs";
import { requireMarket, inLanguage } from "./market.mjs";

async function post(f, name, url, headers, body) {
  let r;
  try { r = await f(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) }); }
  catch (e) { throw new Error(`${name}: request failed (${e.name || "error"})`); }
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}${r.status === 429 ? " (rate limited)" : r.status === 401 || r.status === 403 ? " (key rejected)" : ""}`);
  return r.json();
}
const cite = (url, title = "") => ({ url, domain: domainOf(url), title });
const uniq = (list) => { const seen = new Set(); return list.filter((c) => c.url && !seen.has(c.url) && seen.add(c.url)); };

export const perplexity = {
  name: "perplexity",
  enabled: (env) => Boolean(env.PERPLEXITY_API_KEY),
  async ask(q, { fetch: f = fetch, env = process.env } = {}) {
    const model = env.SEO_AI_PERPLEXITY_MODEL || "sonar";
    const j = await post(f, "perplexity", "https://api.perplexity.ai/chat/completions", { Authorization: `Bearer ${env.PERPLEXITY_API_KEY}` }, { model, messages: [{ role: "user", content: q }] });
    const results = (j.search_results || []).map((s) => cite(s.url, s.title));
    return { engine: "perplexity", model, text: j.choices?.[0]?.message?.content || "", citations: uniq([...results, ...(j.citations || []).map((u) => cite(u))]) };
  },
};

export const openai = {
  name: "openai",
  enabled: (env) => Boolean(env.OPENAI_API_KEY),
  async ask(q, { fetch: f = fetch, env = process.env } = {}) {
    const model = env.SEO_AI_OPENAI_MODEL || "gpt-5";
    const j = await post(f, "openai", "https://api.openai.com/v1/responses", { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, { model, tools: [{ type: "web_search" }], input: q });
    const parts = (j.output || []).filter((o) => o.type === "message").flatMap((o) => o.content || []).filter((c) => c.type === "output_text");
    return { engine: "openai", model, text: parts.map((p) => p.text).join("\n") || j.output_text || "", citations: uniq(parts.flatMap((p) => (p.annotations || []).filter((a) => a.type === "url_citation").map((a) => cite(a.url, a.title)))) };
  },
};

export const anthropic = {
  name: "anthropic",
  enabled: (env) => Boolean(env.ANTHROPIC_API_KEY),
  async ask(q, { fetch: f = fetch, env = process.env } = {}) {
    const model = env.SEO_AI_ANTHROPIC_MODEL || "claude-opus-5-5";
    // Server-side fallback: if a safety classifier declines, the API retries on a suitable model in the same call.
    const j = await post(f, "anthropic", "https://api.anthropic.com/v1/messages",
      { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" },
      { model, max_tokens: 16000, fallbacks: "default", tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }], messages: [{ role: "user", content: q }] });
    if (j.stop_reason === "refusal") return { engine: "anthropic", model: j.model || model, text: "", citations: [], refused: true };
    const blocks = j.content || [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
    // Cited sources first (they back a sentence of the answer), then every search result it read.
    const cited = blocks.filter((b) => b.type === "text").flatMap((b) => (b.citations || []).filter((c) => c.type === "web_search_result_location").map((c) => cite(c.url, c.title)));
    const read = blocks.filter((b) => b.type === "web_search_tool_result" && Array.isArray(b.content)).flatMap((b) => b.content.filter((r) => r.type === "web_search_result").map((r) => ({ ...cite(r.url, r.title), readOnly: true })));
    return { engine: "anthropic", model: j.model || model, text, citations: uniq(cited), sources: uniq(read) };
  },
};

export const gemini = {
  name: "gemini",
  enabled: (env) => Boolean(env.GEMINI_API_KEY),
  async ask(q, { fetch: f = fetch, env = process.env } = {}) {
    const model = env.SEO_AI_GEMINI_MODEL || "gemini-2.5-flash";
    const j = await post(f, "gemini", `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": env.GEMINI_API_KEY },
      { contents: [{ parts: [{ text: q }] }], tools: [{ google_search: {} }] });
    const c = j.candidates?.[0] || {};
    // Grounding links are Google redirect URLs; the chunk title carries the source's domain.
    const chunks = (c.groundingMetadata?.groundingChunks || []).map((g) => g.web).filter(Boolean)
      .map((w) => ({ url: w.uri, domain: /vertexaisearch|google\.com\/url/.test(w.uri || "") ? String(w.title || "").toLowerCase().replace(/^www\./, "") : domainOf(w.uri), title: w.title || "" }));
    return { engine: "gemini", model, text: (c.content?.parts || []).map((p) => p.text || "").join(""), citations: uniq(chunks) };
  },
};

// DataForSEO: one engine, three ways to read an AI answer (see docs/aeo.md for the measured comparison). Not a key-only engine:
// it needs the cost guard and the site's market, so `ask` takes `{ guard, market }` (the `aeo` job and the AI visibility job pass them).
//   ai_overview    POST serp/google/organic/live/advanced with load_async_ai_overview: the AI Overview block and its references
//   ai_mode        POST serp/google/ai_mode/live/advanced: Google AI Mode's answer and references
//   llm_responses  POST ai_optimization/chat_gpt/llm_responses/live with web_search: ChatGPT's answer and its url annotations
export const DFS_PATHS = { ai_overview: "serp/google/organic/live/advanced", ai_mode: "serp/google/ai_mode/live/advanced", llm_responses: "ai_optimization/chat_gpt/llm_responses/live" };
export const DFS_DEFAULT_LLM_MODEL = "gpt-4.1-mini";
// Generous per-call estimates for the cost guard (only used to decide whether a call may start; the ledger records the real cost).
// llm_responses: DataForSEO's pricing page says "The price for setting a task is $0.0006 in the Live mode" plus the LLM provider's own
// price for the answer (https://dataforseo.com/pricing/ai-optimization/llm-responses); measured live 2026-11-26: $0.0013 without a
// web search, up to $0.0299 with one, so 0.05. ai_mode: its pricing page (https://dataforseo.com/pricing/serp/google-ai-mode) gives no
// number in its text; measured live $0.004 per call, so 0.01. ai_overview: a SERP call at depth 10 with the async AI Overview, measured $0.004.
export const DFS_ESTIMATE_USD = { ai_overview: 0.01, ai_mode: 0.01, llm_responses: 0.05 };
// Task statuses worth one more try: 40101 "Internal SE Server Error" (seen live, costs nothing) and the 5xxxx server errors.
const retryable = (code) => code === 40101 || code >= 50000;
const clip = (s) => String(s || "").slice(0, 80);

// ai_overview items (organic SERP) and AI Mode answers share one shape: an item with `markdown`, `items[].text` and `references[]`
// (`items[].references[]` for the per-paragraph ones). Redirect rows ("/goto?url=...") are resolved or skipped by realTarget.
function readSerpAnswer(items) {
  const blocks = items.filter((i) => i.type === "ai_overview" || i.type === "ai_mode");
  const refs = blocks.flatMap((b) => [...(b.references || []), ...(b.items || []).flatMap((e) => e.references || [])]);
  const text = blocks.map((b) => b.markdown || (b.items || []).map((e) => [e.title, e.text].filter(Boolean).join(": ")).join("\n")).filter(Boolean).join("\n\n");
  const resolved = refs.map((r) => ({ r, t: realTarget(r) })).filter((x) => x.t).map(({ r, t }) => ({ url: t.url, domain: t.domain, title: r.title || r.source || "" }));
  return { text, citations: uniq(resolved), unresolved: refs.length - resolved.length, present: blocks.length > 0 };
}
function readLlmAnswer(result) {
  const sections = (result?.items || []).filter((i) => i.type === "message").flatMap((m) => m.sections || []);
  const text = sections.map((s) => s.text || "").join("\n").trim();
  const ann = sections.flatMap((s) => s.annotations || []).filter((a) => a?.url);
  const resolved = ann.map((a) => ({ a, t: realTarget({ url: a.url, domain: domainOf(a.url) }) })).filter((x) => x.t).map(({ a, t }) => ({ url: t.url, domain: t.domain, title: a.title || "" }));
  return { text, citations: uniq(resolved), unresolved: ann.length - resolved.length, present: Boolean(text) };
}

export const dataforseo = {
  name: "dataforseo",
  optIn: true, // never started just because credentials exist: it spends money, so it must be named (research.engines) or asked for (aeo job)
  needsGuard: true,
  enabled: (env) => dataforseoEnabled(env),
  /**
   * `guard`: the run's ONE cost guard (costGuardFor), required. `market`: the site's resolved market, required.
   * `mode`: ai_overview (default) | ai_mode | llm_responses. `lang`: one of the market's languages (default: the market's main one).
   * Returns { engine, model, mode, text, citations, costUsd, unresolved, present }; `present` is false when Google showed no AI block.
   */
  async ask(q, { guard, market, mode = "ai_overview", lang, env = process.env } = {}) {
    if (!Object.hasOwn(DFS_PATHS, mode)) throw new Error(`dataforseo: unknown mode "${mode}". Use ai_overview, ai_mode or llm_responses.`);
    const g = requireGuard(guard, "dataforseo");
    const m = inLanguage(requireMarket(market, "dataforseo"), lang);
    const path = DFS_PATHS[mode];
    const model = mode === "llm_responses" ? env.SEO_AI_DATAFORSEO_MODEL || DFS_DEFAULT_LLM_MODEL : mode;
    const task = mode === "ai_overview" ? { keyword: q, location_code: m.locationCode, language_code: m.languageCode, depth: 10, load_async_ai_overview: true }
      : mode === "ai_mode" ? { keyword: q, location_code: m.locationCode, language_code: m.languageCode }
      : { user_prompt: q, model_name: model, web_search: true, web_search_country_iso_code: m.country, max_output_tokens: 1024 };
    let costUsd = 0, t;
    for (let attempt = 0; ; attempt++) {
      const json = await g.post(path, [task], { estimateUsd: DFS_ESTIMATE_USD[mode] });
      costUsd += costOf(json) || 0;
      t = json?.tasks?.[0];
      if (t?.status_code === 20000) break;
      if (attempt === 0 && retryable(t?.status_code)) continue;
      throw new Error(`dataforseo: task status ${t?.status_code ?? "none"} ${clip(t?.status_message)}`);
    }
    const result = t.result?.[0] || {};
    const read = mode === "llm_responses" ? readLlmAnswer(result) : readSerpAnswer(result.items || []);
    return { engine: "dataforseo", model: result.model_name || model, mode, text: read.text, citations: read.citations, unresolved: read.unresolved, present: read.present, costUsd: Number(costUsd.toFixed(6)) };
  },
};

export const ENGINES = [perplexity, openai, anthropic, gemini, dataforseo];
/** Engines with a key, optionally limited to the names listed in the config. Opt-in engines (dataforseo) must be named. */
export const enabledEngines = (env = process.env, only = null) => ENGINES.filter((e) => e.enabled(env) && (!only?.length || only.includes(e.name)) && (!e.optIn || only?.includes(e.name)));
