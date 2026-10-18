# Departments: proposed organisation of the agent team

Status: **proposal, not implemented.** It needs owner approval before any file moves (decision D16 in `docs/implementation/DECISIONS.md`). The evidence for the problems it solves is in `docs/research/AGENT-AUDIT-2026-10-18.md`. Sources for the SEO, AEO and GEO practice it encodes are in `docs/research/REFERENCES.md`.

## Why change
Today 27 agents sit in one flat folder, and 26 playbooks in another. That works, but:
- **Ownership is fuzzy.** Three agents touch Organization markup; three touch merges.
- **Orchestration is advisory.** The coordinator's rules (one owner per problem, fact-check before review) are prompt text, not code.
- **Gaps are invisible.** No department shows that backlinks, logs, rank tracking and AI citations have no data behind them.

Departments make ownership, hand-offs and gaps visible without adding chaos.

## Design rules (to keep it manageable)
1. **Three levels, never more:** department, then agent, then skill. A department is a folder. An agent is one Markdown file. A skill is a reusable procedure, one folder with a `SKILL.md`.
2. **Every agent belongs to exactly one department.** Each problem type has one owning agent (see the ownership table).
3. **Skills are shared, agents are not.** A skill like "write answer-first copy" can be listed by several agents, but it lives in one place. Playbooks (`knowledge/`) remain the shared reference library; a skill says *how to do* a task, a playbook says *what is true*.
4. **No agent without a data source or a validator.** A new agent is added only if a job feeds it real data (or an owner-supplied export) and an eval case grades it. Otherwise it stays a skill of an existing agent.
5. **A human approves anything that goes live.** This rule is unchanged.

## Proposed layout
```
departments/
  README.md                      # the org chart, ownership table, pipeline
  command/                       # Command: plan, sequence, report
    README.md                    # charter: mission, inputs, outputs, hand-offs
    agents/seo-coordinator.md  seo-strategist.md  seo-onboarder.md  seo-reporter.md
  research/                      # Research and intelligence
    agents/seo-researcher.md  seo-competitor-analyst.md
    agents/seo-serp-watcher.md            # NEW (needs citations/SERP provider)
  technical/                     # Audit and monitor
    agents/seo-technical-fixer.md  seo-performance-fixer.md  seo-indexing-monitor.md
           seo-redirect-guardian.md  seo-migration-planner.md  seo-schema-engineer.md
           seo-international.md  seo-media-optimizer.md
    agents/seo-log-analyst.md             # NEW (needs owner-supplied access logs)
  content/                       # On-page and content
    agents/seo-drafter.md  seo-refresher.md  seo-content-pruner.md
           seo-cannibalization-resolver.md  seo-snippet-optimizer.md
    agents/seo-internal-linker.md         # NEW (links job already exists)
  authority/                     # Off-page: backlinks, digital PR, entity
    agents/seo-link-builder.md  seo-entity-reputation.md
    agents/seo-backlink-auditor.md        # NEW (Search Console links export)
    agents/seo-digital-pr.md              # NEW (skill first; agent only with data)
  ai-search/                     # AEO, GEO, AI Overviews and AI Mode
    agents/seo-ai-search-agent.md         # renamed later to seo-answer-engine
    agents/seo-ai-citation-tracker.md     # NEW (citations job + provider key)
  verticals/                     # Local, e-commerce (news/Discover later)
    agents/seo-local-agent.md  seo-ecommerce.md
  quality/                       # Validators: nothing ships without them
    agents/seo-fact-checker.md  seo-compliance-auditor.md  seo-editor.md
  skills/                        # shared skills, referenced by name from agents
    answer-first-copy/SKILL.md  redirect-map/SKILL.md  outreach-draft/SKILL.md ...
knowledge/                       # unchanged: shared playbooks, now with sources and dates
```
This moves 27 existing agents and adds 7 new ones, giving 34. The new ones come in the order of the roadmap below, not all at once.

## Ownership (one owner per problem)
| Problem | Owner | May advise |
|---|---|---|
| Organization / `sameAs` / entity markup | schema-engineer | entity-reputation (facts), ai-search |
| Merge, prune, consolidate | cannibalization-resolver (overlap) / content-pruner (weak pages) | refresher |
| Orphan and deep pages, internal links | internal-linker (new) | content |
| Headings, titles, meta | snippet-optimizer | refresher |
| Doorway location pages | local-agent | compliance-auditor validates |
| Answer passages, AI crawler access, llms.txt stance | ai-search | technical-fixer edits robots.txt |
| Backlink risk, disavow advice | backlink-auditor (new) | compliance-auditor |

## How work flows (one after another, or in parallel)
Every run is a **work order** moving through fixed stages. The router turns reports into work orders, and each stage has a named owner:

```
monitor -> diagnose -> plan -> execute -> validate -> approve -> measure
(jobs)     (dept agent) (strategist/ (owner agent  (quality dept  (human)   (reporter,
                         coordinator)  on a branch)  + checks)                experiments)
```

- **Work order contract:** each agent returns the same envelope (JSON in `seo/reports/work/<id>.json`):
  - `id`, `agent`, `department`;
  - `targets` (URLs and files), `evidence` (report and finding ids);
  - `proposal` (diff, PR, issue or advice), `confidence`, `needs_validation` (which validators), `status`.
  
  The validator for this envelope is a pure function in `src/analysis/`, tested like the rest.
- **Sequencing in code, not prompts:** the router produces a dependency graph instead of fixed phases. Examples:
  - `block` items, such as noindex or robots, precede content work on the same URLs;
  - the fact-checker precedes the editor;
  - redirects precede pruning.
- **Parallel safety by locks:** two work orders may run at once only if their `targets` don't overlap. A lock file, `seo/reports/work/locks.json`, is checked by the router and by the workflow before starting an agent. Different departments working on different URLs run in parallel; the same URL never does.
- **Validation is mandatory:** a work order cannot become a PR or issue for approval until its `needs_validation` checks pass. The checks:
  - deterministic: build, `facts --strict`, schema validation, redirect check;
  - agents: fact-checker for any new claim, compliance for regulated (YMYL) or spam-policy risk, editor for every content PR.
- **Approval binds** to exact revision, destination and operation (the brief's rule). The approval-gate gaps F1 and F2 must be closed before any of this runs unattended.

## AEO, GEO and AI Overviews in this design
These are not separate magic tricks. They sit on the same foundations, so they are spread across departments:
- **Technical:** AI crawler access (robots rules per user agent), rendering, indexability.
- **Content:** answer-first passages, clear entities, sourced figures and quotations. The GEO paper's tested methods are listed in REFERENCES.
- **Authority:** mentions and citations on third-party sites, which AI answers draw on.
- **AI-search department:** measuring which questions cite you, using provider APIs (`citations`) and referral traffic from AI products in analytics. It reports gaps to content and authority; it does not rewrite pages itself.

Claims about "ranking in ChatGPT" stay directional and measured, never promised (project rule 2).

## Roadmap (smallest useful steps first)
1. **Reorganise without changing behaviour.**
   - Create `departments/`, move the agent files, and make loaders recurse:
     - `src/cli/init.mjs` and `upgrade`;
     - `engines/python/seo_engine/agentdef.py`;
     - `scripts/build-site.mjs`;
     - `test/agents.test.mjs`;
     - the workflow templates that name agent paths.
   - Agent names stay unique and unchanged, so nothing that calls an agent by name breaks.
   - Add each department README.
   - Acceptance: tests green; `init` and `upgrade` in a temp repo place agents correctly; site renders the org chart.
2. **Fix ownership and inputs.** Router mismatches, the seven missing report names, overlaps (table above). Acceptance: router tests per rule; grep test that every report the router sends appears in the receiving agent's Inputs.
3. **Work orders and validation in code.** Envelope, validator, dependency graph, locks; the fact-checker in the PR pipeline. Acceptance: unit tests; one end-to-end dry run on Erudience.
4. **Sourced playbooks.** Every playbook gets "Sources" (from REFERENCES.md) and "Last reviewed" dates; a test fails if a playbook has none or is older than 12 months.
5. **New agents, one at a time, each with data and evals.** The internal-linker was added early, in step 2, because its data already existed. The rest, in order:
   1. internal-linker: the data exists.
   2. ai-citation-tracker: needs a provider key.
   3. backlink-auditor: Search Console links export.
   4. log-analyst: owner uploads logs.
   5. serp-watcher.
   6. digital-pr: skill first.
6. **Real-output evals:** at least 3 cases per agent graded on recorded outputs (brief 04).

## Naming (owner decision)
The product is **SEO Autopilot**. Changing the brand needs your explicit approval (project rule) and costs SEO on the existing name, GitHub stars and links.

"Autopilot" slightly contradicts "a human approves everything". Options:
1. **Keep "SEO Autopilot"** and call the agent organisation **"the Search Desk"**: a desk with departments, run by a person. (Recommended: no brand cost.)
2. Rename the product. Candidates: **Search Desk**, **SERPworks**, **Rankwright**. Any of these needs a trademark and domain check first; none is checked.
3. Keep the name and present the departments as **"SEO Autopilot Teams"**.
