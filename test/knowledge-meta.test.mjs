// Playbook metadata (D49): review date, version, owner and checked sources are parsed; stale and unsourced playbooks are
// flagged; every playbook that has metadata has it in the right form. Pure; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { playbookMeta, reviewState, metaProblems } from "../src/analysis/knowledge-meta.mjs";

const DOC = `# Pruning

Last reviewed: 2026-11-12 · Version: 2 · Owner: SEO Autopilot maintainers

Body.

## Sources
- [Helpful content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) (Google Search Central, checked 2026-11-12): people-first content.
- [Redirects](https://developers.google.com/search/docs/crawling-indexing/301-redirects) (Google Search Central, checked 2026-11-12): permanent redirects.

## Next
x`;

test("parses review date, version, owner and sources", () => {
  const m = playbookMeta(DOC);
  assert.equal(m.reviewed, "2026-11-12"); assert.equal(m.version, "2"); assert.equal(m.owner, "SEO Autopilot maintainers");
  assert.equal(m.sources.length, 2); assert.deepEqual(m.sources[0], { title: "Helpful content", url: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content", publisher: "Google Search Central", checked: "2026-11-12" });
  assert.deepEqual(metaProblems(DOC, "2026-11-13T00:00:00Z"), []);
  assert.equal(playbookMeta("# X\n\n## Sources, best first\n1. Search Console").sources.length, 0, "a heading about data sources is not a citation list");
});

test("review state: undated, unsourced, current, stale after 90 days", () => {
  assert.equal(reviewState(playbookMeta("# X"), "2026-11-12T00:00:00Z").state, "undated");
  assert.equal(reviewState(playbookMeta("# X\nLast reviewed: 2026-11-12"), "2026-11-12T00:00:00Z").state, "unsourced");
  assert.equal(reviewState(playbookMeta(DOC), "2027-01-01T00:00:00Z").state, "current");
  const s = reviewState(playbookMeta(DOC), "2027-02-12T00:00:00Z");
  assert.equal(s.state, "stale"); assert.equal(s.ageDays, 92);
});

test("problems: malformed source lines, unchecked sources, future dates", () => {
  assert.match(metaProblems("# X\nLast reviewed: 2026-11-12\n\n## Sources\n- Google says so\n")[0], /not in the form/);
  assert.match(metaProblems("# X\nLast reviewed: 2026-11-12\n\n## Sources\n- [A](https://a.test/) (A)\n").join(), /not marked as checked/);
  assert.match(metaProblems(DOC, "2026-01-01T00:00:00Z").join(), /in the future/);
});

test("every playbook with metadata has it in the right form", () => {
  const dir = new URL("../knowledge/", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) assert.deepEqual(metaProblems(readFileSync(new URL(f, dir), "utf8")), [], f);
});
