from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from pydantic import ValidationError

from .. import dictionary as dictmod
from ..audio import SAMPLE_RATE, decode_audio_bytes
from ..auth import require_auth
from ..cleanup import cleanup_text, run_command
from ..db import new_id
from ..errors import ApiError
from ..llm import LlmError
from ..schemas import CommandOptions, CommandResult, DictateOptions, DictationResult
from ..snippets import expand_snippets

log = logging.getLogger("wisprram.dictate")
router = APIRouter(prefix="/v1", dependencies=[Depends(require_auth)])


def _parse_options(raw: str, model):
    try:
        data = json.loads(raw or "{}")
        if not isinstance(data, dict):
            raise ValueError("options must be a JSON object")
        return model.model_validate(data)
    except (ValueError, ValidationError) as exc:
        raise ApiError(422, "validation_error", f"invalid options: {str(exc).splitlines()[0][:200]}") from exc


async def _read_upload(audio: UploadFile, max_bytes: int) -> bytes:
    buf = bytearray()
    while chunk := await audio.read(1 << 20):
        buf += chunk
        if len(buf) > max_bytes:
            raise ApiError(413, "payload_too_large", f"audio upload exceeds {max_bytes // (1 << 20)} MB")
    if not buf:
        raise ApiError(400, "empty_audio", "audio upload is empty")
    return bytes(buf)


async def _transcribe(svc, data: bytes, language: str | None, entries: list[dict]):
    if not svc.stt.loaded:
        raise ApiError(503, "stt_unavailable", "speech model is not loaded yet; try again shortly")
    t0 = time.perf_counter()
    audio = await asyncio.to_thread(decode_audio_bytes, data, svc.cfg.max_audio_s)
    decode_ms = int((time.perf_counter() - t0) * 1000)
    lang = None if not language or language == "auto" else language
    t1 = time.perf_counter()
    try:
        res = await asyncio.to_thread(svc.stt.transcribe, audio, lang, dictmod.hotwords(entries))
    except Exception as exc:  # noqa: BLE001
        log.exception("transcription failed")
        raise ApiError(500, "stt_failed", f"transcription failed: {type(exc).__name__}") from exc
    stt_ms = int((time.perf_counter() - t1) * 1000)
    return audio, res, decode_ms, stt_ms


def _word_count(text: str) -> int:
    return len(text.split())


async def _keep_audio(svc, item_id: str, data: bytes, upload: UploadFile) -> tuple[str, str] | None:
    """Store the original upload when `save_audio` is on. A failure is logged and swallowed."""
    if not svc.audio.enabled:
        return None
    return await asyncio.to_thread(svc.audio.save, item_id, data, upload.content_type, upload.filename)


def _add_history(svc, saved, **kw) -> dict:
    """Insert the history row; if that fails, don't leave the recording behind."""
    path, mime = saved if saved else (None, None)
    try:
        return svc.db.add_history(audio_path=path, audio_mime=mime, **kw)
    except Exception:
        if path:
            svc.audio.remove([path])
        raise


@router.post("/dictate", response_model=DictationResult)
async def dictate(
    request: Request,
    audio: UploadFile = File(...),
    options: str = Form("{}"),
):
    svc = request.app.state.svc
    t_start = time.perf_counter()
    opts = _parse_options(options, DictateOptions)
    data = await _read_upload(audio, svc.cfg.max_upload_mb * (1 << 20))
    settings = svc.settings()
    entries = svc.db.list_dictionary()
    pcm, res, decode_ms, stt_ms = await _transcribe(svc, data, opts.language or settings["language"], entries)
    audio_ms = int(len(pcm) / SAMPLE_RATE * 1000)
    raw_text = res.text.strip()

    if not raw_text:
        total_ms = int((time.perf_counter() - t_start) * 1000)
        return DictationResult(
            id=new_id(), raw_text="", text="", language=res.language, audio_ms=audio_ms, word_count=0,
            timings={"decode_ms": decode_ms, "stt_ms": stt_ms, "llm_ms": 0, "total_ms": total_ms},
            applied_snippets=[], cleanup_used="none", stt_model=svc.stt.model_name, llm_model=settings["llm_model"],
            cleanup=opts.cleanup or settings["default_cleanup"], style=opts.style or settings["default_style"],
            has_audio=False,
        )

    level = opts.cleanup or settings["default_cleanup"]
    app_name = opts.app.name if opts.app else None
    style = opts.style or settings["default_style"]
    if app_name:
        for k, v in settings["styles_by_app"].items():
            if k.lower() == app_name.lower():
                style = v  # per-app style wins
                break

    exp = expand_snippets(dictmod.apply_sounds_like(raw_text, entries), svc.db.list_snippets())
    out = await cleanup_text(exp, level, style, entries, svc.llm, settings["llm_model"], svc.cfg.llm_timeout_s)
    text = out.text.strip()
    item_id = new_id()
    saved = await _keep_audio(svc, item_id, data, audio)
    total_ms = int((time.perf_counter() - t_start) * 1000)
    timings = {"decode_ms": decode_ms, "stt_ms": stt_ms, "llm_ms": out.llm_ms, "total_ms": total_ms}
    stt_model, llm_model = svc.stt.model_name, settings["llm_model"]
    meta = {
        "stt_model": stt_model, "llm_model": llm_model, "cleanup": level, "style": style, "language": res.language,
        "timings": timings, "cleanup_used": out.used, "applied_snippets": exp.applied,
        "app": opts.app.model_dump(exclude_none=True) if opts.app else None, "audio_ms": audio_ms,
    }
    item = _add_history(
        svc, saved, item_id=item_id, kind="dictation", raw_text=raw_text, text=text, app_name=app_name,
        audio_ms=audio_ms, word_count=_word_count(text), language=res.language, meta=meta,
    )
    log.info("dictate audio=%dms decode=%d stt=%d llm=%d total=%d cleanup=%s",
             audio_ms, decode_ms, stt_ms, out.llm_ms, total_ms, out.used)
    return DictationResult(
        id=item["id"], raw_text=raw_text, text=text, language=res.language, audio_ms=audio_ms,
        word_count=item["word_count"], timings=timings,
        applied_snippets=exp.applied, cleanup_used=out.used, stt_model=stt_model, llm_model=llm_model,
        cleanup=level, style=style, has_audio=item["has_audio"],
    )


@router.post("/command", response_model=CommandResult)
async def command(
    request: Request,
    audio: UploadFile = File(...),
    options: str = Form(...),
):
    svc = request.app.state.svc
    t_start = time.perf_counter()
    opts = _parse_options(options, CommandOptions)
    data = await _read_upload(audio, svc.cfg.max_upload_mb * (1 << 20))
    settings = svc.settings()
    entries = svc.db.list_dictionary()
    pcm, res, decode_ms, stt_ms = await _transcribe(svc, data, opts.language or settings["language"], entries)
    audio_ms = int(len(pcm) / SAMPLE_RATE * 1000)
    instruction = dictmod.apply_sounds_like(res.text.strip(), entries)

    if not instruction:  # nothing heard: leave the selection untouched
        total_ms = int((time.perf_counter() - t_start) * 1000)
        return CommandResult(id=new_id(), instruction="", text=opts.selected_text,
                             timings={"decode_ms": decode_ms, "stt_ms": stt_ms, "llm_ms": 0, "total_ms": total_ms},
                             stt_model=svc.stt.model_name, llm_model=settings["llm_model"], has_audio=False)

    t2 = time.perf_counter()
    try:
        text = await run_command(instruction, opts.selected_text, svc.llm, settings["llm_model"],
                                 svc.cfg.command_timeout_s)
    except LlmError as exc:
        log.warning("command LLM failed: %s", exc)
        raise ApiError(502, "llm_unavailable", "the language model is unavailable or timed out") from exc
    llm_ms = int((time.perf_counter() - t2) * 1000)
    if not text.strip():
        raise ApiError(502, "llm_empty", "the language model returned no text")
    item_id = new_id()
    saved = await _keep_audio(svc, item_id, data, audio)
    total_ms = int((time.perf_counter() - t_start) * 1000)
    timings = {"decode_ms": decode_ms, "stt_ms": stt_ms, "llm_ms": llm_ms, "total_ms": total_ms}
    stt_model, llm_model = svc.stt.model_name, settings["llm_model"]
    meta = {
        "stt_model": stt_model, "llm_model": llm_model, "language": res.language, "timings": timings,
        "app": opts.app.model_dump(exclude_none=True) if opts.app else None, "audio_ms": audio_ms,
        "selected_text": opts.selected_text, "instruction": instruction,
    }
    item = _add_history(
        svc, saved, item_id=item_id, kind="command", raw_text=instruction, text=text,
        app_name=opts.app.name if opts.app else None, audio_ms=audio_ms, word_count=_word_count(text),
        language=res.language, meta=meta,
    )
    return CommandResult(id=item["id"], instruction=instruction, text=text, timings=timings,
                         stt_model=stt_model, llm_model=llm_model, has_audio=item["has_audio"])
