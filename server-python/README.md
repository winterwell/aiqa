# server-python

Small **FastAPI** service used by the main Node (`server`) app for **Report** analysis: joint PCA, k-means, and drift/coverage metrics over embedding vectors.

## Setup

```bash
cd server-python
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Run

Default bind: `127.0.0.1:8765`.

```bash
PYTHONPATH=. python -m uvicorn aiqa_report_worker.app:app --host 127.0.0.1 --port 8765
```

From `server/`, you can use `pnpm run report-worker` (same port).

The Node server calls this worker at **`REPORT_WORKER_URL`** (default `http://127.0.0.1:8765`). Start the worker before running `/report/:id/run`.

**Ubuntu (systemd):** use `deploy/aiqa-report-worker.service` under `/opt/aiqa/server-python` (see `deploy/DEPLOYMENT.md`).

## API

- `GET /health` — liveness
- `POST /analyze` — body: `{ "kind": "drift" | "coverage", "points": [...], "params": { ... } }` (see `aiqa_report_worker/app.py`)

## Tests

```bash
PYTHONPATH=. pytest tests/
```
