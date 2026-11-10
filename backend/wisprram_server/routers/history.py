from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse

from ..auth import require_auth
from ..errors import ApiError
from ..schemas import HistoryItem, HistoryPage, Ok

router = APIRouter(prefix="/v1", dependencies=[Depends(require_auth)])


@router.get("/history", response_model=HistoryPage)
async def list_history(
    request: Request,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None, max_length=200),
):
    items, total = request.app.state.svc.db.list_history(limit, offset, q)
    return {"items": items, "total": total}


@router.get("/history/{item_id}", response_model=HistoryItem)
async def get_item(item_id: str, request: Request):
    item = request.app.state.svc.db.get_history(item_id)
    if not item:
        raise ApiError(404, "not_found", "history item not found")
    return item


@router.get("/history/{item_id}/audio")
async def get_audio(item_id: str, request: Request):
    svc = request.app.state.svc
    if not svc.db.get_history(item_id):
        raise ApiError(404, "not_found", "history item not found")
    ref = svc.db.get_audio_ref(item_id)
    path = svc.audio.resolve(ref[0]) if ref else None
    if not ref or path is None:
        raise ApiError(404, "no_audio", "no recording was kept for this item")
    return FileResponse(
        path, media_type=ref[1], headers={"Content-Disposition": f'inline; filename="{item_id}{path.suffix}"',
                                          "Cache-Control": "private, no-store"},
    )


@router.delete("/history/{item_id}", response_model=Ok)
async def delete_item(item_id: str, request: Request):
    if not request.app.state.svc.db.delete_history(item_id):
        raise ApiError(404, "not_found", "history item not found")
    return {"ok": True}


@router.delete("/history", response_model=Ok)
async def clear_history(request: Request):
    request.app.state.svc.db.clear_history()
    return {"ok": True}
