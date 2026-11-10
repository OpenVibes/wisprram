from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Request

from ..audio_store import ensure_writable_dir, normalize_audio_dir
from ..auth import require_auth
from ..schemas import ServerSettings, ServerSettingsPatch

router = APIRouter(prefix="/v1/settings", dependencies=[Depends(require_auth)])


@router.get("", response_model=ServerSettings)
async def get_settings(request: Request):
    return request.app.state.svc.settings()


@router.put("", response_model=ServerSettings)
async def put_settings(patch: ServerSettingsPatch, request: Request):
    svc = request.app.state.svc
    before = svc.settings()
    changes = patch.model_dump(exclude_none=True)
    if "audio_dir" in changes:
        changes["audio_dir"] = normalize_audio_dir(changes["audio_dir"])
    # validate before anything is saved, so a bad audio_dir rejects the whole PUT
    if "audio_dir" in changes or changes.get("save_audio"):
        eff = changes.get("audio_dir", before["audio_dir"])
        ensure_writable_dir(Path(eff) if eff else svc.cfg.default_audio_dir)
    for k, v in changes.items():
        svc.db.set_setting(k, v)
    after = svc.settings()
    if after["keep_history_days"] != before["keep_history_days"]:
        svc.db.prune_history(after["keep_history_days"])
    if after["stt_model"] != before["stt_model"]:
        svc.reload_stt_async(after["stt_model"])
    return after
