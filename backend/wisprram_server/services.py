"""Shared service container stored on app.state.svc."""
from __future__ import annotations

import threading

from .audio_store import AudioStore
from .auth import PairLimiter
from .config import Config
from .db import Database
from .llm import OllamaClient
from .schemas import ServerSettings


class Services:
    def __init__(self, cfg: Config, db: Database, stt, llm: OllamaClient):
        self.cfg, self.db, self.stt, self.llm = cfg, db, stt, llm
        self.limiter = PairLimiter()
        self.audio = AudioStore(cfg, db)
        db.on_audio_removed = self.audio.remove  # deleting/pruning history also deletes kept recordings

    def settings(self) -> dict:
        s = self.db.all_settings()
        d = {
            "stt_model": self.cfg.stt_model,
            "llm_model": self.cfg.llm_model,
            "default_cleanup": "full",
            "default_style": "casual",
            "language": "auto",
            "styles_by_app": {},
            "keep_history_days": 90,
            "save_audio": False,
            "audio_dir": "",
        }
        d.update({k: v for k, v in s.items() if k in d})
        return ServerSettings(**d).model_dump()

    def reload_stt_async(self, model: str) -> None:
        threading.Thread(target=self.stt.load, args=(model,), daemon=True, name="stt-reload").start()
