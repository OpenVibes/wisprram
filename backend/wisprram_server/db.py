"""SQLite store: history, stats events, dictionary, snippets, settings, tokens, pairing codes."""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

SCHEMA = """
CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ts REAL NOT NULL,
  kind TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  text TEXT NOT NULL,
  app_name TEXT,
  audio_ms INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  language TEXT,
  audio_path TEXT,
  audio_mime TEXT,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_history_ts ON history(ts DESC);
-- Stats survive history deletion/pruning. No text is stored here.
CREATE TABLE IF NOT EXISTS stats_events (
  id TEXT PRIMARY KEY,
  ts REAL NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  words INTEGER NOT NULL,
  audio_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stats_day ON stats_events(day);
CREATE TABLE IF NOT EXISTS dictionary (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL,
  sounds_like TEXT NOT NULL DEFAULT '[]',
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  expansion TEXT NOT NULL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  created_at REAL NOT NULL,
  last_used_at REAL
);
CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  expires_at REAL NOT NULL
);
"""


# Columns added after v0.1 (SCHEMA above is the fresh-install shape; existing DBs are altered in place).
HISTORY_MIGRATIONS = (
    ("audio_path", "TEXT"),
    ("audio_mime", "TEXT"),
    ("meta", "TEXT NOT NULL DEFAULT '{}'"),
)
SCHEMA_VERSION = 2  # PRAGMA user_version: 0/1 = v0.1 shape, 2 = v0.2 (audio retention + meta)


def new_id() -> str:
    return uuid.uuid4().hex


class Database:
    def __init__(self, path: Path | str):
        self.path = str(path)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        if self.path != ":memory:":
            self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._conn.executescript(SCHEMA)
        self._migrate()
        # Called with the audio file paths of history rows that were just deleted (set by Services).
        self.on_audio_removed: Callable[[list[str]], None] | None = None
        if self.path != ":memory:":
            try:
                Path(self.path).chmod(0o600)
            except OSError:
                pass

    def _migrate(self) -> None:
        """Bring an older database up to the current shape. Idempotent; only ever adds columns."""
        with self._lock:
            cols = {r["name"] for r in self._conn.execute("PRAGMA table_info(history)")}
            for name, ddl in HISTORY_MIGRATIONS:
                if name in cols:
                    continue
                try:
                    self._conn.execute(f"ALTER TABLE history ADD COLUMN {name} {ddl}")
                except sqlite3.OperationalError as exc:  # another process migrated first
                    if "duplicate column" not in str(exc).lower():
                        raise
            if self._conn.execute("PRAGMA user_version").fetchone()[0] < SCHEMA_VERSION:
                self._conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # -- low-level -------------------------------------------------
    def _all(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, args).fetchall()

    def _one(self, sql: str, args: tuple = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, args).fetchone()

    def _exec(self, sql: str, args: tuple = ()) -> int:
        with self._lock:
            return self._conn.execute(sql, args).rowcount

    # -- settings --------------------------------------------------
    def get_setting(self, key: str, default: Any = None) -> Any:
        row = self._one("SELECT value FROM settings WHERE key=?", (key,))
        return json.loads(row["value"]) if row else default

    def set_setting(self, key: str, value: Any) -> None:
        self._exec(
            "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value)),
        )

    def all_settings(self) -> dict[str, Any]:
        return {r["key"]: json.loads(r["value"]) for r in self._all("SELECT key,value FROM settings")}

    # -- history ---------------------------------------------------
    def add_history(
        self,
        *,
        kind: str,
        raw_text: str,
        text: str,
        app_name: str | None,
        audio_ms: int,
        word_count: int,
        language: str | None = None,
        item_id: str | None = None,
        audio_path: str | None = None,
        audio_mime: str | None = None,
        meta: dict | None = None,
    ) -> dict:
        now = datetime.now().astimezone()
        item_id = item_id or new_id()
        self._exec(
            "INSERT INTO history(id,created_at,ts,kind,raw_text,text,app_name,audio_ms,word_count,language,"
            "audio_path,audio_mime,meta) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (item_id, now.isoformat(timespec="seconds"), now.timestamp(), kind, raw_text, text,
             app_name, audio_ms, word_count, language, audio_path, audio_mime if audio_path else None,
             json.dumps(meta or {}, ensure_ascii=False)),
        )
        self._exec(
            "INSERT INTO stats_events(id,ts,day,kind,words,audio_ms) VALUES(?,?,?,?,?,?)",
            (item_id, now.timestamp(), now.date().isoformat(), kind, word_count, audio_ms),
        )
        return self.get_history(item_id)  # type: ignore[return-value]

    @staticmethod
    def _hist(r: sqlite3.Row) -> dict:
        try:
            meta = json.loads(r["meta"] or "{}")
            if not isinstance(meta, dict):
                meta = {}
        except ValueError:
            meta = {}
        return {
            "id": r["id"], "created_at": r["created_at"], "kind": r["kind"], "raw_text": r["raw_text"],
            "text": r["text"], "app_name": r["app_name"], "audio_ms": r["audio_ms"], "word_count": r["word_count"],
            "has_audio": bool(r["audio_path"]), "audio_mime": r["audio_mime"] if r["audio_path"] else None,
            "meta": meta,
        }

    def get_audio_ref(self, item_id: str) -> tuple[str, str] | None:
        """(audio_path, audio_mime) recorded for a history row, or None."""
        r = self._one("SELECT audio_path, audio_mime FROM history WHERE id=?", (item_id,))
        if not r or not r["audio_path"]:
            return None
        return r["audio_path"], r["audio_mime"] or "application/octet-stream"

    def get_history(self, item_id: str) -> dict | None:
        r = self._one("SELECT * FROM history WHERE id=?", (item_id,))
        return self._hist(r) if r else None

    def list_history(self, limit: int = 50, offset: int = 0, q: str | None = None) -> tuple[list[dict], int]:
        where, args = "", ()
        if q:
            esc = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            where = " WHERE raw_text LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\'"
            args = (f"%{esc}%", f"%{esc}%")
        total = self._one(f"SELECT COUNT(*) c FROM history{where}", args)["c"]
        rows = self._all(f"SELECT * FROM history{where} ORDER BY ts DESC LIMIT ? OFFSET ?", args + (limit, offset))
        return [self._hist(r) for r in rows], total

    def _delete_where(self, where: str, args: tuple = ()) -> int:
        """Delete history rows and hand their audio files to `on_audio_removed` (files are removed after the
        rows, so a crash leaves at worst an orphan file, never a row pointing at nothing it should have)."""
        with self._lock:
            paths = [r["audio_path"] for r in self._all(
                f"SELECT audio_path FROM history WHERE audio_path IS NOT NULL AND ({where})", args)]
            n = self._exec(f"DELETE FROM history WHERE {where}", args)
        if paths and self.on_audio_removed:
            try:
                self.on_audio_removed(paths)
            except Exception:  # noqa: BLE001 - never let file cleanup break a delete
                logging.getLogger("wisprram.db").exception("removing audio files failed")
        return n

    def delete_history(self, item_id: str) -> bool:
        return self._delete_where("id=?", (item_id,)) > 0

    def clear_history(self) -> int:
        return self._delete_where("1=1")

    def prune_history(self, keep_days: int) -> int:
        if keep_days <= 0:
            return 0
        cutoff = time.time() - keep_days * 86400
        return self._delete_where("ts < ?", (cutoff,))

    # -- stats -----------------------------------------------------
    def stats(self, today: date | None = None, now: float | None = None) -> dict:
        today = today or datetime.now().astimezone().date()
        now = now if now is not None else time.time()
        d = self._one(
            "SELECT COALESCE(SUM(words),0) w, COALESCE(SUM(audio_ms),0) a FROM stats_events WHERE kind='dictation'"
        )
        w7 = self._one(
            "SELECT COALESCE(SUM(words),0) w FROM stats_events WHERE kind='dictation' AND ts >= ?",
            (now - 7 * 86400,),
        )["w"]
        sessions = self._one("SELECT COUNT(*) c FROM stats_events")["c"]
        words, audio_ms = d["w"], d["a"]
        minutes = audio_ms / 60000.0
        avg_wpm = round(words / minutes, 1) if minutes > 0 else 0.0
        minutes_saved = round(max(0.0, words / 40.0 - minutes), 1)
        days = {r["day"] for r in self._all("SELECT DISTINCT day FROM stats_events")}
        streak = compute_streak(days, today)
        return {
            "words_total": int(words), "words_7d": int(w7), "sessions_total": int(sessions),
            "avg_wpm": avg_wpm, "streak_days": streak, "minutes_saved": minutes_saved,
        }

    # -- dictionary ------------------------------------------------
    @staticmethod
    def _dict(r: sqlite3.Row) -> dict:
        return {"id": r["id"], "term": r["term"], "sounds_like": json.loads(r["sounds_like"])}

    def list_dictionary(self) -> list[dict]:
        return [self._dict(r) for r in self._all("SELECT * FROM dictionary ORDER BY created_at, rowid")]

    def get_dictionary(self, entry_id: str) -> dict | None:
        r = self._one("SELECT * FROM dictionary WHERE id=?", (entry_id,))
        return self._dict(r) if r else None

    def find_dictionary_term(self, term: str) -> dict | None:
        r = self._one("SELECT * FROM dictionary WHERE lower(term)=lower(?)", (term,))
        return self._dict(r) if r else None

    def add_dictionary(self, term: str, sounds_like: list[str]) -> dict:
        eid = new_id()
        self._exec("INSERT INTO dictionary(id,term,sounds_like,created_at) VALUES(?,?,?,?)",
                   (eid, term, json.dumps(sounds_like), time.time()))
        return self.get_dictionary(eid)  # type: ignore[return-value]

    def update_dictionary(self, entry_id: str, term: str, sounds_like: list[str]) -> dict | None:
        n = self._exec("UPDATE dictionary SET term=?, sounds_like=? WHERE id=?",
                       (term, json.dumps(sounds_like), entry_id))
        return self.get_dictionary(entry_id) if n else None

    def delete_dictionary(self, entry_id: str) -> bool:
        return self._exec("DELETE FROM dictionary WHERE id=?", (entry_id,)) > 0

    # -- snippets --------------------------------------------------
    @staticmethod
    def _snip(r: sqlite3.Row) -> dict:
        return {"id": r["id"], "trigger": r["trigger"], "expansion": r["expansion"]}

    def list_snippets(self) -> list[dict]:
        return [self._snip(r) for r in self._all("SELECT * FROM snippets ORDER BY created_at, rowid")]

    def get_snippet(self, sid: str) -> dict | None:
        r = self._one("SELECT * FROM snippets WHERE id=?", (sid,))
        return self._snip(r) if r else None

    def find_snippet_trigger(self, trigger: str) -> dict | None:
        r = self._one("SELECT * FROM snippets WHERE lower(trigger)=lower(?)", (trigger,))
        return self._snip(r) if r else None

    def add_snippet(self, trigger: str, expansion: str) -> dict:
        sid = new_id()
        self._exec("INSERT INTO snippets(id,trigger,expansion,created_at) VALUES(?,?,?,?)",
                   (sid, trigger, expansion, time.time()))
        return self.get_snippet(sid)  # type: ignore[return-value]

    def update_snippet(self, sid: str, trigger: str, expansion: str) -> dict | None:
        n = self._exec("UPDATE snippets SET trigger=?, expansion=? WHERE id=?", (trigger, expansion, sid))
        return self.get_snippet(sid) if n else None

    def delete_snippet(self, sid: str) -> bool:
        return self._exec("DELETE FROM snippets WHERE id=?", (sid,)) > 0

    # -- tokens ----------------------------------------------------
    def add_token(self, token_hash: str, client_name: str) -> str:
        tid = new_id()
        self._exec("INSERT INTO tokens(id,token_hash,client_name,created_at) VALUES(?,?,?,?)",
                   (tid, token_hash, client_name, time.time()))
        return tid

    def find_token(self, token_hash: str) -> dict | None:
        r = self._one("SELECT * FROM tokens WHERE token_hash=?", (token_hash,))
        return dict(r) if r else None

    def touch_token(self, tid: str) -> None:
        self._exec("UPDATE tokens SET last_used_at=? WHERE id=?", (time.time(), tid))

    def list_tokens(self) -> list[dict]:
        return [dict(r) for r in self._all("SELECT id,client_name,created_at,last_used_at FROM tokens ORDER BY created_at")]

    # -- pairing codes ---------------------------------------------
    def add_pairing_code(self, code: str, expires_at: float) -> None:
        self._exec("DELETE FROM pairing_codes WHERE expires_at < ?", (time.time(),))
        self._exec("INSERT OR REPLACE INTO pairing_codes(code,expires_at) VALUES(?,?)", (code, expires_at))

    def consume_pairing_code(self, code: str, now: float | None = None) -> bool:
        """Atomically delete the code; True only if it existed and had not expired."""
        now = now if now is not None else time.time()
        with self._lock:
            row = self._one("SELECT expires_at FROM pairing_codes WHERE code=?", (code,))
            if not row:
                return False
            self._exec("DELETE FROM pairing_codes WHERE code=?", (code,))
            return row["expires_at"] >= now


def compute_streak(days: set[str], today: date) -> int:
    """Consecutive days with >=1 session ending today (or yesterday, if today has none yet)."""
    d = today
    if d.isoformat() not in days:
        d = today - timedelta(days=1)
    n = 0
    while d.isoformat() in days:
        n += 1
        d -= timedelta(days=1)
    return n
