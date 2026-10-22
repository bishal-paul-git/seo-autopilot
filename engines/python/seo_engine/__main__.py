"""Command line: python -m seo_engine <deepdive|forecast|agent|doctor> ..."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
from pathlib import Path

from . import __version__, anomaly, cluster, forecast, runner, tools
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


def _forecast(a) -> int:
    state = State(a.state_dir, a.data_dir)
    daily = state.json("page-daily.json", {}) or {}
    totals = anomaly.site_totals(daily) if daily else {}
    result = {"generatedAt": utc_today(), "engine": f"python {sys.version.split()[0]} / seo-engine {__version__}",
              "site": {m: forecast.expected_vs_actual(totals, m) for m in ("clicks", "impressions")} if totals else {},
              "pages": forecast.pages_off_course(daily) if daily else []}
    out = Path(a.state_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "forecast.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    lines = [f"# Traffic against its normal range {result['generatedAt']}", "",
             "Holt-Winters baseline (level, trend and weekly pattern) fitted on your own Search Console history, excluding the last 28 days, then compared with what happened. Outside the range means a real change worth explaining; the range is approximate (about 95%, on the narrow side).", ""]
    site = result["site"]
    if not any(site.values()):
        lines.append("Not enough daily history yet: the comparison needs about 12 weeks (the daily job builds it up).")
    for m, r in site.items():
        if r:
            lines.append(f"- **{m}** {r['from']} to {r['to']}: {r['actual']} actual vs {r['expected']} expected (normal range {r['low']} to {r['high']}): **{r['verdict']}**. Next 28 days at this pace: about {r['next28']}.")
    if result["pages"]:
        lines += ["", "## Pages outside their own normal range", ""] + [f"- {p['page']}: {p['actual']} vs {p['expected']} expected ({p['verdict']})" for p in result["pages"]]
    (out / "forecast.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
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
    for name in ("deepdive", "forecast", "agent"):
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
    return {"deepdive": _deepdive, "forecast": _forecast, "agent": _agent, "doctor": _doctor}[a.cmd](a)


if __name__ == "__main__":
    raise SystemExit(main())
