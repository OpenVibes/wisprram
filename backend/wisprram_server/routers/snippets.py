from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..auth import require_auth
from ..errors import ApiError
from ..schemas import Ok, Snippet, SnippetInput

router = APIRouter(prefix="/v1/snippets", dependencies=[Depends(require_auth)])


def _clean(body: SnippetInput) -> tuple[str, str]:
    trigger = " ".join(body.trigger.split())
    if not trigger or not body.expansion.strip():
        raise ApiError(422, "validation_error", "trigger and expansion must not be empty")
    return trigger, body.expansion


@router.get("", response_model=list[Snippet])
async def list_snippets(request: Request):
    return request.app.state.svc.db.list_snippets()


@router.post("", response_model=Snippet)
async def add_snippet(body: SnippetInput, request: Request):
    db = request.app.state.svc.db
    trigger, exp = _clean(body)
    if db.find_snippet_trigger(trigger):
        raise ApiError(409, "duplicate", f"trigger '{trigger}' already exists")
    return db.add_snippet(trigger, exp)


@router.put("/{snippet_id}", response_model=Snippet)
async def update_snippet(snippet_id: str, body: SnippetInput, request: Request):
    db = request.app.state.svc.db
    trigger, exp = _clean(body)
    other = db.find_snippet_trigger(trigger)
    if other and other["id"] != snippet_id:
        raise ApiError(409, "duplicate", f"trigger '{trigger}' already exists")
    res = db.update_snippet(snippet_id, trigger, exp)
    if not res:
        raise ApiError(404, "not_found", "snippet not found")
    return res


@router.delete("/{snippet_id}", response_model=Ok)
async def delete_snippet(snippet_id: str, request: Request):
    if not request.app.state.svc.db.delete_snippet(snippet_id):
        raise ApiError(404, "not_found", "snippet not found")
    return {"ok": True}
