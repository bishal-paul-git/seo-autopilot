import test from "node:test";
import assert from "node:assert/strict";
import { botAccess, checkRobots, checkLlmsTxt, checkPage, summariseGeo } from "../src/geo/check.mjs";

test("a specific rule beats the * group", () => {
  const robots = "User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n";
  assert.equal(botAccess(robots, "GPTBot").blocked, true);
  assert.equal(botAccess(robots, "ClaudeBot").blocked, false);
});

test("grouped user agents share rules and an empty Disallow allows", () => {
  const robots = "User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow:\n";
  assert.equal(botAccess(robots, "CCBot").blocked, true);
  assert.equal(botAccess(robots, "PerplexityBot").blocked, false);
});

test("no robots.txt means nothing is blocked", () => {
  assert.equal(botAccess(null, "GPTBot").blocked, false);
});

test("llms.txt detection", () => {
  assert.equal(checkLlmsTxt("", 404).present, false);
  const r = checkLlmsTxt("# Site\n- [A](https://x.com/a)\n- [B](https://x.com/b)", 200);
  assert.equal(r.present, true); assert.equal(r.links, 2); assert.equal(r.hasTitle, true);
});

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

test("answer-first page with question headings and schema scores well", () => {
  const html = `<html><head><title>T</title><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"X","sameAs":["https://linkedin.com/company/x"]},{"@type":"Article","headline":"H","datePublished":"2026-01-01","author":{"@type":"Person","name":"A"}}]}</script></head><body><h1>What is X?</h1><p>${words(30)}</p><h2>How does it work?</h2><p>${words(100)}</p><ul><li>a</li></ul></body></html>`;
  const p = checkPage(html, "https://x.com/a");
  assert.equal(p.answerFirst, true);
  assert.equal(p.questionHeadings, 1);
  assert.equal(p.hasOrgSchema, true);
  assert.equal(p.sameAs, true);
  assert.equal(p.hasAuthor, true);
  assert.equal(p.hasDate, true);
});

test("an empty app shell is flagged as little content in the initial HTML", () => {
  const p = checkPage("<html><head><title>T</title></head><body><div id=root></div><script src=a.js></script></body></html>", "https://x.com/");
  assert.equal(p.contentInInitialHtml, false);
});

test("findings: blocked search bot is high, training-only block is low", () => {
  const pages = [checkPage(`<html><body><h1>T</h1><p>${words(200)}</p></body></html>`, "https://x.com/")];
  const high = summariseGeo({ robots: checkRobots("User-agent: OAI-SearchBot\nDisallow: /\n"), llms: { present: true }, pages });
  assert.equal(high[0].id, "ai-search-blocked"); assert.equal(high[0].severity, "high");
  const low = summariseGeo({ robots: checkRobots("User-agent: GPTBot\nDisallow: /\n"), llms: { present: true }, pages });
  assert.ok(low.find((x) => x.id === "ai-training-blocked" && x.severity === "low"));
  assert.ok(!low.find((x) => x.id === "ai-search-blocked"));
});
