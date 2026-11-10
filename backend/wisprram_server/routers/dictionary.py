from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..auth import require_auth
from ..errors import ApiError
from ..schemas import DictionaryEntry, DictionaryInput, Ok

router = APIRouter(prefix="/v1/dictionary", dependencies=[Depends(require_auth)])


def _clean(body: DictionaryInput) -> tuple[str, list[str]]:
    term = body.term.strip()
    if not term:
        raise ApiError(422, "validation_error", "term must not be empty")
    sl = []
    for s in body.sounds_like:
        s = s.strip()
        if s and s.lower() not in {x.lower() for x in sl}:
            sl.append(s)
    return term, sl


@router.get("", response_model=list[DictionaryEntry])
async def list_entries(request: Request):
    return request.app.state.svc.db.list_dictionary()


@router.post("", response_model=DictionaryEntry)
async def add_entry(body: DictionaryInput, request: Request):
    db = request.app.state.svc.db
    term, sl = _clean(body)
    if db.find_dictionary_term(term):
        raise ApiError(409, "duplicate", f"'{term}' is already in the dictionary")
    return db.add_dictionary(term, sl)


@router.put("/{entry_id}", response_model=DictionaryEntry)
async def update_entry(entry_id: str, body: DictionaryInput, request: Request):
    db = request.app.state.svc.db
    term, sl = _clean(body)
    other = db.find_dictionary_term(term)
    if other and other["id"] != entry_id:
        raise ApiError(409, "duplicate", f"'{term}' is already in the dictionary")
    res = db.update_dictionary(entry_id, term, sl)
    if not res:
        raise ApiError(404, "not_found", "dictionary entry not found")
    return res


@router.delete("/{entry_id}", response_model=Ok)
async def delete_entry(entry_id: str, request: Request):
    if not request.app.state.svc.db.delete_dictionary(entry_id):
        raise ApiError(404, "not_found", "dictionary entry not found")
    return {"ok": True}
