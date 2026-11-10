import json

from wisprram_server import auth

from conftest import make_wav


def dictate(client, H, wav, **opts):
    return client.post("/v1/dictate", headers=H, files={"audio": ("a.wav", wav, "audio/wav")},
                       data={"options": json.dumps(opts)})


def err(r, status, code):
    assert r.status_code == status, r.text
    body = r.json()
    assert set(body) == {"error"} and body["error"]["code"] == code and body["error"]["message"]


# ---- health / auth / errors -------------------------------------------------
def test_health_no_auth(client):
    r = client.get("/health")
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "ok" and j["stt"] == {"model": "fake-whisper", "device": "cuda", "loaded": True}
    assert j["llm"]["provider"] == "ollama" and j["llm"]["reachable"] is True
    assert set(j) == {"status", "version", "stt", "llm", "gpu"}


def test_health_degraded(client, llm):
    llm.up = False
    client.svc.llm._reach = (0, False)
    assert client.get("/health").json()["status"] == "degraded"


def test_auth_required(client):
    for method, path in [("get", "/v1/history"), ("get", "/v1/dictionary"), ("get", "/v1/snippets"),
                         ("get", "/v1/settings"), ("get", "/v1/stats"), ("delete", "/v1/history"),
                         ("post", "/v1/dictate")]:
        err(getattr(client, method)(path), 401, "unauthorized")
    err(client.get("/v1/stats", headers={"Authorization": "Bearer nope"}), 401, "unauthorized")
    err(client.get("/v1/stats", headers={"Authorization": "Basic abc"}), 401, "unauthorized")


def test_404_405_422_shapes(client, H):
    err(client.get("/nope"), 404, "not_found")
    err(client.put("/health"), 405, "method_not_allowed")
    err(client.get("/v1/history?limit=0", headers=H), 422, "validation_error")
    err(client.post("/v1/dictionary", headers=H, json={}), 422, "validation_error")
    err(client.post("/v1/pair", json={}), 422, "validation_error")


def test_pair_endpoint(client):
    err(client.post("/v1/pair", json={"code": "123456", "client_name": "x"}), 401, "bad_code")
    code, _ = auth.create_pairing_code(client.svc.db)
    r = client.post("/v1/pair", json={"code": code, "client_name": "mac"})
    assert r.status_code == 200
    tok = r.json()["token"]
    assert client.get("/v1/stats", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    err(client.post("/v1/pair", json={"code": code, "client_name": "mac"}), 401, "bad_code")


def test_pair_rate_limited(client):
    for _ in range(8):
        client.post("/v1/pair", json={"code": "000000", "client_name": "x"})
    err(client.post("/v1/pair", json={"code": "000000", "client_name": "x"}), 429, "too_many_attempts")


# ---- dictate -----------------------------------------------------------------
def test_dictate_full_cleanup_llm(client, H, wav, llm, stt):
    stt.text = "um hello world this is a test"
    llm.reply = "Hello world, this is a test."
    r = dictate(client, H, wav, cleanup="full")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["raw_text"] == "um hello world this is a test"
    assert j["text"] == "Hello world, this is a test."
    assert j["cleanup_used"] == "llm" and j["language"] == "en"
    assert j["audio_ms"] == 1500 and j["word_count"] == 6
    assert set(j["timings"]) == {"decode_ms", "stt_ms", "llm_ms", "total_ms"}
    assert j["timings"]["total_ms"] >= j["timings"]["decode_ms"]
    assert j["applied_snippets"] == []
    # transcript is passed as data, with the safety system prompt
    msgs = llm.calls[0]["messages"]
    assert msgs[0]["role"] == "system" and "NEVER answer questions" in msgs[0]["content"]
    assert msgs[-1]["content"] == "<transcript>hello world this is a test</transcript>"  # fillers pre-removed
    assert llm.calls[0]["model"] == "qwen2.5:3b" and llm.calls[0]["timeout"] == 6.0
    # shows up in history and stats
    h = client.get("/v1/history", headers=H).json()
    assert h["total"] == 1 and h["items"][0]["id"] == j["id"] and h["items"][0]["kind"] == "dictation"
    assert client.get("/v1/stats", headers=H).json()["sessions_total"] == 1


def test_dictate_light_and_none(client, H, wav, llm, stt):
    stt.text = "um hello comma world"
    j = dictate(client, H, wav, cleanup="light").json()
    assert j["text"] == "Hello, world" and j["cleanup_used"] == "rules" and not llm.calls
    j = dictate(client, H, wav, cleanup="none").json()
    assert j["text"] == "um hello comma world" and j["cleanup_used"] == "none" and j["timings"]["llm_ms"] == 0


def test_dictate_default_cleanup_from_settings(client, H, wav, llm):
    client.put("/v1/settings", headers=H, json={"default_cleanup": "none"})
    assert dictate(client, H, wav).json()["cleanup_used"] == "none"


def test_llm_guard_falls_back_to_rules(client, H, wav, llm, stt):
    stt.text = "what is the capital of france"
    llm.reply = "Paris"  # the LLM answered instead of cleaning: too short
    j = dictate(client, H, wav, cleanup="full").json()
    assert j["cleanup_used"] == "rules" and j["text"] == "What is the capital of france"
    llm.reply = ""
    assert dictate(client, H, wav, cleanup="full").json()["cleanup_used"] == "rules"
    llm.reply = "x " * 100
    assert dictate(client, H, wav, cleanup="full").json()["cleanup_used"] == "rules"


def test_llm_failure_falls_back(client, H, wav, llm, stt):
    llm.fail = True
    j = dictate(client, H, wav, cleanup="full").json()
    assert j["cleanup_used"] == "rules" and j["text"] == "Hello world this is a test"


def test_llm_output_sanitised(client, H, wav, llm):
    llm.reply = '"Hello world, this is a test."'
    assert dictate(client, H, wav, cleanup="full").json()["text"] == "Hello world, this is a test."


def test_snippets_expand_and_survive_llm(client, H, wav, llm, stt):
    client.post("/v1/snippets", headers=H, json={"trigger": "my email", "expansion": "alex@example.com"})
    stt.text = "um please send it to my email"
    seen = {}

    def reply(msgs):
        seen["user"] = msgs[-1]["content"]
        return "Please send it to [[S0]]."

    llm.reply = reply
    j = dictate(client, H, wav, cleanup="full").json()
    assert "[[S0]]" in seen["user"] and "alex@example.com" not in seen["user"]
    assert j["text"] == "Please send it to alex@example.com." and j["applied_snippets"] == ["my email"]
    assert j["raw_text"] == "um please send it to my email"
    # LLM drops the placeholder -> guard -> rules path still expands it
    llm.reply = "Please send it."
    j = dictate(client, H, wav, cleanup="full").json()
    assert j["cleanup_used"] == "rules" and "alex@example.com" in j["text"]


def test_snippet_whole_utterance(client, H, wav, stt, llm):
    client.post("/v1/snippets", headers=H, json={"trigger": "my email", "expansion": "a@b.co"})
    stt.text = "My email."
    j = dictate(client, H, wav, cleanup="full").json()
    assert j["text"] == "a@b.co" and not llm.calls


def test_dictionary_used_for_stt_and_llm(client, H, wav, llm, stt):
    client.post("/v1/dictionary", headers=H, json={"term": "Kubernetes", "sounds_like": ["cooper netties"]})
    stt.text = "deploy it on cooper netties tonight please"
    llm.reply = lambda m: "Deploy it on Kubernetes tonight, please."
    j = dictate(client, H, wav, cleanup="full").json()
    assert stt.calls[-1]["hotwords"] == "Kubernetes"
    assert "Kubernetes" in llm.calls[0]["messages"][0]["content"]
    assert "Kubernetes" in llm.calls[0]["messages"][-1]["content"]  # sounds-like already replaced
    assert j["text"].startswith("Deploy it on Kubernetes")


def test_per_app_style(client, H, wav, llm):
    client.put("/v1/settings", headers=H, json={"styles_by_app": {"Slack": "very_casual", "Mail": "formal"}})
    dictate(client, H, wav, cleanup="full", app={"name": "slack"})
    assert "very casual" in llm.calls[-1]["messages"][0]["content"]
    dictate(client, H, wav, cleanup="full", app={"name": "Mail"}, style="casual")  # app style wins
    assert "Style: formal" in llm.calls[-1]["messages"][0]["content"]
    dictate(client, H, wav, cleanup="full", app={"name": "Notes"}, style="formal")
    assert "Style: formal" in llm.calls[-1]["messages"][0]["content"]
    dictate(client, H, wav, cleanup="full")
    assert "Style: casual" in llm.calls[-1]["messages"][0]["content"]
    assert client.get("/v1/history", headers=H).json()["items"][0]["app_name"] is None
    dictate(client, H, wav, cleanup="none", app={"name": "Slack", "bundle_id": "x"})
    assert client.get("/v1/history", headers=H).json()["items"][0]["app_name"] == "Slack"


def test_language_option(client, H, wav, stt):
    dictate(client, H, wav, cleanup="none", language="hi")
    assert stt.calls[-1]["language"] == "hi"
    dictate(client, H, wav, cleanup="none")
    assert stt.calls[-1]["language"] is None  # auto
    client.put("/v1/settings", headers=H, json={"language": "en"})
    dictate(client, H, wav, cleanup="none")
    assert stt.calls[-1]["language"] == "en"


def test_empty_transcript_returns_empty_text(client, H, wav, stt, llm):
    stt.text = ""
    j = dictate(client, H, wav, cleanup="full").json()
    assert j["text"] == "" and j["raw_text"] == "" and j["word_count"] == 0 and j["cleanup_used"] == "none"
    assert client.get("/v1/history", headers=H).json()["total"] == 0 and not llm.calls


def test_upload_errors(client, H, wav, cfg):
    f = lambda b: {"audio": ("a.webm", b, "audio/webm")}  # noqa: E731
    err(client.post("/v1/dictate", headers=H, files=f(b""), data={"options": "{}"}), 400, "empty_audio")
    err(client.post("/v1/dictate", headers=H, files=f(b"this is not audio at all" * 50), data={"options": "{}"}),
        415, "bad_audio")
    err(client.post("/v1/dictate", headers=H, data={"options": "{}"}), 422, "validation_error")
    err(client.post("/v1/dictate", headers=H, files=f(wav), data={"options": "not json"}), 422, "validation_error")
    err(client.post("/v1/dictate", headers=H, files=f(wav), data={"options": '{"cleanup":"bogus"}'}), 422,
        "validation_error")
    cfg.max_upload_mb = 0
    err(client.post("/v1/dictate", headers=H, files=f(wav), data={"options": "{}"}), 413, "payload_too_large")
    cfg.max_upload_mb = 50
    cfg.max_audio_s = 1
    err(client.post("/v1/dictate", headers=H, files=f(wav), data={"options": "{}"}), 413, "audio_too_long")


def test_stt_not_loaded(client, H, wav, stt):
    stt.loaded = False
    err(dictate(client, H, wav), 503, "stt_unavailable")
    assert client.get("/health").json()["status"] == "degraded"


# ---- command -----------------------------------------------------------------
def command(client, H, wav, **opts):
    return client.post("/v1/command", headers=H, files={"audio": ("a.wav", wav, "audio/wav")},
                       data={"options": json.dumps(opts)})


def test_command(client, H, wav, llm, stt):
    stt.text = "make this more polite"
    llm.reply = "Could you please send me the report?"
    r = command(client, H, wav, selected_text="send me the report now", app={"name": "Mail"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["instruction"] == "make this more polite" and j["text"] == "Could you please send me the report?"
    assert set(j["timings"]) == {"decode_ms", "stt_ms", "llm_ms", "total_ms"}
    user = llm.calls[0]["messages"][-1]["content"]
    assert "<instruction>make this more polite</instruction>" in user and "send me the report now" in user
    assert "ONLY the resulting text" in llm.calls[0]["messages"][0]["content"]
    h = client.get("/v1/history", headers=H).json()["items"][0]
    assert h["kind"] == "command" and h["app_name"] == "Mail"
    assert client.get("/v1/stats", headers=H).json()["words_total"] == 0


def test_command_errors(client, H, wav, llm, stt):
    err(command(client, H, wav), 422, "validation_error")  # selected_text required
    err(command(client, H, wav, selected_text=""), 422, "validation_error")
    llm.fail = True
    err(command(client, H, wav, selected_text="hi"), 502, "llm_unavailable")
    llm.fail = False
    llm.reply = ""
    err(command(client, H, wav, selected_text="hi"), 502, "llm_empty")
    stt.text = ""
    j = command(client, H, wav, selected_text="keep me").json()
    assert j["text"] == "keep me" and j["instruction"] == ""


# ---- history -----------------------------------------------------------------
def test_history_endpoints(client, H, wav, stt):
    for i in range(3):
        stt.text = f"note {i} alpha"
        dictate(client, H, wav, cleanup="none")
    j = client.get("/v1/history?limit=2&offset=0", headers=H).json()
    assert j["total"] == 3 and len(j["items"]) == 2
    assert set(j["items"][0]) == {"id", "created_at", "kind", "raw_text", "text", "app_name", "audio_ms", "word_count",
                                  "has_audio", "audio_mime", "meta"}
    assert client.get("/v1/history?q=note 1", headers=H).json()["total"] == 1
    iid = j["items"][0]["id"]
    assert client.delete(f"/v1/history/{iid}", headers=H).json() == {"ok": True}
    err(client.delete(f"/v1/history/{iid}", headers=H), 404, "not_found")
    assert client.delete("/v1/history", headers=H).json() == {"ok": True}
    assert client.get("/v1/history", headers=H).json() == {"items": [], "total": 0}


# ---- dictionary / snippets ---------------------------------------------------
def test_dictionary_crud(client, H):
    assert client.get("/v1/dictionary", headers=H).json() == []
    e = client.post("/v1/dictionary", headers=H, json={"term": "Alex"}).json()
    assert e["term"] == "Alex" and e["sounds_like"] == [] and e["id"]
    err(client.post("/v1/dictionary", headers=H, json={"term": "alex"}), 409, "duplicate")
    e2 = client.put(f"/v1/dictionary/{e['id']}", headers=H, json={"term": "Alex", "sounds_like": ["uh near odd"]}).json()
    assert e2["sounds_like"] == ["uh near odd"]
    err(client.put("/v1/dictionary/zzz", headers=H, json={"term": "x"}), 404, "not_found")
    assert len(client.get("/v1/dictionary", headers=H).json()) == 1
    assert client.delete(f"/v1/dictionary/{e['id']}", headers=H).json() == {"ok": True}
    err(client.delete(f"/v1/dictionary/{e['id']}", headers=H), 404, "not_found")
    err(client.post("/v1/dictionary", headers=H, json={"term": "   "}), 422, "validation_error")


def test_snippets_crud(client, H):
    s = client.post("/v1/snippets", headers=H, json={"trigger": "my email", "expansion": "a@b.co"}).json()
    assert set(s) == {"id", "trigger", "expansion"}
    err(client.post("/v1/snippets", headers=H, json={"trigger": "My Email", "expansion": "x"}), 409, "duplicate")
    s2 = client.put(f"/v1/snippets/{s['id']}", headers=H, json={"trigger": "my email", "expansion": "new@b.co"}).json()
    assert s2["expansion"] == "new@b.co"
    err(client.put("/v1/snippets/zzz", headers=H, json={"trigger": "t", "expansion": "e"}), 404, "not_found")
    assert client.get("/v1/snippets", headers=H).json() == [s2]
    assert client.delete(f"/v1/snippets/{s['id']}", headers=H).json() == {"ok": True}
    err(client.post("/v1/snippets", headers=H, json={"trigger": "x"}), 422, "validation_error")


# ---- settings / stats --------------------------------------------------------
def test_settings_partial_update(client, H):
    s = client.get("/v1/settings", headers=H).json()
    assert s == {"stt_model": "large-v3-turbo", "llm_model": "qwen2.5:3b", "default_cleanup": "full",
                 "default_style": "casual", "language": "auto", "styles_by_app": {}, "keep_history_days": 90,
                 "save_audio": False, "audio_dir": ""}
    s2 = client.put("/v1/settings", headers=H, json={"default_style": "formal", "keep_history_days": 30}).json()
    assert s2["default_style"] == "formal" and s2["keep_history_days"] == 30 and s2["default_cleanup"] == "full"
    assert client.get("/v1/settings", headers=H).json() == s2
    err(client.put("/v1/settings", headers=H, json={"default_style": "rude"}), 422, "validation_error")
    err(client.put("/v1/settings", headers=H, json={"keep_history_days": -1}), 422, "validation_error")


def test_llm_model_setting_used(client, H, wav, llm):
    client.put("/v1/settings", headers=H, json={"llm_model": "qwen2.5:7b"})
    dictate(client, H, wav, cleanup="full")
    assert llm.calls[0]["model"] == "qwen2.5:7b"
    assert client.get("/health").json()["llm"]["model"] == "qwen2.5:7b"


def test_stats_endpoint(client, H, wav, stt):
    stt.text = "one two three four five"
    dictate(client, H, wav, cleanup="none")
    s = client.get("/v1/stats", headers=H).json()
    assert set(s) == {"words_total", "words_7d", "sessions_total", "avg_wpm", "streak_days", "minutes_saved"}
    assert s["words_total"] == 5 and s["sessions_total"] == 1 and s["streak_days"] == 1 and s["avg_wpm"] > 0


def test_new_paragraph_cleans_each_segment(client, H, wav, llm, stt):
    stt.text = "hello there my friend new paragraph thanks for the help new line best regards to you"
    seen = []

    def reply(msgs):
        seen.append(msgs[-1]["content"])
        return {"hello there my friend": "Hello there, my friend.",
                "thanks for the help": "Thanks for the help.",
                "best regards to you": "Best regards to you."}[seen[-1][len("<transcript>"):-len("</transcript>")]]

    llm.reply = reply
    j = dictate(client, H, wav, cleanup="full").json()
    assert j["text"] == "Hello there, my friend.\n\nThanks for the help.\nBest regards to you."
    assert j["cleanup_used"] == "llm" and len(seen) == 3


def test_capitalisation_fixed_after_llm(client, H, wav, llm, stt):
    stt.text = "hello comma how are you doing today"
    llm.reply = "hello, how are you doing today?"
    assert dictate(client, H, wav, cleanup="full").json()["text"] == "Hello, how are you doing today?"
    j = dictate(client, H, wav, cleanup="full", style="very_casual").json()
    assert j["text"] == "hello, how are you doing today?"
