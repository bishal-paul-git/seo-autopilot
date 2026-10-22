// AI visibility: name detection, citation matching, run variance, engine parsing (mocked) and the job.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mentions, analyse, setHash } from "../src/analysis/ai-visibility.mjs";
import { perplexity, openai, anthropic, gemini, enabledEngines } from "../src/lib/ai-engines.mjs";

test("mentions: whole words, any case, longest alias first; no match inside other words", () => {
  assert.deepEqual(mentions("Try ACME Plumbing or acme for leaks.", ["Acme", "Acme Plumbing"]), ["Acme Plumbing"]);
  assert.deepEqual(mentions("Acmeworks is different", ["Acme"]), []);
  assert.deepEqual(mentions("Zürich Bäckerei is good", ["Bäckerei"]), ["Bäckerei"]);
});

test("analyse: a question counts as cited for an engine when at least half its runs cite the site; competitors and sources", () => {
  const a = (q, engine, run, text, ...domains) => ({ q, engine, run, text, citations: domains.map((d) => ({ url: `https://${d}/p`, domain: d })) });
  const r = analyse([
    a("best plumber", "perplexity", 1, "Acme is good", "acme.test", "rival.test"), a("best plumber", "perplexity", 2, "Rival Co is good", "rival.test"),
    a("fix a leak", "perplexity", 1, "Turn off the water", "diy.test"), a("fix a leak", "perplexity", 2, "Call a plumber", "diy.test"),
    a("best plumber", "openai", 1, "Rival Co", "www.rival.test"), { q: "fix a leak", engine: "openai", run: 1, error: "openai: HTTP 429" },
  ], { domain: "www.acme.test", names: ["Acme"], competitors: [{ name: "Rival Co", domain: "rival.test" }] });
  const cell = r.cells.find((c) => c.q === "best plumber" && c.engine === "perplexity");
  assert.deepEqual([cell.runs, cell.citedRuns, cell.cited, cell.mentioned, cell.citationRank], [2, 1, true, true, 1]);
  assert.deepEqual(r.byEngine.perplexity, { questions: 2, mentioned: 1, cited: 1, share: 0.5 });
  assert.equal(r.failed, 1); assert.equal(r.totals.answers, 5); assert.equal(r.totals.cited, 1);
  assert.deepEqual(r.competitors[0], { name: "Rival Co", domain: "rival.test", mentioned: 2, cited: 3, answers: 5 });
  assert.deepEqual(r.gaps.map((g) => g.q), ["fix a leak"]);
  assert.equal(r.topSources[0].domain, "rival.test");
  assert.equal(setHash(["b", "a"]), setHash(["a", "b"]), "order does not change the set");
});

const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test("engines: request shapes and citation parsing for Perplexity, OpenAI, Anthropic and Gemini", async () => {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (url.includes("perplexity")) return res({ choices: [{ message: { content: "Acme" } }], citations: ["https://acme.test/a"], search_results: [{ url: "https://b.test/", title: "B" }] });
    if (url.includes("openai")) return res({ output: [{ type: "web_search_call" }, { type: "message", content: [{ type: "output_text", text: "Answer", annotations: [{ type: "url_citation", url: "https://acme.test/x", title: "X" }] }] }] });
    if (url.includes("anthropic")) return res({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "server_tool_use" }, { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://read.test/", title: "R" }] }, { type: "text", text: "Acme fixes leaks", citations: [{ type: "web_search_result_location", url: "https://acme.test/y", title: "Y" }] }] });
    if (url.includes("generativelanguage")) return res({ candidates: [{ content: { parts: [{ text: "G" }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "acme.test" } }] } }] });
    return res({}, 404);
  };
  const env = { PERPLEXITY_API_KEY: "pk", OPENAI_API_KEY: "ok", ANTHROPIC_API_KEY: "ak", GEMINI_API_KEY: "gk" };
  const p = await perplexity.ask("q", { fetch: f, env });
  assert.deepEqual(p.citations.map((c) => c.domain), ["b.test", "acme.test"]); assert.equal(calls[0].body.model, "sonar");
  const o = await openai.ask("q", { fetch: f, env });
  assert.deepEqual(o.citations.map((c) => c.url), ["https://acme.test/x"]); assert.deepEqual(calls[1].body.tools, [{ type: "web_search" }]);
  const a = await anthropic.ask("q", { fetch: f, env });
  assert.deepEqual(a.citations.map((c) => c.url), ["https://acme.test/y"]); assert.deepEqual(a.sources.map((c) => c.url), ["https://read.test/"]);
  assert.equal(calls[2].body.model, "claude-opus-5-5"); assert.equal(calls[2].body.tools[0].type, "web_search_20260209");
  assert.equal(calls[2].body.fallbacks, "default"); assert.equal(calls[2].headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  const g = await gemini.ask("q", { fetch: f, env });
  assert.deepEqual(g.citations.map((c) => c.domain), ["acme.test"], "domain from the title of a Google redirect link");
  assert.equal(calls[3].headers["x-goog-api-key"], "gk");
  const refused = await anthropic.ask("q", { fetch: async () => res({ stop_reason: "refusal", content: [] }), env });
  assert.equal(refused.refused, true);
  await assert.rejects(() => openai.ask("q", { fetch: async () => res({}, 401), env }), (e) => /key rejected/.test(e.message) && !e.message.includes("ok\""));
  assert.deepEqual(enabledEngines({ GEMINI_API_KEY: "x", OPENAI_API_KEY: "y" }, ["gemini"]).map((e) => e.name), ["gemini"]);
});

test("ai-visibility job: refuses the example list, asks questions x engines x runs, keeps evidence and history", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-aiv-")); const state = join(root, "state"); mkdirSync(state);
  const site = { id: "s", name: "Acme", url: "https://acme.test/", research: { aliases: ["Acme Ltd"] }, paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/ai-visibility.mjs");
  const log = console.log; const out = []; console.log = (x) => out.push(String(x));
  let n = 0;
  const f = async () => { n++; return res({ choices: [{ message: { content: n % 2 ? "Acme Ltd is a good choice" : "Try anyone" } }], citations: n % 2 ? ["https://acme.test/"] : [] }); };
  try {
    writeFileSync(join(root, "questions.json"), JSON.stringify(["REPLACE THESE: ...", "x"]));
    await run({ site, flags: {} }, { env: { PERPLEXITY_API_KEY: "k" }, fetch: f, delayMs: 0 });
    assert.equal(n, 0); assert.match(out.join("\n"), /example list/);
    writeFileSync(join(root, "questions.json"), JSON.stringify(["best plumber", "fix a leak"]));
    await run({ site, flags: { runs: 2 } }, { env: { PERPLEXITY_API_KEY: "k" }, fetch: f, delayMs: 0 });
  } finally { console.log = log; }
  assert.equal(n, 4, "2 questions x 1 engine x 2 runs");
  const r = JSON.parse(readFileSync(join(state, "ai-visibility.json"), "utf8"));
  assert.equal(r.totals.answers, 4); assert.equal(r.totals.cited, 2); assert.equal(r.answers.length, 4); assert.equal(r.history.length, 1);
  assert.match(readFileSync(join(state, "ai-visibility.md"), "utf8"), /Cited as a source in \*\*50%\*\*/);
});
