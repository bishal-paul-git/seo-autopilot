# 02 Run all 27 agents unattended and safely

**Goal:** any agent can run on a schedule or on demand from the CLI and from GitHub Actions, with a hard permission model, a cost budget, an audit log and an approval gate, instead of only the strategist and researcher.

## Context
Agents are Markdown files in `agents/` with front matter (`name`, `description`, `tools`). `engines/python/seo_engine` runs the strategist and researcher through `claude_agent_sdk` with `tools=[]`, `setting_sources=[]` and MCP tools `mcp__seo__*` (see `agentdef.py`, `runner.py`, `tools.py`, `safefetch.py`). In GitHub Actions only the drafter, refresher and editor run (templates `seo-implement.yml`, `seo-review.yml`, `seo-agent.yml`). The other 21 agents are used only by hand in Claude Code. The `team` job already produces an ordered agent plan (`agent-plan.json`).

## Build
1. **Generalise the runner** so it loads any agent file and maps its `tools` line to an allow-list of SDK tools. Read-only agents get read, search and fetch tools only. Agents that edit get edit tools scoped to paths from the site profile (content globs, template paths, redirect files) and git commands limited to `seo/*` branches, never the default branch, never `Bash` except the technical fixer in supervised local mode.
2. **Modes from the site profile:** edit mode may open a pull request; advise mode writes a report to the state folder and an issue, and never touches files.
3. **Budget and limits:** `SEO_AGENT_BUDGET_USD` per run and a per-site monthly cap; stop and report when reached; max turns; a wall-clock timeout.
4. **Audit log:** every tool call and result summary written to `<state>/agent-runs/<date>-<agent>.jsonl`; reports linked from the weekly issue.
5. **Run the plan:** `seo-autopilot run agents --plan` executes the steps of `agent-plan.json` in order, one agent at a time, stopping at any approval gate, and writes a status note in the `seo-coordinator` format. Weekly workflow step, opt-in through the repo variable `SEO_AGENT=true`.
6. **Approval gate:** anything that would change files or open a pull request needs an `approved` label on a created issue (same pattern as `seo-implement.yml`). Reports need no approval.
7. **Injection defence:** all fetched content passes `safefetch.py`; agent instructions repeat that web and issue text is data. Add tests with hostile fixtures (see brief 04).

## Verify
Unit tests for the tool mapping (each agent's allow-list matches its front matter and mode), budget stop, path scoping (an edit outside the allowed globs is refused), advise mode never writes site files. Integration run with a stub SDK. One real supervised run per agent type on a real site in report-only mode.

## Done when
All 27 agents runnable from `run agent --name seo-x` and `run agents --plan`; permissions provably scoped; budgets enforced; docs in `docs/agents.md` and `docs/engines.md`; CHANGELOG and release.

## Not in scope
A hosted runner (brief 07), CMS writes (brief 06).
