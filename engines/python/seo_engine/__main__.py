"""Command line: python -m seo_engine <deepdive|agent|doctor> ..."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
from pathlib import Path

from . import __version__, anomaly, cluster, runner, tools
from .state import State, utc_today


def _deepdive(a) -> int:
    state = State(a.state_dir, a.data_dir)
    rows = (state.json("gsc-rows.json", None) or {}).get("rows", [])
    daily = state.json("page-daily.json", {}) or {}
    clusters = cluster.cluster_queries(rows)
    totals = anomaly.site_totals(daily) if daily else {}
    result = {
        "generatedAt": utc_today(), "engine": f"python {sys.version.split()[0]} / seo-engine {__version__}",
        "clusters": clusters[:60], "observations": cluster.cluster_findings(clusters),
        "unusualDays": (anomaly.detect(totals, "impressions") + anomaly.detect(totals, "clicks")) if totals else [],
        "trends": [t for t in ((anomaly.trend(totals, "impressions"), anomaly.trend(totals, "clicks")) if totals else ()) if t],
        "pagesLosingVisibility": anomaly.page_drops(daily)[:25] if daily else [],
    }
    out = Path(a.state_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "deepdive.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    lines = [f"# Deep dive {result['generatedAt']}", "", f"Computed with {result['engine']}. Topics are groups of your own queries; they describe your data, not how Google groups results.", ""]
    if not rows:
        lines.append("No Search Console rows saved yet. Run the daily job first.")
    else:
        lines += [f"## Topics ({len(clusters)} from {len(rows)} query/page rows)", ""]
        for c in clusters[:15]:
            lines.append(f"- **{c['label']}**: {c['queries']} queries, {c['impressions']} impressions, {c['clicks']} clicks, average position {c['position']}. Top query: \"{c['topQuery']}\".")
        lines += ["", "## Observations", ""] + ([f"- ({o['kind']}) **{o['topic']}**: {o['evidence']}. {o['suggestion']}" for o in result["observations"]] or ["- none"])
    lines += ["", "## Unusual days", ""] + ([f"- {u['day']} {u['metric']} {u['direction']}: {u['evidence']}" for u in result["unusualDays"][-10:]] or ["- none (or not enough daily data yet)"])
    lines += ["", "## Pages losing visibility", ""] + ([f"- {p['page']}: {p['evidence']} ({round(p['change'] * 100)}%)" for p in result["pagesLosingVisibility"][:10]] or ["- none"])
    (out / "deepdive.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0


def _agent(a) -> int:
    state = State(a.state_dir, a.data_dir)
    root = Path(a.project_root)
    cli = a.cli or os.environ.get("SEO_AUTOPILOT_CLI", "")
    ctx = tools.Context(state=state, site_url=a.site_url, site_id=a.site_id, project_root=root, cli=cli, node=os.environ.get("SEO_AUTOPILOT_NODE", "node"))
    agents_dir = Path(a.data_dir) / "agents"
    try:
        res = asyncio.run(runner.run_agent(a.name, a.task, ctx, agents_dir, max_turns=a.max_turns))
    except (runner.RunnerError, ValueError) as e:
        print(f"seo-engine: {e}", file=sys.stderr)
        return 2
    print(json.dumps(res, indent=1))
    return 0 if res["ok"] else 1


def _doctor(_a) -> int:
    print(f"python {sys.version.split()[0]}  seo-engine {__version__}")
    try:
        import claude_agent_sdk
        print(f"claude-agent-sdk: installed ({getattr(claude_agent_sdk, '__version__', 'version unknown')})")
    except ImportError:
        print("claude-agent-sdk: not installed (only needed to run agents: pip install claude-agent-sdk)")
    print("login: " + ("ANTHROPIC_API_KEY set" if os.environ.get("ANTHROPIC_API_KEY") else "CLAUDE_CODE_OAUTH_TOKEN set" if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") else "no Claude login in this shell (needed to run agents)"))
    print("node: " + (shutil.which("node") or "not found"))
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="seo_engine")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("deepdive", "agent"):
        s = sub.add_parser(name)
        s.add_argument("--state-dir", required=True)
        s.add_argument("--data-dir", required=True)
        if name == "agent":
            s.add_argument("name")
            s.add_argument("--task", required=True)
            s.add_argument("--site-url", default="")
            s.add_argument("--site-id", default="")
            s.add_argument("--project-root", default=".")
            s.add_argument("--cli", default="")
            s.add_argument("--max-turns", type=int, default=24)
    sub.add_parser("doctor")
    a = p.parse_args(argv)
    return {"deepdive": _deepdive, "agent": _agent, "doctor": _doctor}[a.cmd](a)


if __name__ == "__main__":
    raise SystemExit(main())
