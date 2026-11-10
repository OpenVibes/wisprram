# WisprRam server

The server half of [WisprRam](../README.md): a self-hosted voice dictation backend. The desktop apps send it a
recording; it transcribes the speech with [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
(`large-v3-turbo`) and cleans up the text with a local LLM through [Ollama](https://ollama.com) (`qwen2.5:3b`).
Nothing leaves your machine or network.

It is a small FastAPI app (Python 3.10 to 3.12) that stores history, your dictionary and snippets in a local SQLite
file, and authenticates apps with pairing codes and bearer tokens.

## Requirements

| | |
|---|---|
| OS | **Linux x86_64** (developed on Ubuntu; any systemd distro). macOS and Windows/WSL2 run on the CPU, best effort |
| GPU | NVIDIA with a current driver (`nvidia-smi` works). **Optional**: without one it uses a smaller model on the CPU. 6 GB or more of VRAM is recommended for `large-v3-turbo` + `qwen2.5:3b` (about 4.4 GB in use) |
| Disk | about 5 GB for models (speech model 1.6 GB, LLM about 2 GB), plus about 1.5 GB for the CUDA libraries |
| Python | 3.10, 3.11 or 3.12, or [uv](https://docs.astral.sh/uv/), which downloads one for you |
| Ollama | optional but recommended. Without it you get rules-only cleanup (fillers, punctuation, capitalisation) |
| Network | the apps reach the server on TCP port 8790 (LAN, or a VPN such as Tailscale) |

You do not need the CUDA toolkit or `nvcc`: cuBLAS and cuDNN come from pip wheels (the `cuda` extra).

## Quick start

```bash
git clone https://github.com/OpenVibes/wisprram
cd wisprram/backend
./scripts/install.sh --service
./scripts/run.sh pair            # prints a 6-digit code
```

Then enter the server URL that the installer printed (`http://<this-machine>:8790`) and the pairing code in the
WisprRam app.

`install.sh` is safe to re-run (also how you upgrade after `git pull`). It checks the system, creates `.venv`
(with `uv` if present, otherwise `python3 -m venv`), installs the server (with the `cuda` extra when it finds an
NVIDIA GPU), pulls the Ollama model if Ollama is running and lacks it, downloads the speech model with progress,
runs `doctor`, and with `--service` installs and starts a `systemd --user` unit. At the end it prints the LAN
URL(s), the `ufw` / `firewalld` command to open the port, and the `loginctl enable-linger` tip.

Options: `--service`, `--cpu` (ignore the GPU), `--dev` (add test dependencies), `--skip-model`,
`--no-ollama-pull`, `-h`. Set `WISPRRAM_*` variables in front of it to change the port or data folder
(`WISPRRAM_PORT=8800 ./scripts/install.sh --service`; with `--service` they are saved once to
`~/.config/wisprram/server.env`).

Manual install, if you prefer:

```bash
python3.12 -m venv .venv                       # or: uv venv --python 3.12 .venv
.venv/bin/pip install -e ".[cuda]"             # NVIDIA GPU; use plain  -e .  for CPU-only
scripts/run.sh doctor && scripts/run.sh serve
```

## Everyday commands

```bash
scripts/run.sh serve                  # run in the foreground (what the service does)
scripts/run.sh doctor                 # checklist with a fix for every problem
scripts/run.sh pair                   # new 6-digit pairing code (10 minutes, single use)
scripts/run.sh token --new --name X   # print a long-lived bearer token directly
scripts/run.sh token --list
scripts/run.sh config [key]           # show the effective configuration
scripts/run.sh fetch-model [--cpu]    # pre-download the speech model
systemctl --user status wisprram      # when installed as a service
journalctl --user -u wisprram -f      # logs (model download progress shows up here)
scripts/install-service.sh            # (re)install the systemd user unit for this checkout
```

`scripts/run.sh` puts the pip-installed cuBLAS/cuDNN on `LD_LIBRARY_PATH` when they are installed and does
nothing special otherwise, so always start the server through it (or the service).

**First start on a new machine.** `/health` answers immediately with `stt.loaded: false` while the speech model
downloads and loads (about 1.6 GB, a few minutes; the log shows `speech model download: 40% (640 / 1546 MB)`). Until then
`POST /v1/dictate` returns 503 `stt_unavailable`. Later starts take about 7 seconds.

## Configuration

Precedence: built-in defaults < `<data dir>/server.toml` < environment variables. In `server.toml` use the
lower-case names below without the prefix (`port = 8800`). For the systemd service, put `KEY=value` lines in
`~/.config/wisprram/server.env`, then `systemctl --user restart wisprram`.

| Environment variable | Default | Meaning |
|---|---|---|
| `WISPRRAM_HOST` | `0.0.0.0` | Interface to listen on. Use `127.0.0.1` to allow only this machine |
| `WISPRRAM_PORT` | `8790` | TCP port |
| `WISPRRAM_DATA_DIR` | `~/.config/wisprram` | Database (`wisprram.db`, mode 0600), `server.toml`, default `audio/` |
| `WISPRRAM_STT_MODEL` | `large-v3-turbo` | faster-whisper model name or Hugging Face repo id |
| `WISPRRAM_STT_CPU_MODEL` | `small` | Model used when there is no usable GPU |
| `WISPRRAM_STT_DEVICE` | `auto` | `auto`, `cuda` or `cpu` |
| `WISPRRAM_STT_COMPUTE_TYPE` | `float16` | On CUDA: `float16`, `int8_float16` (less VRAM), `int8`. CPU always uses `int8` |
| `WISPRRAM_BEAM_SIZE` | `5` | Whisper beam size (1 to 5; little speed difference here) |
| `WISPRRAM_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama base URL. If unset, Ollama's own `OLLAMA_HOST` is honoured |
| `WISPRRAM_LLM_MODEL` | `qwen2.5:3b` | Ollama model for text cleanup and voice commands |
| `WISPRRAM_LLM_TIMEOUT` | `6.0` | Seconds before cleanup gives up and falls back to rules |
| `WISPRRAM_COMMAND_TIMEOUT` | `20.0` | Seconds allowed for a voice command (edit selected text) |
| `WISPRRAM_LLM_KEEP_ALIVE` | `30m` | How long Ollama keeps the model in VRAM after use |
| `WISPRRAM_MAX_UPLOAD_MB` | `50` | Largest accepted recording |
| `WISPRRAM_MAX_AUDIO_S` | `600` | Longest accepted recording in seconds |
| `WISPRRAM_VENV` | `backend/.venv` | Virtualenv used by `run.sh`, `test.sh` and `install.sh` |

Other variables that matter: `HF_HOME` (where Hugging Face models are cached, default `~/.cache/huggingface`),
`OLLAMA_MODELS` (Ollama's model folder).

Settings the apps change through `GET/PUT /v1/settings` (stored in the database, they override the environment for
the models): `stt_model`, `llm_model`, `default_cleanup` (`none|light|full`), `default_style`
(`formal|casual|very_casual`), `language` (`auto` or a code such as `en`), `styles_by_app`, `keep_history_days`
(default 90, 0 = forever), `save_audio` (default `false`), `audio_dir` (default `""`).

## Pairing and tokens

```bash
scripts/run.sh pair          # 6-digit code, valid 10 minutes, single use
```

The app sends `POST /v1/pair {code, client_name}` and receives `{token}`. Tokens are stored only as SHA-256
hashes; more than 8 wrong codes per minute returns 429 `too_many_attempts`. `scripts/run.sh token --new --name X`
prints a token directly (for scripts and tests). The server is meant for a trusted network: do not expose
port 8790 to the internet without a VPN or an authenticating reverse proxy.

## Audio retention

By default recordings are discarded after transcription. Turn on `save_audio` (in the app's settings, or
`PUT /v1/settings {"save_audio": true}`) and the server keeps the **original uploaded bytes** next to each history
item:

```
<audio_dir>/<YYYY-MM>/<history_id>.<webm|wav|m4a|ogg|mp3|bin>
```

* `audio_dir` must be `""` (meaning `<data dir>/audio`) or an absolute path on the server (`~` is expanded). It is
  created if missing and must be writable, otherwise `PUT /v1/settings` returns 400 `bad_audio_dir` and changes
  nothing. Changing it later does not move old files; each history row remembers its own path.
* History items then have `has_audio: true` and `audio_mime`; fetch the file with
  `GET /v1/history/{id}/audio` (requires the bearer token; supports `Range`).
* Deleting an item, clearing history, and `keep_history_days` pruning delete the files too.
* If the disk write fails, the dictation still succeeds and the item has `has_audio: false`.
* Files are written with mode 0600 and are only ever read or deleted inside folders the server has written audio
  to.

## API summary

Full reference: [`../docs/API.md`](../docs/API.md). All `/v1/*` routes except `/v1/pair` need
`Authorization: Bearer <token>`. Errors are always `{"error": {"code", "message"}}`.

| Route | Notes |
|---|---|
| `GET /health` | no auth; `status` is `degraded` if the speech model is not loaded, Ollama is unreachable, or CUDA failed and it fell back to CPU |
| `POST /v1/pair` | `{code, client_name}` -> `{token}`; 401 `bad_code` |
| `POST /v1/dictate` | multipart `audio` + `options` JSON -> `DictationResult`. Empty/noise transcript -> `text: ""` (not stored) |
| `POST /v1/command` | multipart `audio` + `options` `{selected_text, app?}` -> `CommandResult` |
| `GET /v1/history?limit&offset&q` | list; items carry `has_audio`, `audio_mime`, `meta` |
| `GET /v1/history/{id}` | one item (404 `not_found`) |
| `GET /v1/history/{id}/audio` | the kept recording (404 `no_audio`) |
| `DELETE /v1/history[/{id}]` | also deletes kept audio |
| `/v1/dictionary`, `/v1/snippets` | GET list, POST, PUT `/{id}`, DELETE `/{id}`; duplicates 409 |
| `GET/PUT /v1/settings` | partial PUT |
| `GET /v1/stats` | words, sessions, wpm, streak, minutes saved |

Error codes: `unauthorized`, `bad_code`, `too_many_attempts`, `validation_error` (422), `bad_audio_dir` (400),
`empty_audio` (400), `bad_audio` (415), `payload_too_large` / `audio_too_long` (413), `not_found`, `no_audio`,
`duplicate` (409), `stt_unavailable` (503), `stt_failed` (500), `llm_unavailable` / `llm_empty` (502, command
mode only), `internal_error`.

### Pipeline (`/v1/dictate`)

1. Upload (up to 50 MB) -> PyAV decode to 16 kHz mono (up to 10 min). webm/opus from Chromium `MediaRecorder` works,
   including non-seekable "live" webm. No system ffmpeg is needed.
2. faster-whisper (`vad_filter`, `beam_size=5`, `condition_on_previous_text=False`); dictionary terms go in as
   `hotwords`. One transcription at a time.
3. Dictionary "sounds like" replacements, then snippet expansion. Snippets become `[[S0]]` placeholders so the
   LLM cannot rewrite them; they are substituted back at the end (also on every fallback path).
4. Cleanup: `none` raw; `light` rules (fillers, spoken punctuation, numeric self-corrections, capitalisation);
   `full` = rules pre-pass -> Ollama (`temperature 0.1`, one call per newline-separated segment) -> guards. If the
   reply is empty, much longer or shorter than the input, loses a snippet placeholder, or the call fails, the
   rules result is used and `cleanup_used` is `"rules"`.
5. Style: `styles_by_app[options.app.name]` (case-insensitive) wins over `options.style`, which wins over
   `default_style`.
6. Stored in history (with a `meta` object: models, cleanup, style, language, timings, ...); a separate
   `stats_events` table (no text) feeds `/v1/stats`, so deleting history does not reset your stats.

## Measured latency

RTX 4060 Laptop, driver 595, CUDA fp16, beam 5, `qwen2.5:3b`, median of 10 via HTTP on localhost:

| clip | language | decode | stt | llm | total |
|---|---|---|---|---|---|
| 3.1 s | `auto` | 19 ms | 490 ms | 137 ms | **646 ms** |
| 12.7 s | `auto` | 22 ms | 606 ms | 430 ms | **1059 ms** |
| 3.1 s | `en` | 19 ms | 270 ms | 136 ms | **426 ms** |
| 12.7 s | `en` | 21 ms | 386 ms | 432 ms | **842 ms** |
| 12.7 s, `cleanup=light` | `auto` | 19 ms | 595 ms | 0 | 615 ms |

* With `language=auto` faster-whisper runs an extra encoder pass for language detection (about +220 ms). If you
  mostly dictate in one language, set `language` in settings (or per request) to that code.
* Beam 1 vs 5 differs by only 10 to 50 ms here, so beam 5 is the default.
* VRAM: Whisper 2.2 GB + Ollama `qwen2.5:3b` 2.2 GB = **4.4 GB of 8.2 GB** with both loaded.
* CPU mode (`small`, int8) takes about 1.5 s for the 3 s clip.
* Reproduce with `TOKEN=$(scripts/run.sh token --new --name bench) scripts/bench.py tests/fixtures/hello.wav`.

## Troubleshooting

Start with `scripts/run.sh doctor`; it prints a `fix:` line under each problem.

* **`Library libcudnn_ops.so.9 is not found` / `libcublas.so.12 not found`**: the CUDA wheels are missing or the
  server was not started through `scripts/run.sh`. Install them with `.venv/bin/pip install -e ".[cuda]"` and start via
  `scripts/run.sh` or the service. Meanwhile the server falls back to the CPU (`/health` shows `degraded`).
* **CUDA out of memory** (or `/health` degraded with a CUDA error): the GPU is shared with something else or has
  less than 6 GB. Use less memory: `WISPRRAM_STT_COMPUTE_TYPE=int8_float16`, or a smaller model
  `WISPRRAM_STT_MODEL=small` (or `medium`), or a smaller LLM such as `WISPRRAM_LLM_MODEL=qwen2.5:1.5b`.
  `nvidia-smi` shows what holds the VRAM.
* **Ollama not reachable** (`/health` shows `llm.reachable: false`): install it
  (`curl -fsSL https://ollama.com/install.sh | sh`), start it (`ollama serve` or `systemctl start ollama`), and
  `ollama pull qwen2.5:3b`. If it runs on another machine set `WISPRRAM_OLLAMA_URL`. Dictation keeps working with
  rules-only cleanup meanwhile.
* **The app cannot connect / times out**: use the server's LAN address, not `localhost`, and check the firewall.
  `ufw`: `sudo ufw allow from <your-lan>/24 to any port 8790 proto tcp`; `firewalld`:
  `sudo firewall-cmd --permanent --add-port=8790/tcp && sudo firewall-cmd --reload`. `curl http://<ip>:8790/health`
  from another machine tests it. DHCP can change the address; give the server a fixed IP or use its hostname.
* **Port already in use**: pick another with `WISPRRAM_PORT` (for the service, in `server.env`) and enter the
  new port in the app. `ss -ltnp 'sport = :8790'` shows what holds it.
* **The service stops when I log out**: run `sudo loginctl enable-linger $USER` once.
* **`/v1/dictate` returns 503 `stt_unavailable`**: the speech model is still downloading or loading; watch
  `journalctl --user -u wisprram -f`.
* **Slow first model download**: it is a one-time 1.6 GB download from Hugging Face. `scripts/run.sh fetch-model`
  runs it with a progress bar; `HF_TOKEN` (optional) raises the rate limit.
* **`pip` pulls a huge download on a machine without a GPU**: install with `pip install -e .` (no `[cuda]`).
* **PyAV errors such as `metadata_errors`**: `av` must be below 17 (pinned in `pyproject.toml`) because
  faster-whisper 1.2 calls an argument newer PyAV removed.

## Development and tests

```bash
./scripts/install.sh --dev
scripts/test.sh -m "not integration"   # unit/API tests with fakes: seconds, no GPU or Ollama needed
scripts/test.sh -m integration         # real-audio tests: needs the speech model and Ollama
```

The unit tests install fine on a CPU-only machine (`pip install -e ".[dev]"`). Fixtures in `tests/fixtures/` are
tiny speech clips (wav, m4a, webm/opus, ogg/opus and a "live" non-seekable webm).

```
wisprram_server/
  main.py          app factory + lifespan (model load/warm-up, history pruning)
  config.py        defaults < server.toml < WISPRRAM_* environment
  auth.py          pairing codes, hashed bearer tokens, auth dependency
  db.py            SQLite (WAL): history, stats_events, dictionary, snippets, settings, tokens, pairing_codes;
                   migrates older databases in place
  audio_store.py   audio retention: write, resolve (path-safe), delete
  stt.py           faster-whisper wrapper: CUDA fp16 -> CPU int8 fallback, model download with logged progress
  audio.py         PyAV decode -> 16 kHz mono float32
  cleanup.py       rule cleaner, LLM cleanup + guards, command-mode rewrite
  doctor.py        `doctor` checklist;  netinfo.py LAN addresses
  snippets.py, dictionary.py, llm.py (Ollama), gpu.py (nvidia-smi), errors.py, schemas.py, cli.py
  routers/         health, pair, dictate (+command), history, dictionary, snippets, settings, stats
scripts/           install.sh, install-service.sh, run.sh, test.sh, bench.py
systemd/wisprram.service   unit template (install-service.sh fills in the checkout path)
```

## Notes

* Changing `stt_model` through `PUT /v1/settings` reloads the model in the background (`/health` shows
  `loaded: false` meanwhile). Changing `llm_model` takes effect on the next request.
* Word counts split on whitespace, so they under-count unspaced scripts (Chinese, Japanese).
* Upgrading from v0.1: just re-run `./scripts/install.sh --service`. The database is migrated in place on first
  start (three columns are added to `history`; nothing is dropped).
