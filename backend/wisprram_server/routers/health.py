from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request

from ..config import VERSION
from ..gpu import gpu_info

router = APIRouter()


@router.get("/health")
async def health(request: Request):
    svc = request.app.state.svc
    stt = svc.stt
    reachable = await svc.llm.reachable()
    gpu = await asyncio.to_thread(gpu_info)
    degraded = (not stt.loaded) or (not reachable) or bool(getattr(stt, "fallback_reason", None))
    body = {
        "status": "degraded" if degraded else "ok",
        "version": VERSION,
        "stt": {"model": stt.model_name, "device": stt.device, "loaded": bool(stt.loaded)},
        "llm": {"provider": "ollama", "model": svc.settings()["llm_model"], "reachable": reachable},
        "gpu": gpu,
    }
    return body
