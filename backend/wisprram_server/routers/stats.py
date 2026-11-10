from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..auth import require_auth
from ..schemas import Stats

router = APIRouter(prefix="/v1", dependencies=[Depends(require_auth)])


@router.get("/stats", response_model=Stats)
async def stats(request: Request):
    return request.app.state.svc.db.stats()
