"""Run an agent: a Claude model with the tools from tools.py, bounded by turns, budget and an allowlist.

The model and its login come from the official `claude-agent-sdk` package (install with `pip install claude-agent-sdk`) and the
usual environment (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN). Everything else, the tools, the safety rules and the
logging, is in this package. The SDK import is lazy and the query function can be replaced, so the runtime is testable
without an AI.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from . import agentdef, tools
from .state import utc_today

SERVER = "seo"


class RunnerError(Exception):
    pass


def _sdk():
    try:
        import claude_agent_sdk as sdk
    except ImportError:
        raise RunnerError("the agent runtime needs the Agent SDK: pip install claude-agent-sdk") from None
    return sdk


def build_sdk_tools(sdk, ctx: tools.Context, allowed: list[str]):
    """Wrap the allowed registry functions as SDK tools. Errors become tool errors the model can read, not crashes."""
    built = []
    for name in allowed:
        fn, desc, schema = tools.REGISTRY[name]

        def make(tool_name):
            @sdk.tool(tool_name, tools.REGISTRY[tool_name][1], tools.REGISTRY[tool_name][2])
            async def handler(args):
                try:
                    text = tools.call(ctx, tool_name, dict(args or {}))
                    return {"content": [{"type": "text", "text": text}]}
                except tools.ToolError as e:
                    return {"content": [{"type": "text", "text": f"error: {e}"}], "is_error": True}
                except Exception as e:  # never let a tool bug end the run
                    return {"content": [{"type": "text", "text": f"error: {type(e).__name__}: {e}"}], "is_error": True}
            return handler

        built.append(make(name))
    return built


async def run_agent(name: str, task: str, ctx: tools.Context, agents_dir: Path, max_turns: int = 24, budget_usd: float | None = None, query_fn=None, sdk=None) -> dict:
    """Run one agent to completion. Returns {ok, summary, report, turns, costUsd, toolCalls}."""
    if name not in tools.AGENT_TOOLS:
        raise RunnerError(f"{name} cannot run in this runtime. Runnable agents: {', '.join(sorted(tools.AGENT_TOOLS))}. The drafter, refresher and editor run in GitHub Actions; the technical fixer runs in Claude Code.")
    agent = agentdef.load(agents_dir, name)
    ctx.agent = name
    allowed = tools.AGENT_TOOLS[name]
    prompt = agentdef.system_prompt(agent, ctx.site_url, task)
    if budget_usd is None:
        budget_usd = float(os.environ.get("SEO_AGENT_BUDGET_USD") or "1.5")

    sdk = sdk or _sdk()
    server = sdk.create_sdk_mcp_server(name=SERVER, version="1.0.0", tools=build_sdk_tools(sdk, ctx, allowed))
    options = sdk.ClaudeAgentOptions(
        system_prompt=prompt,
        mcp_servers={SERVER: server},
        tools=[],  # no built-in tools: no shell, no file editing, no web search; only the tools above
        allowed_tools=[f"mcp__{SERVER}__{t}" for t in allowed],
        permission_mode="default",
        max_turns=max_turns,
        max_budget_usd=budget_usd,
        cwd=str(ctx.project_root),
        setting_sources=[],  # do not load the machine's own Claude settings, hooks or memory
    )
    run = query_fn or sdk.query
    texts, result = [], None
    async for msg in run(prompt=task, options=options):
        kind = type(msg).__name__
        if kind == "AssistantMessage":
            for block in getattr(msg, "content", []):
                if type(block).__name__ == "TextBlock":
                    texts.append(block.text)
        elif kind == "ResultMessage":
            result = msg
    report = ctx.state.state_dir / "agent-reports" / f"{name}-{utc_today()}.md"
    summary = (getattr(result, "result", None) or (texts[-1] if texts else "")).strip()
    record = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "agent": name, "task": task[:300], "turns": getattr(result, "num_turns", None),
              "costUsd": getattr(result, "total_cost_usd", None), "error": bool(getattr(result, "is_error", False)), "toolCalls": ctx.log, "reportSaved": report.is_file()}
    log = ctx.state.state_dir / "agent-runs.jsonl"
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
    return {"ok": bool(result) and not record["error"] and report.is_file(), "summary": summary, "report": str(report) if report.is_file() else None,
            "turns": record["turns"], "costUsd": record["costUsd"], "toolCalls": len(ctx.log)}
