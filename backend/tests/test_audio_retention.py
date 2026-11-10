"""v0.2: server-side audio retention, history metadata, v0.1 -> v0.2 DB migration."""
import json
import os
import sqlite3
import time
from pathlib import Path

import pytest

from wisprram_server.audio_store import guess_ext
from wisprram_server.db import SCHEMA_VERSION, Database


def put(client, H, **body):
    return client.put("/v1/settings", headers=H, json=body)


def err(r, status, code):
    assert r.status_code == status, r.text
    assert r.json()["error"]["code"] == code and r.json()["error"]["message"]


def dictate(client, H, wav, name="a.wav", mime="audio/wav", **opts):
    return client.post("/v1/dictate", headers=H, files={"audio": (name, wav, mime)},
                       data={"options": json.dumps(opts)})


def command(client, H, wav, **opts):
    return client.post("/v1/command", headers=H, files={"audio": ("c.wav", wav, "audio/wav")},
                       data={"options": json.dumps(opts)})


@pytest.fixture()
def adir(tmp_path):
    return tmp_path / "kept-audio"


@pytest.fixture()
def keep(client, H, adir):
    r = put(client, H, save_audio=True, audio_dir=str(adir))
    assert r.status_code == 200, r.text
    return adir


def files_under(d: Path) -> list[Path]:
    return sorted(p for p in d.rglob("*") if p.is_file())


# ---- migration ---------------------------------------------------------------
V01_SCHEMA = """
CREATE TABLE history (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, ts REAL NOT NULL, kind TEXT NOT NULL,
  raw_text TEXT NOT NULL, text TEXT NOT NULL, app_name TEXT, audio_ms INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0, language TEXT);
CREATE INDEX idx_history_ts ON history(ts DESC);
CREATE TABLE stats_events (id TEXT PRIMARY KEY, ts REAL NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL,
  words INTEGER NOT NULL, audio_ms INTEGER NOT NULL);
CREATE TABLE dictionary (id TEXT PRIMARY KEY, term TEXT NOT NULL, sounds_like TEXT NOT NULL DEFAULT '[]',
  created_at REAL NOT NULL);
CREATE TABLE snippets (id TEXT PRIMARY KEY, trigger TEXT NOT NULL, expansion TEXT NOT NULL, created_at REAL NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE tokens (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, client_name TEXT NOT NULL,
  created_at REAL NOT NULL, last_used_at REAL);
CREATE TABLE pairing_codes (code TEXT PRIMARY KEY, expires_at REAL NOT NULL);
"""


def make_v01_db(path: Path) -> None:
    c = sqlite3.connect(path)
    c.executescript(V01_SCHEMA)
    c.execute("INSERT INTO history VALUES('old1','2026-01-01T10:00:00+00:00',1767261600,'dictation','um hi','Hi.',"
              "'Slack',1200,1,'en')")
    c.execute("INSERT INTO settings VALUES('default_style','\"formal\"')")
    c.execute("INSERT INTO dictionary VALUES('d1','Kubernetes','[]',1)")
    c.commit()
    c.close()


def test_migrates_v01_database_in_place(tmp_path):
    path = tmp_path / "wisprram.db"
    make_v01_db(path)
    db = Database(path)
    cols = {r[1] for r in sqlite3.connect(path).execute("PRAGMA table_info(history)")}
    assert {"audio_path", "audio_mime", "meta"} <= cols
    item = db.get_history("old1")
    assert item["text"] == "Hi." and item["app_name"] == "Slack" and item["audio_ms"] == 1200  # data kept
    assert item["has_audio"] is False and item["audio_mime"] is None and item["meta"] == {}
    assert db.get_setting("default_style") == "formal" and len(db.list_dictionary()) == 1
    # new rows work next to old ones
    new = db.add_history(kind="dictation", raw_text="a", text="A", app_name=None, audio_ms=1, word_count=1,
                         audio_path="/x/y.wav", audio_mime="audio/wav", meta={"k": 1})
    assert new["has_audio"] and new["meta"] == {"k": 1}
    assert db.list_history()[1] == 2
    db.close()
    assert sqlite3.connect(path).execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION


def test_migration_is_idempotent(tmp_path):
    path = tmp_path / "wisprram.db"
    make_v01_db(path)
    for _ in range(3):
        Database(path).close()
    db = Database(path)
    assert db.get_history("old1")["meta"] == {}
    assert db.list_history()[1] == 1


def test_fresh_database_has_new_columns(tmp_path):
    db = Database(tmp_path / "n.db")
    cols = [r[1] for r in sqlite3.connect(tmp_path / "n.db").execute("PRAGMA table_info(history)")]
    assert cols.count("audio_path") == 1 and "meta" in cols


# ---- extension / mime --------------------------------------------------------
@pytest.mark.parametrize("ct,fn,data,ext", [
    ("audio/webm;codecs=opus", "x", b"", "webm"), ("video/webm", None, b"", "webm"),
    ("audio/wav", "x.bin", b"", "wav"), ("audio/x-wav", None, b"", "wav"),
    ("audio/mp4", "x", b"", "m4a"), ("audio/x-m4a", None, b"", "m4a"),
    ("audio/ogg", "x", b"", "ogg"), ("audio/mpeg", None, b"", "mp3"),
    ("application/octet-stream", "rec.MP3", b"", "mp3"), (None, "voice.m4a", b"", "m4a"),
    ("application/octet-stream", "blob", b"RIFF\0\0\0\0WAVEfmt ", "wav"),
    ("application/octet-stream", "blob", b"\x1a\x45\xdf\xa3....", "webm"),
    ("application/octet-stream", "blob", b"OggS\0\0", "ogg"),
    ("", "", b"\0\0\0\x18ftypM4A ", "m4a"),
    ("application/octet-stream", "weird.xyz", b"nope", "bin"), (None, None, b"", "bin"),
])
def test_guess_ext(ct, fn, data, ext):
    assert guess_ext(ct, fn, data) == ext


# ---- settings validation -----------------------------------------------------
def test_settings_defaults(client, H):
    s = client.get("/v1/settings", headers=H).json()
    assert s["save_audio"] is False and s["audio_dir"] == ""


def test_audio_dir_validation(client, H, tmp_path, monkeypatch):
    err(put(client, H, audio_dir="relative/dir"), 400, "bad_audio_dir")
    err(put(client, H, audio_dir="~nosuchuser_zz/x"), 400, "bad_audio_dir")
    blocker = tmp_path / "afile"
    blocker.write_text("x")
    err(put(client, H, audio_dir=str(blocker)), 400, "bad_audio_dir")          # a file, not a folder
    err(put(client, H, audio_dir=str(blocker / "sub")), 400, "bad_audio_dir")   # cannot create below a file
    err(put(client, H, audio_dir="/proc/wisprram-nope"), 400, "bad_audio_dir")
    # a rejected PUT changes nothing, even for the other fields in the same request
    err(put(client, H, audio_dir="nope", save_audio=True, default_style="formal"), 400, "bad_audio_dir")
    s = client.get("/v1/settings", headers=H).json()
    assert s["save_audio"] is False and s["audio_dir"] == "" and s["default_style"] == "casual"
    # '' is valid; so is a missing absolute dir (created), and ~ is expanded
    assert put(client, H, audio_dir="").status_code == 200
    made = tmp_path / "a" / "b"
    r = put(client, H, audio_dir=str(made))
    assert r.status_code == 200 and r.json()["audio_dir"] == str(made) and made.is_dir()
    monkeypatch.setenv("HOME", str(tmp_path))
    r = put(client, H, audio_dir="~/from-home")
    assert r.json()["audio_dir"] == str(tmp_path / "from-home") and (tmp_path / "from-home").is_dir()
    assert put(client, H, save_audio=True).json()["save_audio"] is True
    assert put(client, H, audio_dir="").json()["audio_dir"] == ""


@pytest.mark.skipif(os.geteuid() == 0, reason="root can write anywhere")
def test_audio_dir_not_writable(client, H, tmp_path):
    ro = tmp_path / "ro"
    ro.mkdir()
    ro.chmod(0o500)
    try:
        err(put(client, H, audio_dir=str(ro)), 400, "bad_audio_dir")
        err(put(client, H, audio_dir=str(ro / "child")), 400, "bad_audio_dir")
    finally:
        ro.chmod(0o700)


# ---- storing -----------------------------------------------------------------
def test_not_stored_by_default(client, H, wav, cfg):
    j = dictate(client, H, wav).json()
    assert j["has_audio"] is False
    h = client.get(f"/v1/history/{j['id']}", headers=H).json()
    assert h["has_audio"] is False and h["audio_mime"] is None
    assert not cfg.default_audio_dir.exists()


def test_dictate_stores_original_bytes(client, H, wav, keep, stt):
    j = dictate(client, H, wav, cleanup="light", style="formal", app={"name": "Slack", "bundle_id": "com.x"}).json()
    assert j["has_audio"] is True
    month = time.strftime("%Y-%m")
    f = keep / month / f"{j['id']}.wav"
    assert f.read_bytes() == wav
    assert oct(f.stat().st_mode & 0o777) == "0o600"
    assert not list(keep.rglob("*.part"))
    item = client.get(f"/v1/history/{j['id']}", headers=H).json()
    assert item["has_audio"] is True and item["audio_mime"] == "audio/wav"
    assert set(item) == {"id", "created_at", "kind", "raw_text", "text", "app_name", "audio_ms", "word_count",
                         "has_audio", "audio_mime", "meta"}
    m = item["meta"]
    assert m["stt_model"] == "fake-whisper" and m["llm_model"] == "qwen2.5:3b"
    assert m["cleanup"] == "light" and m["style"] == "formal" and m["language"] == "en"
    assert m["cleanup_used"] == "rules" and m["applied_snippets"] == [] and m["audio_ms"] == 1500
    assert m["app"] == {"name": "Slack", "bundle_id": "com.x"}
    assert set(m["timings"]) == {"decode_ms", "stt_ms", "llm_ms", "total_ms"}


def test_dictation_result_new_fields(client, H, wav):
    j = dictate(client, H, wav, cleanup="none", style="very_casual").json()
    assert j["stt_model"] == "fake-whisper" and j["llm_model"] == "qwen2.5:3b"
    assert j["cleanup"] == "none" and j["style"] == "very_casual" and j["has_audio"] is False
    j = dictate(client, H, wav).json()  # defaults resolved from settings
    assert j["cleanup"] == "full" and j["style"] == "casual"


def test_per_app_style_is_reported(client, H, wav):
    put(client, H, styles_by_app={"Mail": "formal"})
    assert dictate(client, H, wav, cleanup="none", app={"name": "mail"}).json()["style"] == "formal"


def test_extension_follows_upload_type(client, H, wav, keep):
    # The audio is wav whatever it is called, so decoding works; only the stored extension is under test.
    for name, mime, ext in [("a.webm", "audio/webm;codecs=opus", "webm"), ("a.m4a", "audio/mp4", "m4a"),
                            ("a.ogg", "audio/ogg", "ogg"), ("a.mp3", "audio/mpeg", "mp3"),
                            ("blob", "application/octet-stream", "wav")]:  # wav bytes are sniffed
        j = dictate(client, H, wav, name=name, mime=mime).json()
        stored = [p for p in files_under(keep) if p.stem == j["id"]]
        assert len(stored) == 1 and stored[0].suffix == f".{ext}"


def test_audio_mime_per_type(client, H, wav, keep):
    for mime, expect in [("audio/webm", "audio/webm"), ("audio/mp4", "audio/mp4"), ("audio/ogg", "audio/ogg"),
                         ("audio/mpeg", "audio/mpeg"), ("audio/wav", "audio/wav")]:
        j = dictate(client, H, wav, mime=mime).json()
        assert client.get(f"/v1/history/{j['id']}", headers=H).json()["audio_mime"] == expect
        assert client.get(f"/v1/history/{j['id']}/audio", headers=H).headers["content-type"] == expect


def test_unknown_type_falls_back_to_bin(client, H, wav, keep):
    j = dictate(client, H, b"junk" + wav[4:], name="x.xyz", mime="application/octet-stream")
    assert j.status_code in (200, 415)  # decoding may or may not accept it
    if j.status_code == 200:
        assert [p for p in files_under(keep)][0].suffix == ".bin"


def test_command_stores_audio_and_meta(client, H, wav, keep, stt, llm):
    stt.text = "make this polite"
    llm.reply = "Could you send it, please?"
    r = command(client, H, wav, selected_text="send it now", app={"name": "Mail"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["has_audio"] is True and j["stt_model"] == "fake-whisper" and j["llm_model"] == "qwen2.5:3b"
    item = client.get(f"/v1/history/{j['id']}", headers=H).json()
    assert item["kind"] == "command" and item["has_audio"] and item["audio_mime"] == "audio/wav"
    m = item["meta"]
    assert m["selected_text"] == "send it now" and m["instruction"] == "make this polite"
    assert m["app"] == {"name": "Mail"} and m["stt_model"] == "fake-whisper" and "timings" in m
    assert (keep / time.strftime("%Y-%m") / f"{j['id']}.wav").exists()


def test_empty_results_store_nothing(client, H, wav, keep, stt):
    stt.text = ""
    assert dictate(client, H, wav).json()["has_audio"] is False
    assert command(client, H, wav, selected_text="keep").json()["has_audio"] is False
    assert files_under(keep) == []


def test_write_failure_does_not_fail_dictation(client, H, wav, keep, monkeypatch):
    def boom(*a, **k):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(os, "replace", boom)
    r = dictate(client, H, wav)
    assert r.status_code == 200 and r.json()["has_audio"] is False
    item = client.get(f"/v1/history/{r.json()['id']}", headers=H).json()
    assert item["has_audio"] is False and item["text"]
    assert not list(keep.rglob("*.part"))  # temp file cleaned up
    err(client.get(f"/v1/history/{r.json()['id']}/audio", headers=H), 404, "no_audio")


def test_unwritable_dir_at_runtime_does_not_fail_dictation(client, H, wav, tmp_path):
    blocker = tmp_path / "blocker"
    blocker.write_text("x")
    client.svc.db.set_setting("save_audio", True)
    client.svc.db.set_setting("audio_dir", str(blocker / "sub"))  # bypasses API validation on purpose
    r = dictate(client, H, wav)
    assert r.status_code == 200 and r.json()["has_audio"] is False


# ---- serving -----------------------------------------------------------------
def test_get_history_item_and_audio(client, H, wav, keep):
    j = dictate(client, H, wav).json()
    r = client.get(f"/v1/history/{j['id']}/audio", headers=H)
    assert r.status_code == 200 and r.content == wav
    assert r.headers["content-type"] == "audio/wav"
    assert j["id"] in r.headers["content-disposition"]
    part = client.get(f"/v1/history/{j['id']}/audio", headers={**H, "Range": "bytes=0-3"})
    assert part.status_code == 206 and part.content == wav[:4]


def test_new_routes_need_auth(client, H, wav, keep):
    j = dictate(client, H, wav).json()
    for path in (f"/v1/history/{j['id']}", f"/v1/history/{j['id']}/audio"):
        err(client.get(path), 401, "unauthorized")
        err(client.get(path, headers={"Authorization": "Bearer nope"}), 401, "unauthorized")


def test_get_unknown_and_no_audio(client, H, wav):
    err(client.get("/v1/history/nope", headers=H), 404, "not_found")
    err(client.get("/v1/history/nope/audio", headers=H), 404, "not_found")
    j = dictate(client, H, wav).json()  # save_audio off
    err(client.get(f"/v1/history/{j['id']}/audio", headers=H), 404, "no_audio")


def test_audio_file_missing_on_disk(client, H, wav, keep):
    j = dictate(client, H, wav).json()
    files_under(keep)[0].unlink()
    assert client.get(f"/v1/history/{j['id']}", headers=H).json()["has_audio"] is True  # row still says so
    err(client.get(f"/v1/history/{j['id']}/audio", headers=H), 404, "no_audio")
    assert client.delete(f"/v1/history/{j['id']}", headers=H).json() == {"ok": True}  # missing file is ignored


def test_old_rows_have_empty_meta(client, H):
    client.svc.db._exec("INSERT INTO history(id,created_at,ts,kind,raw_text,text,audio_ms,word_count)"
                        " VALUES('legacy','2026-01-01T00:00:00+00:00',1,'dictation','r','t',10,1)")
    client.svc.db._exec("UPDATE history SET meta='' WHERE id='legacy'")  # even a blank value must not break
    item = client.get("/v1/history/legacy", headers=H).json()
    assert item["has_audio"] is False and item["meta"] == {} and item["audio_mime"] is None
    assert client.get("/v1/history", headers=H).json()["items"][0]["meta"] == {}


# ---- deleting / pruning ------------------------------------------------------
def test_delete_item_removes_file_and_empty_month_dir(client, H, wav, keep):
    a, b = dictate(client, H, wav).json(), dictate(client, H, wav).json()
    assert len(files_under(keep)) == 2
    assert client.delete(f"/v1/history/{a['id']}", headers=H).json() == {"ok": True}
    left = files_under(keep)
    assert len(left) == 1 and left[0].stem == b["id"]
    client.delete(f"/v1/history/{b['id']}", headers=H)
    assert files_under(keep) == [] and keep.is_dir()  # month folder gone, audio root stays


def test_clear_history_removes_all_audio(client, H, wav, keep):
    for _ in range(3):
        dictate(client, H, wav)
    assert len(files_under(keep)) == 3
    assert client.delete("/v1/history", headers=H).json() == {"ok": True}
    assert files_under(keep) == []


def test_pruning_removes_audio(client, H, wav, keep):
    old, new = dictate(client, H, wav).json(), dictate(client, H, wav).json()
    client.svc.db._exec("UPDATE history SET ts=? WHERE id=?", (time.time() - 100 * 86400, old["id"]))
    # lowering keep_history_days through the API prunes immediately
    assert put(client, H, keep_history_days=30).status_code == 200
    assert [p.stem for p in files_under(keep)] == [new["id"]]
    assert client.get(f"/v1/history/{old['id']}", headers=H).status_code == 404
    client.svc.db._exec("UPDATE history SET ts=? WHERE id=?", (time.time() - 40 * 86400, new["id"]))
    assert client.svc.db.prune_history(30) == 1  # the periodic pruner path
    assert files_under(keep) == []


def test_changing_audio_dir_keeps_old_files_reachable(client, H, wav, keep, tmp_path):
    first = dictate(client, H, wav).json()
    other = tmp_path / "second"
    assert put(client, H, audio_dir=str(other)).status_code == 200
    second = dictate(client, H, wav).json()
    assert files_under(keep)[0].stem == first["id"] and files_under(other)[0].stem == second["id"]  # nothing moved
    assert client.get(f"/v1/history/{first['id']}/audio", headers=H).content == wav  # old row keeps its own path
    client.delete(f"/v1/history/{first['id']}", headers=H)
    assert files_under(keep) == []
    client.delete("/v1/history", headers=H)
    assert files_under(other) == []


def test_default_audio_dir_under_data_dir(client, H, wav, cfg):
    assert put(client, H, save_audio=True).status_code == 200
    j = dictate(client, H, wav).json()
    assert (cfg.data_dir / "audio" / time.strftime("%Y-%m") / f"{j['id']}.wav").read_bytes() == wav


# ---- path safety -------------------------------------------------------------
def test_traversal_in_url_cannot_reach_files(client, H, wav, keep, tmp_path):
    (tmp_path / "secret.txt").write_text("top secret")
    dictate(client, H, wav)
    for bad in ("..%2F..%2Fsecret.txt", "%2e%2e%2fsecret.txt", "../../secret.txt", "..%5Csecret.txt"):
        r = client.get(f"/v1/history/{bad}/audio", headers=H)
        assert r.status_code == 404 and b"top secret" not in r.content


def test_tampered_row_pointing_outside_is_not_served_or_deleted(client, H, wav, keep, tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("top secret")
    j = dictate(client, H, wav).json()
    client.svc.db._exec("UPDATE history SET audio_path=?, audio_mime='text/plain' WHERE id=?", (str(secret), j["id"]))
    err(client.get(f"/v1/history/{j['id']}/audio", headers=H), 404, "no_audio")
    client.delete(f"/v1/history/{j['id']}", headers=H)
    assert secret.read_text() == "top secret"  # never deleted either


def test_dotdot_path_in_row_is_not_followed(client, H, wav, keep, tmp_path):
    (tmp_path / "secret.txt").write_text("top secret")
    j = dictate(client, H, wav).json()
    sneaky = str(keep / time.strftime("%Y-%m") / ".." / ".." / "secret.txt")
    client.svc.db._exec("UPDATE history SET audio_path=? WHERE id=?", (sneaky, j["id"]))
    err(client.get(f"/v1/history/{j['id']}/audio", headers=H), 404, "no_audio")


def test_symlink_escaping_audio_dir_is_not_served(client, H, wav, keep, tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("top secret")
    j = dictate(client, H, wav).json()
    real = files_under(keep)[0]
    real.unlink()
    real.symlink_to(secret)
    err(client.get(f"/v1/history/{j['id']}/audio", headers=H), 404, "no_audio")
    client.delete(f"/v1/history/{j['id']}", headers=H)
    assert secret.read_text() == "top secret"


# ---- CLI / doctor / config ---------------------------------------------------
def test_doctor_runs_and_reports(cfg, capsys):
    from wisprram_server import doctor

    cfg.ollama_url = "http://127.0.0.1:9"  # nothing listens there
    cfg.port = 18790 + os.getpid() % 1000
    cfg.stt_device = "cpu"
    code = doctor.run(cfg)
    out = capsys.readouterr().out
    assert code == 0, out  # an absent Ollama / uncached model are warnings, not failures
    assert "Data dir writable" in out and "Audio dir writable" in out and "Python 3." in out
    assert "Ollama" in out and "fix:" in out and "ollama.com/install.sh" in out
    assert "Port" in out and "Speech model" in out


def test_doctor_fails_on_unwritable_data_dir(cfg, capsys):
    from wisprram_server import doctor

    cfg.ollama_url = "http://127.0.0.1:9"
    cfg.stt_device = "cpu"
    cfg.data_dir = Path("/proc/nonexistent-wisprram")
    assert doctor.run(cfg) == 1
    assert "Data dir writable" in capsys.readouterr().out


def test_config_command(cfg, capsys, monkeypatch):
    from wisprram_server import cli

    monkeypatch.setenv("WISPRRAM_DATA_DIR", str(cfg.data_dir))
    db = Database(cfg.db_path)
    db.set_setting("llm_model", "other:1b")
    db.close()
    c = cli.load_config()
    assert cli.main.__name__ == "main"
    with pytest.raises(SystemExit) as e:
        cli.main(["config", "llm_model"])
    assert e.value.code == 0 and capsys.readouterr().out.strip() == "other:1b"
    assert c.data_dir == cfg.data_dir


def test_ollama_host_env(monkeypatch):
    from wisprram_server.config import ollama_url_from_env

    monkeypatch.delenv("OLLAMA_HOST", raising=False)
    assert ollama_url_from_env() == "http://127.0.0.1:11434"
    for raw, want in [("10.0.0.5", "http://10.0.0.5:11434"), ("box:9999", "http://box:9999"),
                      ("https://o.example:443/", "https://o.example:443"), ("0.0.0.0:11500", "http://127.0.0.1:11500")]:
        monkeypatch.setenv("OLLAMA_HOST", raw)
        assert ollama_url_from_env() == want
