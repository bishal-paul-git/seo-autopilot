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
import { domainOf } from "./serp.mjs";

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

export const ENGINES = [perplexity, openai, anthropic, gemini];
/** Engines with a key, optionally limited to the names listed in the config. */
export const enabledEngines = (env = process.env, only = null) => ENGINES.filter((e) => e.enabled(env) && (!only?.length || only.includes(e.name)));
