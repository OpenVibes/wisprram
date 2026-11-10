"""Pairing codes, hashed bearer tokens, and the FastAPI auth dependency."""
from __future__ import annotations

import hashlib
import secrets
import threading
import time

from fastapi import Request

from .db import Database
from .errors import ApiError

PAIR_TTL_S = 600


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_pairing_code(db: Database, ttl_s: int = PAIR_TTL_S) -> tuple[str, float]:
    code = f"{secrets.randbelow(1_000_000):06d}"
    expires = time.time() + ttl_s
    db.add_pairing_code(code, expires)
    return code, expires


def issue_token(db: Database, client_name: str) -> str:
    token = secrets.token_urlsafe(32)  # 32 random bytes
    db.add_token(hash_token(token), client_name[:100] or "client")
    return token


def verify_token(db: Database, token: str) -> dict | None:
    row = db.find_token(hash_token(token))
    if row:
        db.touch_token(row["id"])
    return row


class PairLimiter:
    """Crude brute-force guard for the 6-digit code: max N failures per window."""

    def __init__(self, max_fail: int = 8, window_s: float = 60.0):
        self.max_fail, self.window_s = max_fail, window_s
        self._fails: list[float] = []
        self._lock = threading.Lock()

    def check(self) -> None:
        now = time.time()
        with self._lock:
            self._fails = [t for t in self._fails if now - t < self.window_s]
            if len(self._fails) >= self.max_fail:
                raise ApiError(429, "too_many_attempts", "too many failed pairing attempts; wait a minute")

    def fail(self) -> None:
        with self._lock:
            self._fails.append(time.time())


def pair(db: Database, limiter: PairLimiter, code: str, client_name: str) -> str:
    limiter.check()
    code = (code or "").strip().replace(" ", "")
    if not db.consume_pairing_code(code):
        limiter.fail()
        raise ApiError(401, "bad_code", "invalid or expired pairing code")
    return issue_token(db, client_name)


def require_auth(request: Request) -> dict:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ApiError(401, "unauthorized", "missing bearer token")
    row = verify_token(request.app.state.svc.db, token.strip())
    if not row:
        raise ApiError(401, "unauthorized", "invalid token")
    return row
