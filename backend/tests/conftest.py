from __future__ import annotations

import io
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from wisprram_server import auth
from wisprram_server.config import Config
from wisprram_server.db import Database
from wisprram_server.llm import LlmError
from wisprram_server.main import create_app
from wisprram_server.stt import SttResult

FIXTURES = Path(__file__).parent / "fixtures"


def make_wav(seconds: float = 1.0, freq: float = 440.0, sr: int = 16000) -> bytes:
    t = np.arange(int(seconds * sr)) / sr
    pcm = (0.2 * np.sin(2 * np.pi * freq * t) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


class FakeStt:
    loaded = True
    model_name = "fake-whisper"
    device = "cuda"
    fallback_reason = None

    def __init__(self):
        self.text = "um hello world this is a test"
        self.language = "en"
        self.calls: list[dict] = []

    def transcribe(self, audio, language, hotwords=None):
        self.calls.append({"n": len(audio), "language": language, "hotwords": hotwords})
        return SttResult(self.text, self.language, 0.99, len(audio) / 16000)

    def load(self, name=None):
        if name:
            self.model_name = name


class FakeLlm:
    def __init__(self):
        self.reply = "Hello world, this is a test."
        self.fail = False
        self.up = True
        self.calls: list[dict] = []

    async def chat(self, model, messages, timeout, max_tokens=None):
        self.calls.append({"model": model, "messages": messages, "timeout": timeout})
        if self.fail:
            raise LlmError("boom")
        return self.reply(messages) if callable(self.reply) else self.reply

    async def reachable(self, ttl=3.0):
        return self.up

    async def warm(self, model):
        pass

    async def aclose(self):
        pass


@pytest.fixture()
def cfg(tmp_path) -> Config:
    return Config(data_dir=tmp_path, stt_load=False)


@pytest.fixture()
def db(cfg) -> Database:
    return Database(cfg.db_path)


@pytest.fixture()
def stt():
    return FakeStt()


@pytest.fixture()
def llm():
    return FakeLlm()


@pytest.fixture()
def client(cfg, db, stt, llm):
    app = create_app(cfg, stt=stt, llm=llm, db=db)
    with TestClient(app) as c:
        c.svc = app.state.svc
        yield c


@pytest.fixture()
def token(client) -> str:
    return auth.issue_token(client.svc.db, "pytest")


@pytest.fixture()
def H(token) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def wav() -> bytes:
    return make_wav(1.5)
