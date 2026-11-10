"""Ollama client (async, /api/chat)."""
from __future__ import annotations

import time

import httpx

from .config import Config


class LlmError(Exception):
    pass


class OllamaClient:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._client: httpx.AsyncClient | None = None
        self._reach: tuple[float, bool] = (0.0, False)

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self.cfg.ollama_url)
        return self._client

    async def aclose(self) -> None:
        if self._client:
            await self._client.aclose()

    async def chat(self, model: str, messages: list[dict], timeout: float, max_tokens: int | None = None) -> str:
        options: dict = {"temperature": 0.1}
        if max_tokens:
            options["num_predict"] = max_tokens
        try:
            r = await self.client.post(
                "/api/chat",
                json={"model": model, "messages": messages, "stream": False,
                      "keep_alive": self.cfg.llm_keep_alive, "options": options},
                timeout=timeout,
            )
            r.raise_for_status()
            return (r.json().get("message", {}).get("content") or "").strip()
        except Exception as exc:  # noqa: BLE001
            raise LlmError(f"{type(exc).__name__}: {exc}") from exc

    async def reachable(self, ttl: float = 3.0) -> bool:
        now = time.time()
        if now - self._reach[0] < ttl:
            return self._reach[1]
        try:
            r = await self.client.get("/api/tags", timeout=1.5)
            ok = r.status_code == 200
        except Exception:  # noqa: BLE001
            ok = False
        self._reach = (now, ok)
        return ok

    async def warm(self, model: str) -> None:
        """Load the model into VRAM (empty prompt) so the first real request is fast."""
        try:
            await self.client.post("/api/generate", json={"model": model, "keep_alive": self.cfg.llm_keep_alive},
                                   timeout=60)
        except Exception:  # noqa: BLE001
            pass
