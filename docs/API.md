# HTTP API reference

The WisprRam server exposes a small JSON/HTTP API on port **8790**. The desktop app is its main client, but everything is plain HTTP, so you can script it with `curl`. The TypeScript mirror of the types is [`client/src/shared/api.ts`](../client/src/shared/api.ts).

- Base URL: `http://<server>:8790`
- Auth: every `/v1/*` route except `POST /v1/pair` needs `Authorization: Bearer <token>`. Get a token by [pairing](#post-v1pair) or with `wisprram-server token --new`.
- Wire format: JSON, `snake_case`, UTF-8. Audio is uploaded as `multipart/form-data`.
- Compatibility: the API is additive. Fields marked **v0.2** are optional for older clients and may be missing from older servers.
- FastAPI also serves an interactive explorer at `/docs` and the OpenAPI schema at `/openapi.json`.

```bash
export WR=http://192.168.1.50:8790
export TOKEN=...          # from POST /v1/pair
```

## Errors

Every error, including 401, 404, 405, 422, 429 and 500, has the same shape:

```json
{ "error": { "code": "not_found", "message": "history item not found" } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `empty_audio` | The uploaded audio file has zero bytes |
| 400 | `bad_audio_dir` | **v0.2** `PUT /v1/settings` with an `audio_dir` that is not empty, absolute and writable on the server |
| 401 | `bad_code` | `POST /v1/pair` with a wrong, expired or used code |
| 401 | `unauthorized` | Missing, malformed or unknown bearer token |
| 404 | `not_found` | Unknown route or unknown history, dictionary or snippet id |
| 404 | `no_audio` | **v0.2** `GET /v1/history/{id}/audio` for an item whose recording was not kept (or was deleted) |
| 405 | `method_not_allowed` | Wrong HTTP method |
| 409 | `duplicate` | A dictionary term or snippet trigger already exists |
| 413 | `payload_too_large`, `audio_too_long` | Upload over `max_upload_mb` (50) or audio longer than `max_audio_s` (600 s) |
| 415 | `bad_audio` | The audio could not be decoded |
| 422 | `validation_error` | Request body, query or `options` JSON failed validation; `message` lists the offending fields |
| 429 | `too_many_attempts` | More than 8 wrong pairing codes in a minute |
| 500 | `stt_failed`, `internal_error` | Transcription crashed, or an unexpected server error (see the server log) |
| 502 | `llm_unavailable`, `llm_empty` | **Command mode only**: Ollama is down, timed out, or returned nothing. Dictation never fails for this reason; it falls back to rule-based cleanup |
| 503 | `stt_unavailable` | The speech model is still loading (a few seconds after start) or failed to load; retry shortly |

## Health

### `GET /health`

No authentication. Used by the app for its connection indicator.

```bash
curl $WR/health
```

```json
{
  "status": "ok",
  "version": "0.2.0",
  "stt": { "model": "large-v3-turbo", "device": "cuda", "loaded": true },
  "llm": { "provider": "ollama", "model": "qwen2.5:3b", "reachable": true },
  "gpu": { "name": "NVIDIA GeForce RTX 4060 Laptop GPU", "mem_used_mb": 4496, "mem_total_mb": 8188 }
}
```

`status` is `degraded` when the speech model is not loaded yet, Ollama is unreachable, or the server fell back from GPU to CPU. `gpu` is `null` when `nvidia-smi` is not available.

## Pairing

### `POST /v1/pair`

Exchanges the 6-digit code printed by `wisprram-server pair` (valid 10 minutes, single use) for a long-lived bearer token. No authentication.

```bash
curl -X POST $WR/v1/pair -H 'Content-Type: application/json' \
  -d '{"code": "482913", "client_name": "My laptop"}'
# {"token": "..."}
```

Errors: `bad_code` (401), `too_many_attempts` (429), `validation_error` (422).

## Dictation

### `POST /v1/dictate`

Multipart form with two fields:

| Field | Type | |
|---|---|---|
| `audio` | file | webm/opus (what the app sends), wav, m4a/mp4, ogg, mp3 or flac. Up to 50 MB and 10 minutes |
| `options` | JSON string | `DictateOptions`, optional (defaults to `{}`) |

`DictateOptions`:

| Field | Type | Default |
|---|---|---|
| `language` | `"auto"` or an ISO 639-1 code (`"en"`, `"hi"`, ...) | the server setting `language` |
| `cleanup` | `"none"`, `"light"`, `"full"` | `default_cleanup` |
| `style` | `"formal"`, `"casual"`, `"very_casual"` | `default_style`; overridden by `styles_by_app[app.name]` |
| `app` | `{ name, bundle_id?, window_title? }` | none; used for per-app styles and history |

```bash
curl -X POST $WR/v1/dictate \
  -H "Authorization: Bearer $TOKEN" \
  -F audio=@clip.webm \
  -F 'options={"language":"en","cleanup":"full","style":"casual","app":{"name":"Mail"}}'
```

```json
{
  "id": "a1b2c3d4e5f6",
  "raw_text": "um so can you send me the uh the report by friday",
  "text": "Can you send me the report by Friday?",
  "language": "en",
  "audio_ms": 3100,
  "word_count": 8,
  "timings": { "decode_ms": 19, "stt_ms": 270, "llm_ms": 136, "total_ms": 426 },
  "applied_snippets": [],
  "cleanup_used": "llm",
  "stt_model": "large-v3-turbo",
  "llm_model": "qwen2.5:3b",
  "cleanup": "full",
  "style": "casual",
  "has_audio": false
}
```

| Field | Meaning |
|---|---|
| `raw_text` | What Whisper heard, after dictionary replacements but before cleanup |
| `text` | The final text to insert. **Empty string** when nothing intelligible was heard; the item is then not stored in history |
| `cleanup_used` | `llm`, `rules` (LLM skipped or failed a guard, rules used instead) or `none` |
| `applied_snippets` | Triggers that were expanded |
| `stt_model`, `llm_model`, `cleanup`, `style`, `has_audio` | **v0.2**: what the server actually applied, and whether it kept the recording (see [ARCHIVE.md](ARCHIVE.md)) |

Errors: `empty_audio`, `bad_audio`, `payload_too_large`, `audio_too_long`, `stt_unavailable`, `stt_failed`, `validation_error`.

### `POST /v1/command`

Voice-edit a piece of text. Same multipart shape; `audio` is the spoken **instruction**.

`options` (`CommandOptions`, required): `{ "selected_text": "...", "app"?: {...}, "language"?: "..." }` where `selected_text` is 1 to 50,000 characters.

```bash
curl -X POST $WR/v1/command \
  -H "Authorization: Bearer $TOKEN" \
  -F audio=@instruction.webm \
  -F 'options={"selected_text":"send me the report now"}'
```

```json
{
  "id": "f0e1d2c3b4a5",
  "instruction": "make this more polite",
  "text": "Could you please send me the report when you have a moment?",
  "timings": { "decode_ms": 20, "stt_ms": 250, "llm_ms": 520, "total_ms": 810 },
  "stt_model": "large-v3-turbo",
  "llm_model": "qwen2.5:3b",
  "has_audio": false
}
```

If no speech is heard, `instruction` is empty and `text` is the selection, unchanged. Errors: those of `/v1/dictate` plus `llm_unavailable` and `llm_empty` (502).

## History

`HistoryItem`:

```json
{
  "id": "a1b2c3d4e5f6",
  "created_at": "2026-03-14T09:30:12.418+00:00",
  "kind": "dictation",
  "raw_text": "um so can you send me the uh the report by friday",
  "text": "Can you send me the report by Friday?",
  "app_name": "Mail",
  "audio_ms": 3100,
  "word_count": 8,
  "has_audio": true,
  "audio_mime": "audio/webm",
  "meta": {
    "language": "en", "stt_model": "large-v3-turbo", "llm_model": "qwen2.5:3b",
    "cleanup": "full", "style": "casual", "cleanup_used": "llm",
    "applied_snippets": [], "timings": { "decode_ms": 19, "stt_ms": 270, "llm_ms": 136, "total_ms": 426 }
  }
}
```

`has_audio`, `audio_mime` and `meta` are **v0.2**. For commands, `raw_text` is the spoken instruction and `meta.selected_text` holds the text that was edited.

### `GET /v1/history`

Query: `limit` (1 to 500, default 50), `offset` (default 0), `q` (case-insensitive substring search in raw and cleaned text, up to 200 characters). Newest first.

```bash
curl -H "Authorization: Bearer $TOKEN" "$WR/v1/history?limit=20&q=report"
# {"items": [HistoryItem, ...], "total": 42}
```

### `GET /v1/history/{id}` (v0.2)

One item, including `meta`. `404 not_found` if unknown.

### `GET /v1/history/{id}/audio` (v0.2)

Streams the recording that the server kept for the item, with the stored `Content-Type` (normally `audio/webm`). Requires `save_audio` to have been on when the item was created.

```bash
curl -H "Authorization: Bearer $TOKEN" -o clip.webm $WR/v1/history/a1b2c3d4e5f6/audio
```

Errors: `not_found` (no such item), `no_audio` (404; no recording kept).

### `DELETE /v1/history/{id}` and `DELETE /v1/history`

Delete one item, or everything. Returns `{"ok": true}`; `not_found` for an unknown id. **v0.2**: the kept audio files are deleted too. Statistics are not affected, because they are counted separately from history.

## Dictionary

Terms that Whisper should hear and spell correctly (given to it as hotwords), with optional "sounds like" mishearings that are replaced after transcription.

| Route | Body | Response |
|---|---|---|
| `GET /v1/dictionary` | | `DictionaryEntry[]` |
| `POST /v1/dictionary` | `{ "term": "Kubernetes", "sounds_like": ["cooper netties"] }` | `DictionaryEntry` |
| `PUT /v1/dictionary/{id}` | same | `DictionaryEntry` |
| `DELETE /v1/dictionary/{id}` | | `{"ok": true}` |

`DictionaryEntry` is `{ "id", "term", "sounds_like": [] }`. `term` is 1 to 100 characters, up to 20 `sounds_like` values. Errors: `duplicate` (409), `not_found` (404), `validation_error`.

```bash
curl -X POST $WR/v1/dictionary -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"term":"WisprRam","sounds_like":["whisper ram","whisper rum"]}'
```

## Snippets

Say the trigger, get the expansion.

| Route | Body | Response |
|---|---|---|
| `GET /v1/snippets` | | `Snippet[]` |
| `POST /v1/snippets` | `{ "trigger": "my email", "expansion": "me@example.com" }` | `Snippet` |
| `PUT /v1/snippets/{id}` | same | `Snippet` |
| `DELETE /v1/snippets/{id}` | | `{"ok": true}` |

`trigger` 1 to 200 characters, `expansion` 1 to 20,000. Errors as for the dictionary.

## Settings

### `GET /v1/settings` and `PUT /v1/settings`

`PUT` takes a partial object; only the fields you send change. The full object is returned.

| Field | Type | Default | Notes |
|---|---|---|---|
| `stt_model` | string | `large-v3-turbo` | Changing it reloads the speech model in the background; `/health` shows `stt.loaded: false` meanwhile |
| `llm_model` | string | `qwen2.5:3b` | Any model pulled in Ollama; takes effect on the next request |
| `default_cleanup` | `none`, `light`, `full` | `full` | |
| `default_style` | `formal`, `casual`, `very_casual` | `casual` | |
| `language` | `auto` or ISO code | `auto` | |
| `styles_by_app` | `{ "<app name>": style }` | `{}` | Matched case-insensitively against `options.app.name` |
| `keep_history_days` | integer 0 to 3650 | `90` | `0` keeps history forever; older items (and their audio) are pruned |
| `save_audio` | boolean | `false` | **v0.2**: keep each recording on the server |
| `audio_dir` | string | `""` | **v0.2**: absolute folder on the server; empty means `<data_dir>/audio`. Error `bad_audio_dir` (400) if unusable |

```bash
curl -X PUT $WR/v1/settings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"default_style":"formal","save_audio":true}'
```

## Stats

### `GET /v1/stats`

```json
{ "words_total": 48212, "words_7d": 6840, "sessions_total": 1204, "avg_wpm": 142.0, "streak_days": 12, "minutes_saved": 384.5 }
```

`words_*` count dictations only; `sessions_total` counts dictations and commands; `avg_wpm` is dictated words per audio minute; `minutes_saved` is words at a 40 wpm typing speed minus the audio time; `streak_days` counts consecutive days with a session (server local time) ending today, or yesterday if you have not dictated yet today. Stats survive clearing history.

## Rate limits and size limits

There is no general rate limiting. Only failed pairing attempts are limited (8 per minute). Uploads are limited to 50 MB and 10 minutes of audio; both are configurable ([SERVER_SETUP.md](SERVER_SETUP.md#configuration)). The server transcribes one request at a time, so concurrent dictations queue.
