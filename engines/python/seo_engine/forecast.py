"""Forecast daily search traffic and say whether the last weeks were normal.

Holt-Winters exponential smoothing (additive level, trend and weekly season), standard library only. Parameters are chosen by
grid search on one-step-ahead error. The model is fitted on everything except the last `holdout` days, then those days are
compared with what it expected: a fall or rise outside the range is a real change worth explaining; inside it is normal
weekly and seasonal movement. With under 8 weeks of history nothing is claimed.

This is a statistical baseline from the site's own past, not a prediction of what search engines will do.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

PERIOD = 7
GRID = (0.1, 0.3, 0.5, 0.7)
TREND_GRID = (0.0, 0.05, 0.15)


def _fill(daily: dict[str, list], index: int) -> tuple[list[str], list[float]]:
    """Dense day list from the first to the last day, missing days as 0."""
    if not daily:
        return [], []
    d0, d1 = date.fromisoformat(min(daily)), date.fromisoformat(max(daily))
    days, values = [], []
    d = d0
    while d <= d1:
        v = daily.get(d.isoformat())
        days.append(d.isoformat())
        values.append(float(v[index]) if v else 0.0)
        d += timedelta(days=1)
    return days, values


def _run(y: list[float], a: float, b: float, g: float, m: int = PERIOD):
    """One pass of additive Holt-Winters. Returns (sse, level, trend, seasonals, residuals)."""
    season0 = sum(y[:m]) / m
    level, trend = season0, (sum(y[m:2 * m]) - sum(y[:m])) / (m * m)
    seas = [y[i] - season0 for i in range(m)]
    sse, res = 0.0, []
    for t in range(m, len(y)):
        s = seas[t % m]
        pred = level + trend + s
        err = y[t] - pred
        res.append(err)
        sse += err * err
        new_level = a * (y[t] - s) + (1 - a) * (level + trend)
        trend = b * (new_level - level) + (1 - b) * trend
        seas[t % m] = g * (y[t] - new_level) + (1 - g) * s
        level = new_level
    return sse, level, trend, seas, res


def fit(y: list[float], m: int = PERIOD) -> dict | None:
    """Best parameters by one-step-ahead squared error. None with under 8 weeks of data."""
    if len(y) < 8 * m:
        return None
    best = None
    for a in GRID:
        for b in TREND_GRID:
            for g in GRID:
                sse, level, trend, seas, res = _run(y, a, b, g, m)
                if best is None or sse < best["sse"]:
                    best = {"sse": sse, "alpha": a, "beta": b, "gamma": g, "level": level, "trend": trend, "season": seas, "n": len(y), "res": res}
    res = best.pop("res")
    best["sd"] = math.sqrt(sum(r * r for r in res) / max(1, len(res) - 3))
    return best


def predict(model: dict, h: int, m: int = PERIOD) -> list[float]:
    """h days ahead (never below zero; traffic cannot be negative)."""
    n = model["n"]
    return [max(0.0, model["level"] + (i + 1) * model["trend"] + model["season"][(n + i) % m]) for i in range(h)]


def expected_vs_actual(daily: dict[str, list], metric: str = "clicks", holdout: int = 28, lag: int = 3) -> dict | None:
    """Fit on all but the last `holdout` days (ignoring the newest `lag`, which Search Console still revises) and compare."""
    idx = {"clicks": 0, "impressions": 1}[metric]
    days, y = _fill(daily, idx)
    if lag:
        days, y = days[:-lag], y[:-lag]
    if len(y) < 8 * PERIOD + holdout:
        return None
    train, test = y[:-holdout], y[-holdout:]
    model = fit(train)
    if model is None:
        return None
    exp = predict(model, holdout)
    expected, actual = sum(exp), sum(test)
    # Range for a 28-day total: h one-step errors, assumed independent (about 95%). Errors are correlated in practice, so
    # this range is on the narrow side; the verdict is a prompt to look, not proof.
    half = 1.96 * model["sd"] * math.sqrt(holdout)
    low, high = max(0.0, expected - half), expected + half
    verdict = "below the normal range" if actual < low else "above the normal range" if actual > high else "within the normal range"
    change = (actual - expected) / expected if expected else None
    return {
        "metric": metric, "from": days[-holdout], "to": days[-1], "actual": round(actual), "expected": round(expected), "low": round(low), "high": round(high),
        "change": round(change, 3) if change is not None else None, "verdict": verdict,
        "model": {k: model[k] for k in ("alpha", "beta", "gamma")}, "historyDays": len(train),
        "next28": round(sum(predict(fit(y) or model, 28))),
    }


def pages_off_course(page_daily: dict[str, dict[str, list]], metric: str = "clicks", min_expected: float = 30.0, limit: int = 15) -> list[dict]:
    """Pages whose last 28 days fell outside their own normal range, largest shortfall first. Only pages with enough traffic."""
    out = []
    for page, daily in page_daily.items():
        r = expected_vs_actual(daily, metric)
        if r and r["expected"] >= min_expected and r["verdict"] != "within the normal range":
            out.append({"page": page, **{k: r[k] for k in ("actual", "expected", "low", "high", "change", "verdict")}})
    return sorted(out, key=lambda r: (r["actual"] - r["expected"]))[:limit]
