import numpy as np
import pytest

from wisprram_server.config import Config
from wisprram_server.stt import SttEngine


class FakeModel:
    def transcribe(self, *a, **k):
        return iter(()), None


def test_cuda_failure_falls_back_to_cpu_small(monkeypatch):
    calls = []

    def build(self, name, device, compute_type):
        calls.append((name, device, compute_type))
        if device == "cuda":
            raise RuntimeError("Library libcudnn_ops.so.9 is not found")
        return FakeModel()

    monkeypatch.setattr(SttEngine, "_build", build)
    monkeypatch.setattr(SttEngine, "_warmup", lambda self, m: None)
    import ctranslate2

    monkeypatch.setattr(ctranslate2, "get_cuda_device_count", lambda: 1)
    e = SttEngine(Config(stt_load=False))
    e.load()
    assert e.loaded and e.device == "cpu" and e.model_name == "small" and e.compute_type == "int8"
    assert "libcudnn" in e.fallback_reason
    assert calls == [("large-v3-turbo", "cuda", "float16"), ("small", "cpu", "int8")]


def test_cuda_success(monkeypatch):
    monkeypatch.setattr(SttEngine, "_build", lambda self, n, d, c: FakeModel())
    monkeypatch.setattr(SttEngine, "_warmup", lambda self, m: None)
    import ctranslate2

    monkeypatch.setattr(ctranslate2, "get_cuda_device_count", lambda: 1)
    e = SttEngine(Config(stt_load=False))
    e.load()
    assert e.loaded and e.device == "cuda" and e.model_name == "large-v3-turbo" and e.fallback_reason is None


def test_transcribe_requires_loaded():
    e = SttEngine(Config(stt_load=False))
    with pytest.raises(RuntimeError):
        e.transcribe(np.zeros(16000, dtype=np.float32), None)


def test_no_cuda_device_is_cpu_mode_not_degraded(monkeypatch):
    """A machine without a GPU runs on CPU by design: no fallback_reason, so /health is not 'degraded'."""
    calls = []
    monkeypatch.setattr(SttEngine, "_build", lambda self, n, d, c: calls.append((n, d, c)) or FakeModel())
    monkeypatch.setattr(SttEngine, "_warmup", lambda self, m: None)
    import ctranslate2

    monkeypatch.setattr(ctranslate2, "get_cuda_device_count", lambda: 0)
    e = SttEngine(Config(stt_load=False))
    e.load()
    assert e.loaded and e.device == "cpu" and e.model_name == "small" and e.fallback_reason is None
    assert calls == [("small", "cpu", "int8")]


def test_ensure_model_local_folder_is_untouched(tmp_path):
    from wisprram_server.stt import ensure_model, model_cached

    assert ensure_model(str(tmp_path)) == str(tmp_path) and model_cached(str(tmp_path))
