"""Configuration: defaults < ~/.config/wisprram/server.toml < WISPRRAM_* environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass, field, fields
from pathlib import Path

try:  # Python 3.11+
    import tomllib
except ModuleNotFoundError:  # Python 3.10
    import tomli as tomllib  # type: ignore[no-redef]

VERSION = "0.2.0"


def default_data_dir() -> Path:
    return Path(os.environ.get("WISPRRAM_DATA_DIR") or Path.home() / ".config" / "wisprram").expanduser()


def ollama_url_from_env() -> str:
    """Ollama's own OLLAMA_HOST ("host", "host:port", "http://host:port") as a base URL; local default otherwise."""
    raw = (os.environ.get("OLLAMA_HOST") or "").strip()
    if not raw:
        return "http://127.0.0.1:11434"
    scheme = "http"
    if "://" in raw:
        scheme, raw = raw.split("://", 1)
    raw = raw.rstrip("/")
    host, _, port = raw.partition(":") if not raw.startswith("[") else (raw, "", "")
    if host in ("", "0.0.0.0", "::"):
        host = "127.0.0.1"
    return f"{scheme}://{host}:{port or '11434'}"


@dataclass
class Config:
    host: str = "0.0.0.0"
    port: int = 8790
    data_dir: Path = field(default_factory=default_data_dir)

    # STT
    stt_model: str = "large-v3-turbo"  # faster-whisper alias -> mobiuslabsgmbh/faster-whisper-large-v3-turbo
    stt_cpu_model: str = "small"  # used when CUDA is unavailable
    stt_device: str = "auto"  # auto | cuda | cpu
    stt_compute_type: str = "float16"  # on CUDA; CPU always int8
    beam_size: int = 5
    stt_load: bool = True  # load the model at startup (tests turn this off)

    # LLM (Ollama)
    ollama_url: str = field(default_factory=ollama_url_from_env)  # WISPRRAM_OLLAMA_URL > server.toml > OLLAMA_HOST
    llm_model: str = "qwen2.5:3b"
    llm_timeout_s: float = 6.0
    command_timeout_s: float = 20.0
    llm_keep_alive: str = "30m"

    # Limits
    max_upload_mb: int = 50
    max_audio_s: int = 600

    @property
    def db_path(self) -> Path:
        return self.data_dir / "wisprram.db"

    @property
    def default_audio_dir(self) -> Path:
        return self.data_dir / "audio"

    @property
    def toml_path(self) -> Path:
        return self.data_dir / "server.toml"


_ENV = {
    "host": ("WISPRRAM_HOST", str),
    "port": ("WISPRRAM_PORT", int),
    "data_dir": ("WISPRRAM_DATA_DIR", Path),
    "stt_model": ("WISPRRAM_STT_MODEL", str),
    "stt_cpu_model": ("WISPRRAM_STT_CPU_MODEL", str),
    "stt_device": ("WISPRRAM_STT_DEVICE", str),
    "stt_compute_type": ("WISPRRAM_STT_COMPUTE_TYPE", str),
    "beam_size": ("WISPRRAM_BEAM_SIZE", int),
    "ollama_url": ("WISPRRAM_OLLAMA_URL", str),
    "llm_model": ("WISPRRAM_LLM_MODEL", str),
    "llm_timeout_s": ("WISPRRAM_LLM_TIMEOUT", float),
    "command_timeout_s": ("WISPRRAM_COMMAND_TIMEOUT", float),
    "llm_keep_alive": ("WISPRRAM_LLM_KEEP_ALIVE", str),
    "max_upload_mb": ("WISPRRAM_MAX_UPLOAD_MB", int),
    "max_audio_s": ("WISPRRAM_MAX_AUDIO_S", int),
}


def load_config(**overrides) -> Config:
    cfg = Config()
    # data_dir must be resolved first because server.toml lives there
    if os.environ.get("WISPRRAM_DATA_DIR"):
        cfg.data_dir = Path(os.environ["WISPRRAM_DATA_DIR"]).expanduser()
    if "data_dir" in overrides:
        cfg.data_dir = Path(overrides["data_dir"]).expanduser()
    names = {f.name for f in fields(Config)}
    if cfg.toml_path.exists():
        try:
            data = tomllib.loads(cfg.toml_path.read_text())
        except Exception:
            data = {}
        for k, v in data.items():
            if k in names and k != "data_dir":
                setattr(cfg, k, type(getattr(cfg, k))(v))
    for key, (env, cast) in _ENV.items():
        if key == "data_dir":
            continue
        if env in os.environ:
            setattr(cfg, key, cast(os.environ[env]))
    for k, v in overrides.items():
        if k in names and v is not None:
            setattr(cfg, k, Path(v) if k == "data_dir" else v)
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    return cfg
