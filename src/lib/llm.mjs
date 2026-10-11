// Optional AI step. Every caller works without it (rule-based fallback), so AI is never required.
// Providers: "anthropic" (default, ANTHROPIC_API_KEY) or "openai" (any OpenAI-compatible chat endpoint,
// OPENAI_API_KEY, optional OPENAI_BASE_URL). Choose with SEO_LLM_PROVIDER and SEO_MODEL.
// Output is always treated as untrusted text.
const provider = () => (process.env.SEO_LLM_PROVIDER || (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : "none"));

export const llmAvailable = () => provider() !== "none";

export const NO_FAKE_RULES = "Hard rules: never invent statistics, prices, percentages, clients, quotes or results. If a fact is not in the input, leave it out. Plain words.";

export async function ask(system, user, { maxTokens = 1500 } = {}) {
  const p = provider();
  if (p === "none") return null;
  try {
    if (p === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: process.env.SEO_MODEL || "claude-sonnet-5-5", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
      });
      if (!res.ok) { console.log(`llm: HTTP ${res.status}`); return null; }
      const j = await res.json();
      return (j.content || []).map((c) => c.text || "").join("").trim() || null;
    }
    const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.SEO_MODEL || "gpt-4o-mini", max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!res.ok) { console.log(`llm: HTTP ${res.status}`); return null; }
    const j = await res.json();
    return j.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) { console.log("llm: failed", e.message); return null; }
}

export async function askJson(system, user, opts) {
  const t = await ask(`${system}\nReply with valid JSON only, no prose.`, user, opts);
  if (!t) return null;
  const m = t.match(/[\[{][\s\S]*[\]}]/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}
