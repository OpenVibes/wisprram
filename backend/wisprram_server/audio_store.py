"""Server-side audio retention: store the original upload next to its history row, serve it back, delete it.

Layout: ``<audio_dir>/<YYYY-MM>/<history_id>.<ext>`` (``audio_dir`` defaults to ``<data_dir>/audio``).
Each history row records its own absolute ``audio_path``, so changing ``audio_dir`` later never orphans old
recordings. Every file we read or delete must resolve to a location inside a directory this server has written
audio to (the "audio roots"); a tampered path is never followed.
"""
from __future__ import annotations

import logging
import os
import tempfile
from datetime import datetime
from pathlib import Path

from .config import Config
from .db import Database
from .errors import ApiError

log = logging.getLogger("wisprram.audio")

ROOTS_KEY = "_audio_roots"  # internal setting (not part of ServerSettings): every dir we have written audio to

EXT_MIME = {
    "webm": "audio/webm",
    "wav": "audio/wav",
    "m4a": "audio/mp4",
    "ogg": "audio/ogg",
    "mp3": "audio/mpeg",
    "bin": "application/octet-stream",
}
_CT_EXT = {
    "audio/webm": "webm", "video/webm": "webm",
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/vnd.wave": "wav",
    "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a", "audio/aac": "m4a", "video/mp4": "m4a",
    "audio/ogg": "ogg", "application/ogg": "ogg", "audio/opus": "ogg", "audio/vorbis": "ogg",
    "audio/mpeg": "mp3", "audio/mp3": "mp3",
}
_NAME_EXT = {
    "webm": "webm", "wav": "wav", "wave": "wav", "m4a": "m4a", "mp4": "m4a", "ogg": "ogg", "oga": "ogg",
    "opus": "ogg", "mp3": "mp3",
}


def guess_ext(content_type: str | None, filename: str | None, data: bytes = b"") -> str:
    """Pick webm|wav|m4a|ogg|mp3 from the upload's content type, then filename, then magic bytes; else 'bin'."""
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in _CT_EXT:
        return _CT_EXT[ct]
    suffix = os.path.splitext(filename or "")[1].lstrip(".").lower()
    if suffix in _NAME_EXT:
        return _NAME_EXT[suffix]
    head = data[:12]
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "webm"
    if head[:4] == b"OggS":
        return "ogg"
    if head[4:8] == b"ftyp":
        return "m4a"
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return "mp3"
    return "bin"


def normalize_audio_dir(raw: str) -> str:
    """'' stays ''. Otherwise expand ~ and require an absolute path (returns it normalised). Raises 400."""
    raw = (raw or "").strip()
    if not raw:
        return ""
    try:
        path = os.path.normpath(os.path.expanduser(raw))
    except (ValueError, OSError):
        path = ""
    if not path or "\x00" in path or not os.path.isabs(path):
        raise ApiError(400, "bad_audio_dir", "audio_dir must be empty or an absolute path on the server")
    return path


def ensure_writable_dir(path: Path) -> None:
    """Create `path` if needed and prove we can write there. Raises 400 bad_audio_dir."""
    try:
        path.mkdir(parents=True, exist_ok=True)
        if not path.is_dir():
            raise OSError("not a directory")
        fd, tmp = tempfile.mkstemp(prefix=".wisprram-write-test-", dir=path)
        os.close(fd)
        os.unlink(tmp)
    except OSError as exc:
        raise ApiError(400, "bad_audio_dir", f"audio_dir is not usable: {path} ({exc.strerror or exc})") from exc


class AudioStore:
    def __init__(self, cfg: Config, db: Database):
        self.cfg, self.db = cfg, db

    # -- configuration ---------------------------------------------
    @property
    def enabled(self) -> bool:
        return bool(self.db.get_setting("save_audio", False))

    @property
    def directory(self) -> Path:
        raw = self.db.get_setting("audio_dir", "") or ""
        return Path(raw) if raw else self.cfg.default_audio_dir

    def roots(self) -> list[Path]:
        out = [self.directory, self.cfg.default_audio_dir]
        out += [Path(p) for p in self.db.get_setting(ROOTS_KEY, []) if isinstance(p, str)]
        seen, uniq = set(), []
        for r in out:
            try:
                rr = r.resolve()
            except (OSError, RuntimeError):
                continue
            if rr not in seen:
                seen.add(rr)
                uniq.append(rr)
        return uniq

    def _remember_root(self, root: Path) -> None:
        known = [p for p in self.db.get_setting(ROOTS_KEY, []) if isinstance(p, str)]
        if str(root) not in known and root != self.cfg.default_audio_dir:
            self.db.set_setting(ROOTS_KEY, known + [str(root)])

    # -- write -----------------------------------------------------
    def save(self, item_id: str, data: bytes, content_type: str | None, filename: str | None) -> tuple[str, str] | None:
        """Write the original upload. Returns (absolute path, mime) or None if it could not be stored.
        Blocking disk I/O: call via a worker thread. Never raises."""
        try:
            root = self.directory
            ext = guess_ext(content_type, filename, data)
            folder = root / datetime.now().astimezone().strftime("%Y-%m")
            folder.mkdir(parents=True, exist_ok=True)
            final = folder / f"{item_id}.{ext}"
            tmp = folder / f".{item_id}.part"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                os.replace(tmp, final)
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
            self._remember_root(root.resolve())
            return str(final), EXT_MIME[ext]
        except Exception:  # noqa: BLE001
            log.exception("could not store audio for %s; continuing without it", item_id)
            return None

    # -- read / delete ---------------------------------------------
    def resolve(self, path_str: str | None) -> Path | None:
        """The real file behind a recorded path, only if it is a regular file inside an audio root."""
        if not path_str:
            return None
        try:
            p = Path(path_str).resolve()
            if not p.is_file():
                return None
            for root in self.roots():
                if p.is_relative_to(root):
                    return p
        except (OSError, RuntimeError, ValueError):
            pass
        return None

    def remove(self, paths: list[str]) -> None:
        for s in paths:
            p = self.resolve(s)
            if p is None:
                if s and not os.path.exists(s):
                    continue  # already gone
                log.warning("refusing to delete audio outside the audio folders: %s", s)
                continue
            try:
                p.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                log.exception("could not delete %s", p)
                continue
            try:  # drop the month folder once it is empty (never the audio root itself)
                if p.parent not in self.roots():
                    p.parent.rmdir()
            except OSError:
                pass
