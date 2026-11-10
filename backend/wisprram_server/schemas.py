"""Pydantic models mirroring client/src/shared/api.ts (snake_case on the wire)."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

CleanupLevel = Literal["none", "light", "full"]
Style = Literal["formal", "casual", "very_casual"]


class AppContext(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(max_length=200)
    bundle_id: Optional[str] = None
    window_title: Optional[str] = None


class DictateOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")
    language: Optional[str] = Field(default=None, max_length=16)
    cleanup: Optional[CleanupLevel] = None
    style: Optional[Style] = None
    app: Optional[AppContext] = None


class CommandOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")
    selected_text: str = Field(min_length=1, max_length=50_000)
    app: Optional[AppContext] = None
    language: Optional[str] = Field(default=None, max_length=16)


class Timings(BaseModel):
    decode_ms: int = 0
    stt_ms: int = 0
    llm_ms: int = 0
    total_ms: int = 0


class DictationResult(BaseModel):
    id: str
    raw_text: str
    text: str
    language: str
    audio_ms: int
    word_count: int
    timings: Timings
    applied_snippets: list[str]
    cleanup_used: Literal["llm", "rules", "none"]
    # v0.2: what the server actually applied
    stt_model: Optional[str] = None
    llm_model: Optional[str] = None
    cleanup: Optional[CleanupLevel] = None
    style: Optional[Style] = None
    has_audio: bool = False


class CommandResult(BaseModel):
    id: str
    instruction: str
    text: str
    timings: Timings
    # v0.2
    stt_model: Optional[str] = None
    llm_model: Optional[str] = None
    has_audio: bool = False


class HistoryItem(BaseModel):
    id: str
    created_at: str
    kind: Literal["dictation", "command"]
    raw_text: str
    text: str
    app_name: Optional[str]
    audio_ms: int
    word_count: int
    # v0.2
    has_audio: bool = False
    audio_mime: Optional[str] = None
    meta: dict[str, Any] = Field(default_factory=dict)


class HistoryPage(BaseModel):
    items: list[HistoryItem]
    total: int


class DictionaryInput(BaseModel):
    term: str = Field(min_length=1, max_length=100)
    sounds_like: list[str] = Field(default_factory=list, max_length=20)


class DictionaryEntry(BaseModel):
    id: str
    term: str
    sounds_like: list[str]


class SnippetInput(BaseModel):
    trigger: str = Field(min_length=1, max_length=200)
    expansion: str = Field(min_length=1, max_length=20_000)


class Snippet(BaseModel):
    id: str
    trigger: str
    expansion: str


class ServerSettings(BaseModel):
    stt_model: str
    llm_model: str
    default_cleanup: CleanupLevel
    default_style: Style
    language: str
    styles_by_app: dict[str, Style]
    keep_history_days: int
    # v0.2: server-side audio retention
    save_audio: bool = False
    audio_dir: str = ""  # "" = <data_dir>/audio


class ServerSettingsPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    stt_model: Optional[str] = Field(default=None, min_length=1, max_length=200)
    llm_model: Optional[str] = Field(default=None, min_length=1, max_length=200)
    default_cleanup: Optional[CleanupLevel] = None
    default_style: Optional[Style] = None
    language: Optional[str] = Field(default=None, min_length=1, max_length=16)
    styles_by_app: Optional[dict[str, Style]] = None
    keep_history_days: Optional[int] = Field(default=None, ge=0, le=3650)
    save_audio: Optional[bool] = None
    audio_dir: Optional[str] = Field(default=None, max_length=4096)


class Stats(BaseModel):
    words_total: int
    words_7d: int
    sessions_total: int
    avg_wpm: float
    streak_days: int
    minutes_saved: float


class PairRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    client_name: str = Field(default="client", max_length=100)


class PairResponse(BaseModel):
    token: str


class Ok(BaseModel):
    ok: bool = True
