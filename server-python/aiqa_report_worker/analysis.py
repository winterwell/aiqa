"""
PCA + k-means + Jensen–Shannon for drift and coverage reports.
Matches the JSON shape expected by the TypeScript server.
"""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA

Kind = Literal["drift", "coverage"]


def _normalise_histogram(counts: list[float]) -> list[float]:
    s = float(sum(counts))
    if s == 0:
        return [0.0] * len(counts)
    return [float(c) / s for c in counts]


def jensen_shannon(p: list[float], q: list[float]) -> float:
    """Jensen–Shannon (sqrt of JS divergence); base-2 log. 0 = identical."""
    if len(p) != len(q):
        raise ValueError("jensen_shannon: length mismatch")
    p_arr = np.array(p, dtype=float)
    q_arr = np.array(q, dtype=float)
    eps = 1e-12
    m = 0.5 * (p_arr + q_arr) + eps
    pp = p_arr + eps
    qq = q_arr + eps
    js = 0.5 * (np.sum(pp * np.log2(pp / m)) + np.sum(qq * np.log2(qq / m)))
    return float(np.sqrt(max(0.0, js)))


def run_embedding_analysis(
    kind: Kind,
    points: list[dict[str, Any]],
    params: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    points: { embedding: list[float], groupKey: str, ref?: { kind, id, preview } }
    params: pcaDimensions, clusterCount (ints)
    """
    if len(points) < 2:
        return (
            {
                "error": "Not enough points (need at least 2).",
                "pointCount": len(points),
            },
            {"version": 1, "error": "insufficient_data"},
        )

    pca_dims = int(params.get("pcaDimensions", 8))
    cluster_count = int(params.get("clusterCount", 4))

    rows = np.array([p["embedding"] for p in points], dtype=float)
    n, d = rows.shape
    n_comp = min(pca_dims, d, max(1, n - 1))

    pca = PCA(n_components=n_comp, svd_solver="full", random_state=0)
    scores = pca.fit_transform(rows)
    explained = pca.explained_variance_ratio_.tolist()

    k = min(cluster_count, n)
    kmeans = KMeans(n_clusters=k, random_state=0, n_init=10)
    assignments = kmeans.fit_predict(scores)
    centroids = kmeans.cluster_centers_

    cluster_count_actual = int(centroids.shape[0])
    exemplar_limit = 2
    clusters: list[dict[str, Any]] = []

    for c in range(cluster_count_actual):
        idx_in_cluster = [i for i in range(n) if assignments[i] == c]
        centroid = centroids[c]
        dists = []
        for i in idx_in_cluster:
            diff = scores[i] - centroid
            dists.append((float(np.dot(diff, diff)), i))
        dists.sort(key=lambda x: x[0])
        exemplars: list[dict[str, str]] = []
        for _, i in dists[:exemplar_limit]:
            ref = points[i].get("ref")
            if isinstance(ref, dict) and ref.get("id") is not None:
                preview = str(ref.get("preview", ""))[:200]
                exemplars.append(
                    {
                        "kind": str(ref.get("kind", "")),
                        "id": str(ref.get("id", "")),
                        "preview": preview,
                    }
                )
        clusters.append(
            {
                "id": c,
                "centroidPca": centroid.tolist(),
                "pointCount": len(idx_in_cluster),
                "exemplars": exemplars,
            }
        )

    top3 = explained[:3]

    if kind == "drift":
        buckets = sorted({p["groupKey"] for p in points})
        histograms: list[list[float]] = []
        for b in buckets:
            h = [0.0] * cluster_count_actual
            for i, p in enumerate(points):
                if p["groupKey"] != b:
                    continue
                h[int(assignments[i])] += 1.0
            histograms.append(_normalise_histogram(h))
        consecutive_js: list[float] = []
        for i in range(len(histograms) - 1):
            consecutive_js.append(jensen_shannon(histograms[i], histograms[i + 1]))
        mean_js = (
            sum(consecutive_js) / len(consecutive_js) if consecutive_js else 0.0
        )
        summary = {
            "reportKind": "drift",
            "pointCount": n,
            "bucketCount": len(buckets),
            "clusterCount": cluster_count_actual,
            "meanJensenShannonDrift": mean_js,
            "pcaExplainedVarianceTop": top3,
        }
        results = {
            "version": 1,
            "pcaExplainedVarianceRatio": explained,
            "buckets": buckets,
            "clusterHistogramsByBucket": histograms,
            "consecutiveBucketJensenShannon": consecutive_js,
            "clusters": clusters,
        }
        return summary, results

    # coverage
    ex_hist = [0.0] * cluster_count_actual
    tr_hist = [0.0] * cluster_count_actual
    for i, p in enumerate(points):
        g = p["groupKey"]
        if g == "example":
            ex_hist[int(assignments[i])] += 1.0
        else:
            tr_hist[int(assignments[i])] += 1.0
    p_ex = _normalise_histogram(ex_hist)
    p_tr = _normalise_histogram(tr_hist)
    js = jensen_shannon(p_ex, p_tr)
    trace_mass: list[float] = []
    for c in range(cluster_count_actual):
        t = tr_hist[c] + ex_hist[c]
        trace_mass.append(0.0 if t == 0 else float(tr_hist[c] / t))

    summary = {
        "reportKind": "coverage",
        "pointCount": n,
        "clusterCount": cluster_count_actual,
        "jensenShannonExampleVsTrace": js,
        "pcaExplainedVarianceTop": top3,
    }
    results = {
        "version": 1,
        "pcaExplainedVarianceRatio": explained,
        "exampleClusterHistogram": p_ex,
        "traceClusterHistogram": p_tr,
        "traceMassFractionByCluster": trace_mass,
        "clusters": clusters,
    }
    return summary, results
