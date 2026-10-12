"""Spot unusual movements in daily Search Console numbers.

Uses the median and the median absolute deviation (MAD) instead of mean and standard deviation, so a single spike does not
hide the next one. A day is flagged when it is far outside what the previous weeks looked like. Search Console data is lagged
and noisy for small sites, so nothing is reported unless there is enough volume, and every flag carries the numbers behind it.
"""
from __future__ import annotations

import statistics
from datetime import date, timedelta


def _series(daily: dict[str, list], index: int, start: str, end: str) -> list[tuple[str, float]]:
    d0, d1 = date.fromisoformat(start), date.fromisoformat(end)
    out = []
    d = d0
    while d <= d1:
        v = daily.get(d.isoformat())
        out.append((d.isoformat(), float(v[index]) if v else 0.0))
        d += timedelta(days=1)
    return out


def site_totals(page_daily: dict[str, dict[str, list]]) -> dict[str, list]:
    """Sum {page: {day: [clicks, impressions, position]}} into {day: [clicks, impressions, avg position]}."""
    acc: dict[str, list] = {}
    for days in page_daily.values():
        for d, v in days.items():
            a = acc.setdefault(d, [0.0, 0.0, 0.0])
            a[0] += v[0]
            a[1] += v[1]
            a[2] += v[2] * v[1]
    return {d: [a[0], a[1], (a[2] / a[1]) if a[1] else 0.0] for d, a in acc.items()}


def detect(daily: dict[str, list], metric: str = "impressions", baseline_days: int = 28, z: float = 3.5, min_baseline_median: float = 5.0) -> list[dict]:
    """Return days whose value is unusual compared with the baseline window before it (modified z-score on MAD)."""
    idx = {"clicks": 0, "impressions": 1}[metric]
    if len(daily) < baseline_days // 2:
        return []
    days = sorted(daily)
    first, last = days[0], days[-1]
    series = _series(daily, idx, first, last)
    flags = []
    for i in range(7, len(series)):
        window = [v for _, v in series[max(0, i - baseline_days): i]]
        if len(window) < 7:
            continue
        med = statistics.median(window)
        if med < min_baseline_median:
            continue
        mad = statistics.median([abs(v - med) for v in window]) or max(1.0, 0.1 * med)
        score = 0.6745 * (series[i][1] - med) / mad
        if abs(score) >= z:
            flags.append({"day": series[i][0], "metric": metric, "value": series[i][1], "baselineMedian": med, "score": round(score, 1),
                          "direction": "up" if score > 0 else "down", "evidence": f"{series[i][1]:.0f} {metric} vs a typical {med:.0f} over the previous {len(window)} days"})
    return flags


def trend(daily: dict[str, list], metric: str = "impressions", days: int = 28) -> dict | None:
    """Theil-Sen slope over the last `days` days: the median of all pairwise slopes, resistant to outliers."""
    idx = {"clicks": 0, "impressions": 1}[metric]
    if not daily:
        return None
    last = max(daily)
    start = (date.fromisoformat(last) - timedelta(days=days - 1)).isoformat()
    ys = [v for _, v in _series(daily, idx, start, last)]
    if sum(ys) == 0 or len(ys) < 10:
        return None
    slopes = [(ys[j] - ys[i]) / (j - i) for i in range(len(ys)) for j in range(i + 1, len(ys))]
    slope = statistics.median(slopes)
    mean = sum(ys) / len(ys)
    return {"metric": metric, "slopePerDay": round(slope, 3), "relativePerWeek": round(7 * slope / mean, 3) if mean else None, "days": len(ys), "mean": round(mean, 2)}


def page_drops(page_daily: dict[str, dict[str, list]], window: int = 14, min_before: int = 30, drop: float = 0.5) -> list[dict]:
    """Pages whose impressions in the latest `window` days fell by at least `drop` against the `window` days before."""
    if not page_daily:
        return []
    last = max(d for days in page_daily.values() for d in days)
    end2 = date.fromisoformat(last)
    start2 = end2 - timedelta(days=window - 1)
    end1 = start2 - timedelta(days=1)
    start1 = end1 - timedelta(days=window - 1)
    out = []
    for page, days in page_daily.items():
        a = sum(v[1] for d, v in days.items() if start1.isoformat() <= d <= end1.isoformat())
        b = sum(v[1] for d, v in days.items() if start2.isoformat() <= d <= end2.isoformat())
        if a >= min_before and b <= a * (1 - drop):
            out.append({"page": page, "before": a, "after": b, "change": round((b - a) / a, 2), "evidence": f"{a:.0f} impressions in {window} days, then {b:.0f} in the next {window}"})
    return sorted(out, key=lambda x: x["change"])
