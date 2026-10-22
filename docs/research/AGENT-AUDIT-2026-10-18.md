# Agent, playbook and job audit (2026-10-18)

Static review of `bd8a5f4` (v2.14.0). Nothing was changed. `npm test` 258/258. Evidence is file paths and line counts; grades are judgement.

## Agents (27; 40 to 48 lines each)
Every agent has the same sections: Mission, Read first, Inputs, Method (6 to 9 steps), Quality bar, Never, Output, Project rules. All read `site-profile.json` first, and all have the injection rule. Tests check structure only (`test/agents.test.mjs`). Four eval cases (`test/evals/cases.json`) are graded on hand-written samples; **no real agent output has been evaluated**.

Grades are 1 to 5 for specificity, grounding, safety and testability.

| Agent | Grades | Verdict |
|---|---|---|
| ai-search-agent | 3/3/4/2 | Good answer-first method; `citations` data not in its inputs |
| cannibalization-resolver | 4/4/4/2 | Sharp; confirms before acting |
| competitor-analyst | 3/3/4/2 | No SERP data source |
| compliance-auditor | 3/2/5/2 | Inputs omit `consent.json` and `ymyl.json`, which the router sends it |
| content-pruner | 4/3/5/2 | Protects backlinks and conversions |
| coordinator | 3/4/4/1 | Only orchestrator; rules are prompt-only |
| drafter | 4/3/5/2 | One page, queued, never default branch |
| ecommerce | 3/2/4/1 | No product or feed job |
| editor | 4/3/5/2 | Applies the review gate label |
| entity-reputation | 3/2/5/1 | No data job |
| fact-checker | 5/5/5/3 | Best grounded; backed by the `facts` job |
| indexing-monitor | 4/4/5/2 | Good request-list hygiene |
| international | 4/3/4/2 | Correct hreflang rules |
| link-builder | 3/2/5/1 | Ethical; no backlink data |
| local-agent | 3/2/5/1 | No Business Profile data |
| media-optimizer | 3/3/4/2 | Only trigger is `images-no-alt` |
| migration-planner | 4/2/4/1 | Never routed; no inventory job |
| onboarder | 4/4/5/1 | Good access checklist |
| performance-fixer | 4/4/4/2 | Field vs lab, INP current |
| redirect-guardian | 5/5/4/2 | Tied to a tested job |
| refresher | 4/3/5/2 | "Diagnose before editing" |
| reporter | 4/4/5/3 | Honest uncertainty |
| researcher | 4/4/5/3 | Complete brief template |
| schema-engineer | 4/3/5/2 | Visible-content-only markup |
| snippet-optimizer | 4/4/4/2 | Inputs omit `quality.json` |
| strategist | 4/4/5/3 | Max 5 actions; small-data warning |
| technical-fixer | 4/4/4/2 | Only agent with shell; supervised |

Overlaps:
- entity-reputation, ai-search-agent and schema-engineer all touch Organization markup and `sameAs`.
- pruner, cannibalization-resolver and refresher all touch merges.
- local and compliance both touch doorway pages.

Router mismatches (`src/analysis/agent-router.mjs`):
- `orphan` and `deep` go to the content-pruner, though an orphan page needs links.
- Heading and link findings go to the refresher.
- Seven report names the router sends appear in no agent's Inputs: `consent`, `ymyl`, `quality`, `links`, `render`, `citations`, `pace`.

Never routed: drafter and editor (run by workflows), migration-planner (no trigger) and coordinator.

## Playbooks (26)
Typical length is 25 to 36 lines, a senior SEO's cheat sheet. The two recipes are deeper: consent at 179 lines and conversions at 66, both with tested code. **None of the 24 non-recipe playbooks cites a source or a date**, so drift cannot be detected.

Thin or dated areas:
- digital PR;
- local (no Business Profile data, reviews or rank grid);
- e-commerce (no Merchant Center, variants or returns markup);
- video (no key moments or video indexing);
- experiments (no control group);
- `site-platforms` (2 bullets);
- structured-data mentions the FAQ and HowTo changes but gives no dates;
- the technical checklist does not name INP or its thresholds.

## Jobs (35 registered; STATUS said 29)

| Kind | Jobs | Status |
|---|---|---|
| Real data, used daily by Erudience earlier | daily, digest, speed | Not re-checked this session |
| Crawl-based, compared with a local Erudience build | audit, links, quality, render, redirects, facts | Done |
| Mocked only | citations, conversions, backlinks submitter | Never run live |
| Unit or fixture tests | geo, profile, consent, ymyl, mentions, news, indexnow, schedule, release, pace, priorities, team, experiments, dashboard | Experiments is before/after with no control |

## Orchestration today
1. **Deterministic router.** Saved reports become a phased plan: onboard, block, fix, content, grow, report. Each agent appears once, with the evidence for it. The output is a weekly issue with paste-ready prompts. **Nothing executes it automatically.**
2. **Coordinator agent.** Interactive, prompt-only rules, sequential by design.
3. **GitHub pipeline**, the only automated chain:
   - a person adds the `approved` label;
   - the drafter or refresher opens a PR;
   - a read-only build check runs;
   - the editor agent reviews;
   - a person merges;
   - drip release.

The validators are the build check, the editor and the `facts` job. The fact-checker agent is not in the pipeline. The Python runtime runs only the strategist and researcher headless, with 9 sandboxed tools and a budget cap.

## Missing or nominal areas
- log files and crawl budget;
- backlink data;
- rank and SERP-feature tracking;
- live AI-citation tracking, including AI Overviews and AI Mode;
- Business Profile and local rank;
- Merchant Center and feeds;
- Knowledge Graph and brand SERP;
- video indexing;
- keyword volume and difficulty;
- Bing Webmaster data;
- News and Discover.

## Verdict
This is a careful, safety-first toolkit for a solo operator or small agency.

- **Strong:** technical audit, Search Console analysis and content governance. These are deterministic and partly verified on a real site.
- **Weak:** first-party data for links, rankings, volume, local and AI citations, and real-output testing of the agents.

Cheapest high-value next steps:
1. Record real agent outputs and grade them.
2. Add sources and dates to the playbooks.
3. Fix the router mismatches.
4. Close the approval-gate gaps F1 and F2.
5. Run `citations` live with one provider.
