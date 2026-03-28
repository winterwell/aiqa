"""FastAPI app: POST /analyze for report embedding analysis."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from aiqa_report_worker.analysis import run_embedding_analysis

app = FastAPI(title="AIQA Report Worker", version="1.0.0")


class PointModel(BaseModel):
    embedding: list[float]
    groupKey: str
    ref: dict[str, Any] | None = None


class AnalyzeRequest(BaseModel):
    kind: Literal["drift", "coverage"]
    points: list[PointModel]
    params: dict[str, Any] = Field(default_factory=dict)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> dict[str, Any]:
    try:
        points_payload: list[dict[str, Any]] = []
        for p in req.points:
            d: dict[str, Any] = {
                "embedding": p.embedding,
                "groupKey": p.groupKey,
            }
            if p.ref is not None:
                d["ref"] = p.ref
            points_payload.append(d)
        summary, results = run_embedding_analysis(req.kind, points_payload, req.params)
        return {"summary": summary, "results": results}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
