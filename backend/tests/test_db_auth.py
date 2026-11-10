import time
from datetime import date, timedelta

import pytest

from wisprram_server import auth
from wisprram_server.db import compute_streak
from wisprram_server.errors import ApiError


def add(db, text="hello world", kind="dictation", audio_ms=6000, words=None, app=None):
    return db.add_history(kind=kind, raw_text=text, text=text, app_name=app, audio_ms=audio_ms,
                          word_count=words if words is not None else len(text.split()))


def test_history_crud_search_paging(db):
    ids = [add(db, f"note number {i}")["id"] for i in range(5)]
    items, total = db.list_history(limit=2, offset=0)
    assert total == 5 and len(items) == 2
    assert items[0]["text"] == "note number 4"  # newest first
    _, t = db.list_history(q="number 3")
    assert t == 1
    _, t = db.list_history(q="100%")  # LIKE wildcards are escaped
    assert t == 0
    assert db.delete_history(ids[0]) and not db.delete_history(ids[0])
    db.clear_history()
    assert db.list_history()[1] == 0


def test_stats_survive_history_delete(db):
    add(db, "one two three four five six", audio_ms=6000)  # 6 words in 6 s -> 60 wpm
    add(db, "seven eight nine ten", audio_ms=4000)  # 4 words / 4 s
    st = db.stats()
    assert st["words_total"] == 10 and st["sessions_total"] == 2
    assert st["avg_wpm"] == 60.0
    assert st["streak_days"] == 1
    assert st["words_7d"] == 10
    # 10 words typed at 40 wpm = 0.25 min; spoke for 1/6 min -> saved ~0.1 min
    assert st["minutes_saved"] == 0.1
    db.clear_history()
    assert db.stats()["words_total"] == 10


def test_stats_empty(db):
    assert db.stats() == {"words_total": 0, "words_7d": 0, "sessions_total": 0, "avg_wpm": 0.0,
                          "streak_days": 0, "minutes_saved": 0.0}


def test_commands_not_counted_as_words(db):
    add(db, "make it shorter", kind="command", words=500)
    st = db.stats()
    assert st["words_total"] == 0 and st["sessions_total"] == 1


def test_streak():
    t = date(2026, 11, 9)
    d = lambda n: (t - timedelta(days=n)).isoformat()  # noqa: E731
    assert compute_streak({d(0), d(1), d(2), d(4)}, t) == 3
    assert compute_streak({d(1), d(2)}, t) == 2  # today not yet used: streak alive
    assert compute_streak({d(2), d(3)}, t) == 0
    assert compute_streak(set(), t) == 0


def test_prune(db):
    a = add(db, "old")
    db._exec("UPDATE history SET ts=? WHERE id=?", (time.time() - 100 * 86400, a["id"]))
    add(db, "new")
    assert db.prune_history(90) == 1
    assert db.prune_history(0) == 0
    assert db.list_history()[1] == 1


def test_settings_roundtrip(db):
    db.set_setting("a", {"x": [1, 2]})
    db.set_setting("a", {"x": [3]})
    assert db.get_setting("a") == {"x": [3]}
    assert db.get_setting("nope", 5) == 5


def test_dictionary_snippets_db(db):
    e = db.add_dictionary("Kubernetes", ["cooper netties"])
    assert db.get_dictionary(e["id"])["sounds_like"] == ["cooper netties"]
    assert db.find_dictionary_term("kubernetes")["id"] == e["id"]
    assert db.update_dictionary(e["id"], "K8s", [])["term"] == "K8s"
    assert db.update_dictionary("missing", "x", []) is None
    s = db.add_snippet("my email", "a@b.c")
    assert db.find_snippet_trigger("MY EMAIL")["id"] == s["id"]
    assert db.delete_snippet(s["id"]) and db.delete_dictionary(e["id"])


# ---- auth ------------------------------------------------------------------
def test_pairing_code_flow(db):
    lim = auth.PairLimiter()
    code, exp = auth.create_pairing_code(db)
    assert len(code) == 6 and code.isdigit()
    assert 590 < exp - time.time() <= 600
    token = auth.pair(db, lim, code, "my mac")
    assert auth.verify_token(db, token)["client_name"] == "my mac"
    with pytest.raises(ApiError) as e:  # single use
        auth.pair(db, lim, code, "again")
    assert e.value.status == 401 and e.value.code == "bad_code"


def test_pairing_code_expires(db):
    lim = auth.PairLimiter()
    code, _ = auth.create_pairing_code(db, ttl_s=-1)
    with pytest.raises(ApiError) as e:
        auth.pair(db, lim, code, "x")
    assert e.value.code == "bad_code"


def test_tokens_stored_hashed(db):
    token = auth.issue_token(db, "c")
    assert len(token) >= 43  # 32 bytes urlsafe
    rows = db._all("SELECT token_hash FROM tokens")
    assert rows[0]["token_hash"] == auth.hash_token(token) != token
    assert auth.verify_token(db, token + "x") is None


def test_pair_rate_limit(db):
    lim = auth.PairLimiter(max_fail=3, window_s=60)
    for _ in range(3):
        with pytest.raises(ApiError):
            auth.pair(db, lim, "000000", "x")
    with pytest.raises(ApiError) as e:
        auth.pair(db, lim, "000000", "x")
    assert e.value.status == 429
