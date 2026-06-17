"""
Model Lab API — on-demand multi-algorithm training with live (SSE) progress,
a run registry, and champion promotion. Admin-only.
"""
import os
import sys
import json
import queue
import asyncio
import threading

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

from auth import require_admin

# Ensure ml package importable
ML_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ml")
if ML_DIR not in sys.path:
    sys.path.append(ML_DIR)

import trainer  # noqa: E402

router = APIRouter()


class TrainRequest(BaseModel):
    algorithm: str
    sample_size: int = 8000
    hyperparams: Optional[dict] = None


@router.get("/v1/lab/algorithms")
async def get_algorithms(user: dict = Depends(require_admin)):
    return {
        "algorithms": [
            {
                "id": k,
                "label": v["label"],
                "blurb": v["blurb"],
                "hyperparams": v["hyperparams"],
            }
            for k, v in trainer.ALGORITHMS.items()
        ]
    }


@router.get("/v1/lab/runs")
async def get_runs(user: dict = Depends(require_admin)):
    return {"runs": trainer.list_runs()}


@router.post("/v1/lab/promote/{run_id}")
async def promote_run(run_id: str, user: dict = Depends(require_admin)):
    try:
        run = trainer.promote(run_id)
        return {"status": "promoted", "run": run}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Run not found")


@router.post("/v1/lab/train")
async def train_stream(req: TrainRequest, user: dict = Depends(require_admin)):
    if req.algorithm not in trainer.ALGORITHMS:
        raise HTTPException(status_code=400, detail="Unknown algorithm")

    q: "queue.Queue[str]" = queue.Queue()
    SENTINEL = "__DONE__"

    def worker():
        def cb(stage, pct):
            q.put(json.dumps({"type": "progress", "stage": stage, "pct": pct}))

        try:
            result = trainer.train(req.algorithm, req.sample_size, req.hyperparams or {}, cb)
            q.put(json.dumps({"type": "result", "result": result}))
        except Exception as e:  # surface training errors to the client
            q.put(json.dumps({"type": "error", "detail": str(e)}))
        finally:
            q.put(SENTINEL)

    threading.Thread(target=worker, daemon=True).start()

    async def event_gen():
        loop = asyncio.get_event_loop()
        while True:
            item = await loop.run_in_executor(None, q.get)
            if item == SENTINEL:
                break
            yield f"data: {item}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
