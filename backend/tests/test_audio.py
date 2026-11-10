import io
import wave
from pathlib import Path

import numpy as np
import pytest

from wisprram_server.audio import decode_audio_bytes
from wisprram_server.errors import ApiError

FX = Path(__file__).parent / "fixtures"


def test_decode_wav_resamples_to_16k_mono():
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(44100)
        w.writeframes((np.zeros(44100 * 2, dtype="<i2")).tobytes())
    a = decode_audio_bytes(buf.getvalue())
    assert a.dtype == np.float32 and a.ndim == 1 and abs(len(a) - 16000) < 50


@pytest.mark.parametrize("name", ["hello.wav", "hello.m4a", "hello.webm", "hello_stream.webm", "hello.ogg"])
def test_decode_container_formats(name):
    p = FX / name
    if not p.exists():
        pytest.skip(f"{name} fixture missing")
    a = decode_audio_bytes(p.read_bytes())
    assert 2.0 < len(a) / 16000 < 6.0 and float(np.abs(a).max()) > 0.01


def test_empty_and_garbage():
    with pytest.raises(ApiError) as e:
        decode_audio_bytes(b"")
    assert e.value.code == "empty_audio"
    with pytest.raises(ApiError) as e:
        decode_audio_bytes(b"garbage" * 100)
    assert e.value.status == 415
