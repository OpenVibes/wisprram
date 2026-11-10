"""faster-whisper wrapper: load once, warm up, GPU->CPU fallback, one transcription at a time."""
from __future__ import annotations

import io
import logging
import os
import threading
import time
from dataclasses import dataclass

import numpy as np

from .config import Config

log = logging.getLogger("wisprram.stt")


_MODEL_FILES = ["config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*"]


def model_repo(name: str) -> str | None:
    """Hugging Face repo id behind a faster-whisper model alias (None if `name` is a local folder)."""
    if os.path.isdir(name):
        return None
    if "/" in name:
        return name
    from faster_whisper.utils import _MODELS

    return _MODELS.get(name)


def model_cached(name: str) -> bool:
    repo = model_repo(name)
    if repo is None:
        return True
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(repo, allow_patterns=_MODEL_FILES, local_files_only=True)
        return True
    except Exception:  # noqa: BLE001
        return False


def _log_tqdm():
    """A tqdm class that writes a log line per ~10% of each file instead of redrawing a terminal bar."""
    from tqdm.auto import tqdm

    class LogTqdm(tqdm):
        def __init__(self, *args, **kwargs):
            kwargs["file"] = io.StringIO()  # swallow the bar itself
            kwargs["disable"] = False
            super().__init__(*args, **kwargs)
            self._last_pct = -1

        def update(self, n=1):
            r = super().update(n)
            # (hf-xet adds a second "Reconstructing" bar that mirrors the first; log only one)
            if (self.total and self.unit in ("B", "iB") and self.total > (1 << 20)
                    and not str(self.desc or "").startswith("Reconstruct")):
                pct = int(self.n * 100 / self.total)
                if pct >= self._last_pct + 10 or (pct == 100 and self._last_pct < 100):
                    self._last_pct = pct
                    log.info("speech model download: %d%% (%d / %d MB)", pct, self.n >> 20, self.total >> 20)
            return r

    return LogTqdm


def ensure_model(name: str, interactive: bool = False) -> str:
    """Make sure the model files are on disk, logging download progress; returns the name/path to load.

    Falls back to returning `name` unchanged (faster-whisper then downloads it itself) if anything here fails.
    """
    try:
        repo = model_repo(name)
        if repo is None:
            return name
        from huggingface_hub import snapshot_download

        try:
            return snapshot_download(repo, allow_patterns=_MODEL_FILES, local_files_only=True)
        except Exception:  # noqa: BLE001 - not cached yet
            pass
        log.info("speech model %s (%s) is not cached; downloading from Hugging Face (first run only)", name, repo)
        t = time.time()
        path = snapshot_download(repo, allow_patterns=_MODEL_FILES, tqdm_class=None if interactive else _log_tqdm())
        log.info("speech model %s downloaded in %.0fs", name, time.time() - t)
        return path
    except Exception as exc:  # noqa: BLE001
        log.warning("model pre-download for %s failed (%s: %s); letting faster-whisper try", name,
                    type(exc).__name__, exc)
        return name


@dataclass
class SttResult:
    text: str
    language: str
    language_probability: float
    duration_s: float


class NoCudaDevice(RuntimeError):
    pass


class SttEngine:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.model = None
        self.model_name = cfg.stt_model
        self.device = "cpu"
        self.compute_type = "int8"
        self.loaded = False
        self.error: str | None = None
        self.fallback_reason: str | None = None
        self._lock = threading.Lock()  # serialises GPU access

    # -- loading ---------------------------------------------------
    def _build(self, name: str, device: str, compute_type: str):
        from faster_whisper import WhisperModel

        return WhisperModel(ensure_model(name), device=device, compute_type=compute_type)

    def _warmup(self, model) -> None:
        # vad_filter off so the encoder/decoder (and cuDNN/cuBLAS) are really exercised
        silence = np.zeros(16000, dtype=np.float32)
        segs, _ = model.transcribe(silence, beam_size=1, vad_filter=False, language="en")
        list(segs)

    def load(self, model_name: str | None = None) -> None:
        """(Re)load the model. Tries CUDA float16 first, falls back to CPU int8 with the small model."""
        name = model_name or self.cfg.stt_model
        with self._lock:
            self.loaded = False
            self.model = None
            want = self.cfg.stt_device
            if want in ("auto", "cuda"):
                try:
                    import ctranslate2

                    if ctranslate2.get_cuda_device_count() < 1:
                        raise NoCudaDevice("no CUDA device visible to CTranslate2")
                    t = time.time()
                    log.info("loading speech model %s on cuda/%s", name, self.cfg.stt_compute_type)
                    model = self._build(name, "cuda", self.cfg.stt_compute_type)
                    self._warmup(model)
                    self.model, self.model_name, self.device = model, name, "cuda"
                    self.compute_type = self.cfg.stt_compute_type
                    self.loaded, self.error, self.fallback_reason = True, None, None
                    log.info("STT %s loaded on cuda/%s in %.1fs", name, self.compute_type, time.time() - t)
                    return
                except Exception as exc:  # noqa: BLE001
                    if isinstance(exc, NoCudaDevice) and want == "auto":
                        # CPU-only machine: that is the intended mode, not a degraded one
                        self.fallback_reason = None
                        log.info("no CUDA device found; running the speech model on CPU")
                    else:
                        self.fallback_reason = f"{type(exc).__name__}: {exc}"
                        log.warning("CUDA STT failed (%s); falling back to CPU", self.fallback_reason)
                    if want == "cuda":
                        self.error = self.fallback_reason
                        return
            try:
                cpu_name = self.cfg.stt_cpu_model if want != "cpu" or name == self.cfg.stt_model else name
                log.info("loading speech model %s on cpu/int8", cpu_name)
                model = self._build(cpu_name, "cpu", "int8")
                self._warmup(model)
                self.model, self.model_name, self.device, self.compute_type = model, cpu_name, "cpu", "int8"
                self.loaded, self.error = True, None
                log.info("STT %s loaded on cpu/int8", cpu_name)
            except Exception as exc:  # noqa: BLE001
                self.error = f"{type(exc).__name__}: {exc}"
                log.error("STT load failed: %s", self.error)

    # -- inference -------------------------------------------------
    def transcribe(self, audio: np.ndarray, language: str | None, hotwords: str | None = None) -> SttResult:
        """Blocking; call via a worker thread. `language` None = auto-detect."""
        with self._lock:
            if not self.loaded or self.model is None:
                raise RuntimeError("STT model not loaded")
            segments, info = self.model.transcribe(
                audio,
                language=language,
                beam_size=self.cfg.beam_size,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500},
                condition_on_previous_text=False,
                hotwords=hotwords or None,
                temperature=0.0,
            )
            parts = []
            for s in segments:
                # drop obvious non-speech hallucinations ("Thank you." over noise)
                if s.no_speech_prob > 0.8 and s.avg_logprob < -1.0:
                    continue
                parts.append(s.text.strip())
        text = " ".join(p for p in parts if p).strip()
        return SttResult(text, info.language, float(info.language_probability), float(info.duration))
