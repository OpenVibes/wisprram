"""Audio decoding (PyAV via faster-whisper; no system ffmpeg needed)."""
from __future__ import annotations

import io
import os
import tempfile

import numpy as np

from .errors import ApiError

SAMPLE_RATE = 16000


def decode_audio_bytes(data: bytes, max_seconds: int = 600) -> np.ndarray:
    """Decode webm/opus, wav, m4a/mp4, ogg, mp3, flac... to 16 kHz mono float32."""
    if not data:
        raise ApiError(400, "empty_audio", "audio upload is empty")
    from faster_whisper.audio import decode_audio

    audio = None
    try:
        audio = decode_audio(io.BytesIO(data), sampling_rate=SAMPLE_RATE)
    except Exception:
        # Some containers (mp4/m4a with moov at the end) need a real, seekable file.
        fd, path = tempfile.mkstemp(prefix="wisprram-", suffix=".bin")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            audio = decode_audio(path, sampling_rate=SAMPLE_RATE)
        except Exception as exc:
            raise ApiError(415, "bad_audio", f"could not decode audio: {type(exc).__name__}") from exc
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    if audio.size == 0:
        raise ApiError(400, "empty_audio", "audio contains no samples")
    if audio.size / SAMPLE_RATE > max_seconds:
        raise ApiError(413, "audio_too_long", f"audio longer than {max_seconds} s")
    return audio
