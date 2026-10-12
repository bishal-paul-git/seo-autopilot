"""Group search queries into topics.

Method (deliberately simple and explainable): TF-IDF vectors over lightly stemmed unigrams and bigrams, then a greedy
"leader" assignment. Queries are taken in order of impressions; each joins the existing cluster whose centroid it matches
best (cosine similarity >= threshold) or starts a new one. The result is deterministic, has no dependencies and every
cluster can be explained by the words it shares. It is a way to see topics in your own Search Console data, not a model of
how search engines group results.
"""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict

STOP = frozenset(
    "a an and are as at be by can do does for from how i in is it its my of on or the to vs what when where which who why will with your you "
    "near me best top free".split()
)
_WORD = re.compile(r"[a-z0-9]+")


def stem(word: str) -> str:
    for suffix in ("ingly", "edly", "ing", "ers", "er", "ies", "es", "ed", "s"):
        if len(word) > len(suffix) + 2 and word.endswith(suffix):
            return word[: -len(suffix)] + ("y" if suffix == "ies" else "")
    return word


def terms(query: str) -> list[str]:
    words = [stem(w) for w in _WORD.findall(query.lower()) if w not in STOP and len(w) > 1]
    return words + [f"{a}_{b}" for a, b in zip(words, words[1:])]


def _norm(vec: dict[str, float]) -> dict[str, float]:
    n = math.sqrt(sum(v * v for v in vec.values())) or 1.0
    return {k: v / n for k, v in vec.items()}


def _cos(a: dict[str, float], b: dict[str, float]) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(v * b.get(k, 0.0) for k, v in a.items())


def cluster_queries(rows: list[dict], threshold: float = 0.45, min_impressions: int = 1, max_clusters: int = 200) -> list[dict]:
    """rows: [{query, page, clicks, impressions, position}] (one row per query and page). Returns clusters, biggest first."""
    per_query: dict[str, dict] = {}
    for r in rows:
        q = (r.get("query") or "").strip().lower()
        if not q:
            continue
        a = per_query.setdefault(q, {"query": q, "clicks": 0, "impressions": 0, "pos_weight": 0.0, "pages": Counter()})
        imp = int(r.get("impressions") or 0)
        a["clicks"] += int(r.get("clicks") or 0)
        a["impressions"] += imp
        a["pos_weight"] += float(r.get("position") or 0) * imp
        if r.get("page"):
            a["pages"][r["page"]] += imp
    queries = [v for v in per_query.values() if v["impressions"] >= min_impressions]
    if not queries:
        return []
    for v in queries:
        v["position"] = round(v["pos_weight"] / v["impressions"], 1) if v["impressions"] else 0.0
    docs = {v["query"]: Counter(terms(v["query"])) for v in queries}
    df: Counter = Counter()
    for c in docs.values():
        df.update(c.keys())
    n = len(queries)
    idf = {t: math.log((1 + n) / (1 + d)) + 1.0 for t, d in df.items()}
    vecs = {q: _norm({t: (1 + math.log(c)) * idf[t] for t, c in cnt.items()}) for q, cnt in docs.items()}

    clusters: list[dict] = []
    for v in sorted(queries, key=lambda x: (-x["impressions"], x["query"])):
        vec = vecs[v["query"]]
        best, best_sim = None, 0.0
        for cl in clusters:
            s = _cos(vec, cl["_centroid"])
            if s > best_sim:
                best, best_sim = cl, s
        if best is not None and best_sim >= threshold:
            best["members"].append(v)
            for t, w in vec.items():
                best["_sum"][t] += w
            best["_centroid"] = _norm(dict(best["_sum"]))
        elif len(clusters) < max_clusters:
            clusters.append({"members": [v], "_sum": defaultdict(float, vec), "_centroid": dict(vec)})
        else:  # cluster cap reached: attach to the nearest one rather than lose the query
            if clusters:
                nearest = max(clusters, key=lambda cl: _cos(vec, cl["_centroid"]))
                nearest["members"].append(v)

    out = []
    for cl in clusters:
        m = cl["members"]
        imp = sum(x["impressions"] for x in m)
        pages: Counter = Counter()
        for x in m:
            pages.update(x["pages"])
        shared = Counter()
        for x in m:
            shared.update(set(t for t in docs[x["query"]] if "_" not in t))
        label_terms = [t for t, c in shared.most_common(3) if c > 1] or [t for t, _ in shared.most_common(2)]
        out.append({
            "label": " ".join(label_terms) or m[0]["query"],
            "topQuery": m[0]["query"],
            "queries": len(m),
            "impressions": imp,
            "clicks": sum(x["clicks"] for x in m),
            "position": round(sum(x["position"] * x["impressions"] for x in m) / imp, 1) if imp else 0.0,
            "pages": [{"page": p, "impressions": i} for p, i in pages.most_common(5)],
            "members": [{"query": x["query"], "impressions": x["impressions"], "position": x["position"]} for x in sorted(m, key=lambda z: -z["impressions"])[:10]],
        })
    out.sort(key=lambda c: (-c["impressions"], c["label"]))
    return out


def cluster_findings(clusters: list[dict]) -> list[dict]:
    """Plain-language observations a person can act on. Every one cites the numbers it comes from."""
    notes = []
    for c in clusters[:30]:
        if c["impressions"] >= 20 and c["clicks"] == 0 and c["position"] <= 20:
            notes.append({"kind": "visible-no-clicks", "topic": c["label"], "evidence": f'{c["impressions"]} impressions across {c["queries"]} queries at average position {c["position"]}, 0 clicks', "suggestion": "Check what the result looks like for these queries and whether the title and opening answer the question."})
        if len(c["pages"]) >= 2 and c["impressions"] >= 20:
            top = c["pages"][0]["impressions"] / max(1, sum(p["impressions"] for p in c["pages"]))
            if top < 0.8:
                notes.append({"kind": "split-across-pages", "topic": c["label"], "evidence": f'{len(c["pages"])} pages share the impressions for this topic (largest holds {round(top * 100)}%)', "suggestion": "Decide which page should own the topic; merge or differentiate the others."})
        if c["queries"] >= 5 and c["position"] > 20:
            notes.append({"kind": "demand-without-ranking", "topic": c["label"], "evidence": f'{c["queries"]} related queries, {c["impressions"]} impressions, average position {c["position"]}', "suggestion": "Real demand with weak rankings: a dedicated, better page may be worth writing."})
    return notes
