"""Real-audio tests: need the CUDA/CPU model and Ollama on this machine. Run on the PC:
    .venv/bin/python -m pytest -m integration   (use scripts/run.sh-style LD_LIBRARY_PATH, see scripts/test.sh)
"""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from wisprram_server import auth
from wisprram_server.config import Config
from wisprram_server.llm import OllamaClient
from wisprram_server.main import create_app
from wisprram_server.stt import SttEngine

pytestmark = pytest.mark.integration
FX = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def engine():
    eng = SttEngine(Config(stt_load=False))
    eng.load()
    if not eng.loaded:
        pytest.skip(f"STT unavailable: {eng.error}")
    return eng


@pytest.fixture()
def rc(engine, tmp_path):
    cfg = Config(data_dir=tmp_path, stt_load=False)
    llm = OllamaClient(cfg)
    app = create_app(cfg, stt=engine, llm=llm)
    with TestClient(app) as c:
        if not c.get("/health").json()["llm"]["reachable"]:
            pytest.skip("Ollama not reachable")
        c.h = {"Authorization": "Bearer " + auth.issue_token(app.state.svc.db, "it")}
        yield c


def post(c, name, route="/v1/dictate", mime="audio/wav", **opts):
    data = (FX / name).read_bytes()
    r = c.post(route, headers=c.h, files={"audio": (name, data, mime)}, data={"options": json.dumps(opts)})
    assert r.status_code == 200, r.text
    return r.json()


def test_health_reports_engine(rc, engine):
    j = rc.get("/health").json()
    assert j["stt"]["loaded"] and j["stt"]["device"] == engine.device


def test_plain_transcription(rc):
    j = post(rc, "hello.wav", cleanup="none")
    t = j["raw_text"].lower()
    assert "hello" in t and "dictation" in t
    assert 2500 < j["audio_ms"] < 5000


@pytest.mark.parametrize("name,mime", [("hello.m4a", "audio/mp4"), ("hello.webm", "audio/webm"), ("hello_stream.webm", "audio/webm"), ("hello.ogg", "audio/ogg")])
def test_container_formats_transcribe(rc, name, mime):
    if not (FX / name).exists():
        pytest.skip("fixture missing")
    assert "dictation" in post(rc, name, mime=mime, cleanup="none")["raw_text"].lower()


def test_fillers_and_self_correction_full(rc):
    j = post(rc, "fillers.wav", cleanup="full")
    t = j["text"].lower()
    assert j["cleanup_used"] == "llm", j
    assert " um " not in f" {t} " and " uh " not in f" {t} "
    assert "5" in t and "4" not in t, j
    assert "meet" in t


def test_question_is_not_answered(rc):
    j = post(rc, "question.wav", cleanup="full")
    assert "paris" not in j["text"].lower()
    assert j["text"].rstrip().endswith("?"), j


def test_spoken_punctuation_light(rc):
    j = post(rc, "punct.wav", cleanup="light")
    assert j["text"].lower().startswith("hello,") and j["text"].endswith("?"), j


def test_snippet_expansion_verbatim_through_llm(rc):
    rc.post("/v1/snippets", headers=rc.h, json={"trigger": "my email", "expansion": "alex.morgan@example.com"})
    j = post(rc, "snippet.wav", cleanup="full")
    assert "alex.morgan@example.com" in j["text"], j
    assert j["applied_snippets"] == ["my email"]


def test_command_mode(rc):
    j = post(rc, "command.wav", route="/v1/command", selected_text="hey can u send me that report asap thx")
    assert j["text"] and j["text"] != "hey can u send me that report asap thx"
    assert "formal" not in j["text"].lower() or len(j["text"]) > 20
    assert "<" not in j["text"]
