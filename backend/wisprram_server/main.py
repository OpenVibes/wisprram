"""FastAPI app factory."""
from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import VERSION, Config, load_config
from .db import Database
from .errors import install_error_handlers
from .llm import OllamaClient
from .routers import dictate, dictionary, health, history, pair, settings, snippets, stats
from .services import Services
from .stt import SttEngine

log = logging.getLogger("wisprram")


def create_app(cfg: Config | None = None, stt=None, llm=None, db: Database | None = None) -> FastAPI:
    cfg = cfg or load_config()
    db = db or Database(cfg.db_path)
    stt = stt or SttEngine(cfg)
    llm = llm or OllamaClient(cfg)
    svc = Services(cfg, db, stt, llm)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db.prune_history(svc.settings()["keep_history_days"])
        if cfg.stt_load and hasattr(stt, "load") and not stt.loaded:
            threading.Thread(target=stt.load, daemon=True, name="stt-load").start()
            asyncio.create_task(llm.warm(svc.settings()["llm_model"]))

        async def pruner():
            while True:
                await asyncio.sleep(3600)
                try:
                    db.prune_history(svc.settings()["keep_history_days"])
                except Exception:  # noqa: BLE001
                    log.exception("history prune failed")

        task = asyncio.create_task(pruner())
        yield
        task.cancel()
        await llm.aclose()

    app = FastAPI(title="WisprRam server", version=VERSION, lifespan=lifespan)
    app.state.svc = svc
    install_error_handlers(app)
    for r in (health, pair, dictate, history, dictionary, snippets, settings, stats):
        app.include_router(r.router)
    return app
