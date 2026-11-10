from __future__ import annotations

from fastapi import APIRouter, Request

from .. import auth
from ..schemas import PairRequest, PairResponse

router = APIRouter()


@router.post("/v1/pair", response_model=PairResponse)
async def pair(body: PairRequest, request: Request):
    svc = request.app.state.svc
    return {"token": auth.pair(svc.db, svc.limiter, body.code, body.client_name)}
