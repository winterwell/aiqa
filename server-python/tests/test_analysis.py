"""Core analysis tests (no HTTP)."""

import numpy as np
import pytest

from aiqa_report_worker.analysis import jensen_shannon, run_embedding_analysis


def _emb(seed: str, dim: int = 16) -> list[float]:
    """Deterministic pseudo-embedding (same idea as TS sha256)."""
    import hashlib

    h = hashlib.sha256(seed.encode()).digest()
    vec = []
    for j in range(dim):
        o = (j * 4) % len(h)
        u = h[o] | (h[(o + 1) % len(h)] << 8) | (h[(o + 2) % len(h)] << 16) | (h[(o + 3) % len(h)] << 24)
        vec.append((u & 0xFFFFFFFF) / 0xFFFFFFFF - 0.5)
    a = np.array(vec, dtype=float)
    n = float(np.linalg.norm(a)) or 1.0
    return (a / n).tolist()


def test_jensen_shannon_identical():
    p = [0.25, 0.25, 0.25, 0.25]
    assert jensen_shannon(p, p) < 1e-6


def test_drift_smoke():
    points = [
        {
            "embedding": _emb("a"),
            "groupKey": "2026-01",
            "ref": {"kind": "span", "id": "1", "preview": "a"},
        },
        {
            "embedding": _emb("b"),
            "groupKey": "2026-01",
            "ref": {"kind": "span", "id": "2", "preview": "b"},
        },
        {
            "embedding": _emb("c"),
            "groupKey": "2026-02",
            "ref": {"kind": "span", "id": "3", "preview": "c"},
        },
        {
            "embedding": _emb("d"),
            "groupKey": "2026-02",
            "ref": {"kind": "span", "id": "4", "preview": "d"},
        },
    ]
    s, r = run_embedding_analysis("drift", points, {"pcaDimensions": 4, "clusterCount": 2})
    assert s["reportKind"] == "drift"
    assert "buckets" in r


def test_coverage_smoke():
    points = [
        {"embedding": _emb("ex1"), "groupKey": "example", "ref": {"kind": "example", "id": "e1", "preview": "x"}},
        {"embedding": _emb("ex2"), "groupKey": "example", "ref": {"kind": "example", "id": "e2", "preview": "y"}},
        {"embedding": _emb("tr1"), "groupKey": "trace", "ref": {"kind": "span", "id": "s1", "preview": "z"}},
        {"embedding": _emb("tr2"), "groupKey": "trace", "ref": {"kind": "span", "id": "s2", "preview": "w"}},
    ]
    s, r = run_embedding_analysis("coverage", points, {"pcaDimensions": 4, "clusterCount": 2})
    assert s["reportKind"] == "coverage"
    assert "jensenShannonExampleVsTrace" in s


def test_insufficient_data():
    s, r = run_embedding_analysis("drift", [], {})
    assert r.get("error") == "insufficient_data"
