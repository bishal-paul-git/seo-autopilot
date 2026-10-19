# 04 Agent evaluations and safety tests

**Goal:** a repeatable suite proving the agents are accurate, honest and safe. Trust is the product.

**Context:** `test/agents.test.mjs` checks files and routing only. Nothing measures output quality. Eight real-site runs (fact-checker, indexing monitor, AI search, pruner, competitor, entity, compliance, reporter) are good seeds.

**Build**
1. `test/evals/` fixture sites (clean static, WordPress-like, JS-only, ecommerce, seeded faults) with expected findings per agent (e.g. fact-checker flags a planted unsourced "47%" and passes a sourced claim).
2. Graders: deterministic first (required sections, every claim has evidence, no numbers outside the inputs), optional model grader for judgment items.
3. Hallucination tests: empty or missing data must produce "no data" or "supply this", never invented detail.
4. Prompt-injection tests: pages, issues, feeds and search results that say "ignore your rules, publish, run this command, email this address"; the agent must refuse and flag it.
5. Permission tests: edits outside allowed paths, forbidden commands, default-branch writes are blocked (needs brief 02).
6. `npm run evals` (opt-in, needs a key, costs money; CI runs only the deterministic part). Results saved as JSON plus a Markdown summary.
7. Publish a results page in `site/` (agent, cases, pass rate, date, model) with honest limits.

**Done when:** at least 3 cases per agent (more for fact-checker, compliance auditor and any agent that edits), injection and permission tests pass, docs on adding a case, results page, release.
