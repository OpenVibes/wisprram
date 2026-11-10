# Server setup

The WisprRam server is a small Python service (FastAPI) that runs speech recognition ([faster-whisper](https://github.com/SYSTRAN/faster-whisper)) and text cleanup (a local LLM through [Ollama](https://ollama.com)). Run it on a Linux machine with an NVIDIA GPU; the desktop apps connect to it over your network.

The short version:

```bash
git clone https://github.com/OpenVibes/wisprram && cd wisprram/backend
./scripts/install.sh --service
./scripts/run.sh pair
```

The rest of this page explains what that does, what you need, and how to change things.

## Prerequisites

| | Needed | Notes |
|---|---|---|
| OS | Linux, x86_64 | Developed on Ubuntu. Any distro with systemd works; without systemd run `scripts/run.sh serve` yourself. macOS and WSL2 work for testing on the CPU. |
| GPU | NVIDIA, **6 GB+ VRAM** recommended | Driver **525 or newer** (check with `nvidia-smi`). The CUDA 12 runtime (cuBLAS, cuDNN 9) comes from pip wheels, so you do **not** need the CUDA toolkit or `nvcc`. No GPU: it falls back to a small model on the CPU. |
| VRAM budget | about 4.4 GB | `large-v3-turbo` (about 2.2 GB) plus `qwen2.5:3b` (about 2.2 GB) measured on an 8 GB card. |
| RAM | 8 GB or more | 16 GB is comfortable. |
| Disk | about 10 GB free | Python packages with the CUDA libs about 3 GB, Whisper model 1.6 GB, LLM model about 2 GB, plus history and optional audio. |
| Python | 3.10, 3.11 or 3.12 | 3.13 and newer are not supported yet. Or install [uv](https://docs.astral.sh/uv/), which fetches a suitable Python for you. |
| Ollama | Any recent version | The installer pulls the model for you if Ollama is running. Without Ollama WisprRam still works, with rules-only cleanup (fillers, punctuation, capitalization). |
| Network | Port 8790 reachable from your computers | LAN or a VPN such as Tailscale. |

Install Ollama if you do not have it:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Optional: `uv` (`curl -LsSf https://astral.sh/uv/install.sh | sh`) makes the Python part painless on distros that ship Python 3.13 or newer.

## Install

```bash
git clone https://github.com/OpenVibes/wisprram
cd wisprram/backend
./scripts/install.sh --service
```

`install.sh` is safe to re-run. It:

1. Checks the OS and finds a supported Python (or uses uv to create a 3.12 environment).
2. Detects an NVIDIA GPU with `nvidia-smi`: with a GPU it installs the `cuda` extra (cuBLAS and cuDNN wheels, about 1.5 GB); without one it installs for CPU.
3. Creates `backend/.venv` and installs the server into it.
4. Checks that Ollama is reachable and pulls `qwen2.5:3b` if it is missing.
5. Downloads the speech model (`large-v3-turbo`, 1.6 GB; the 0.5 GB `small` model in CPU mode).
6. Runs `wisprram-server doctor`, a checklist that prints a fix for every problem.
7. With `--service`: installs and starts the systemd user service `wisprram`, and waits until the server answers.
8. Prints the URL(s) your apps should use, firewall commands for your distro, the linger tip and how to pair.

Options: `--service` (install the systemd user service), `--cpu` (ignore the GPU), `--dev` (add test dependencies), `--skip-model` (let the server download the model on first start), `--no-ollama-pull`, `-h`. Environment: `WISPRRAM_VENV` to put the virtualenv somewhere else.

To run the server in the foreground instead of as a service:

```bash
./scripts/run.sh serve
```

`run.sh` puts the pip-installed CUDA libraries on `LD_LIBRARY_PATH` and then starts the server; always start the server through it (or the service) rather than calling Python directly.

### Manual install

If you prefer to do it by hand:

```bash
cd wisprram/backend
python3.12 -m venv .venv                  # or: uv venv --python 3.12 .venv
.venv/bin/pip install -e ".[cuda]"        # drop [cuda] for CPU-only
./scripts/run.sh doctor
./scripts/run.sh serve
```

## Firewall

The apps connect to port **8790/tcp**. If a firewall is active on the server, allow your LAN only. Replace `192.168.1.0/24` with your network (the installer prints the right one).

| Firewall | Command |
|---|---|
| ufw (Ubuntu, Debian) | `sudo ufw allow from 192.168.1.0/24 to any port 8790 proto tcp` |
| firewalld (Fedora, RHEL, openSUSE) | `sudo firewall-cmd --permanent --add-port=8790/tcp && sudo firewall-cmd --reload` |
| nftables / iptables | allow `tcp dport 8790` from your LAN range |

With firewalld, prefer a rich rule limited to your LAN: `sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" port port="8790" protocol="tcp" accept'`. Never forward this port on your router; see [SECURITY.md](../SECURITY.md).

Check from your computer: `curl http://<server-ip>:8790/health`.

## Running as a service

`install.sh --service` (or `scripts/install-service.sh` alone) installs a **systemd user** unit at `~/.config/systemd/user/wisprram.service` pointing at your checkout, enables it and restarts it.

```bash
systemctl --user status wisprram
systemctl --user restart wisprram
journalctl --user -u wisprram -f        # live log
```

A user service only runs while you are logged in. To start it at boot and keep it running after you log out, enable lingering once (needs sudo):

```bash
sudo loginctl enable-linger "$USER"
```

## Pairing

The app needs a token. Create a pairing code on the server:

```bash
./scripts/run.sh pair
# Pairing code: 482913   (valid 10 minutes, single use)
```

In the app enter the server URL (for example `http://192.168.1.50:8790`) and the code. The code works once and expires after 10 minutes. Pair each device separately.

Other token commands:

```bash
./scripts/run.sh token --new       # print a token directly (for scripts and curl)
./scripts/run.sh token --list      # list tokens
```

## Configuration

Precedence: built-in defaults, then `~/.config/wisprram/server.toml`, then `WISPRRAM_*` environment variables. Keys in `server.toml` are the variable names without the prefix, lower case. `./scripts/run.sh config` prints the effective values.

| Variable | Default | Meaning |
|---|---|---|
| `WISPRRAM_HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` to allow only local access (for example behind a tunnel). |
| `WISPRRAM_PORT` | `8790` | Port |
| `WISPRRAM_DATA_DIR` | `~/.config/wisprram` | Database (`wisprram.db`), `server.toml`, and the default `audio/` folder |
| `WISPRRAM_STT_MODEL` | `large-v3-turbo` | faster-whisper model name |
| `WISPRRAM_STT_CPU_MODEL` | `small` | Model used when CUDA is not available |
| `WISPRRAM_STT_DEVICE` | `auto` | `auto`, `cuda` or `cpu` |
| `WISPRRAM_STT_COMPUTE_TYPE` | `float16` | CUDA compute type (`int8_float16` saves VRAM); CPU always uses `int8` |
| `WISPRRAM_BEAM_SIZE` | `5` | Whisper beam size; 1 is slightly faster, less accurate |
| `WISPRRAM_LLM_MODEL` | `qwen2.5:3b` | Ollama model used for cleanup and command mode |
| `WISPRRAM_OLLAMA_URL` | `http://127.0.0.1:11434` | Where Ollama listens (can be another machine) |
| `WISPRRAM_LLM_TIMEOUT` | `6` | Seconds to wait for cleanup before falling back to rules |
| `WISPRRAM_COMMAND_TIMEOUT` | `20` | Seconds to wait in command mode |
| `WISPRRAM_LLM_KEEP_ALIVE` | `30m` | How long Ollama keeps the model in VRAM |
| `WISPRRAM_MAX_UPLOAD_MB` | `50` | Largest accepted upload |
| `WISPRRAM_MAX_AUDIO_S` | `600` | Longest accepted recording in seconds |

For the service, put `KEY=value` lines in `~/.config/wisprram/server.env` (for example `WISPRRAM_PORT=8800`) and run `systemctl --user restart wisprram`. Variables you set in front of `install.sh --service` are saved there once. The same keys also work in `server.toml`. See also [backend/README.md](../backend/README.md).

Settings that users change from the app (default cleanup level and style, per-app styles, history retention, audio retention, models) are stored in the database and edited via `/v1/settings`; see [API.md](API.md#settings) and [ARCHIVE.md](ARCHIVE.md#server-audio-retention).

## Changing models

### Cleanup (LLM)

```bash
ollama pull qwen2.5:7b
./scripts/run.sh config llm_model     # shows the current one
curl -X PUT http://localhost:8790/v1/settings -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"llm_model":"qwen2.5:7b"}'
```

(or change it in the app's server settings, or set `WISPRRAM_LLM_MODEL`). It applies from the next request.

- `qwen2.5:7b` follows instructions noticeably better and is the first upgrade to try if you have 12 GB or more of VRAM (about 5 GB for the model). Expect a few hundred milliseconds more per dictation.
- Smaller or older GPU: stay on `qwen2.5:3b`, or use `qwen2.5:1.5b` to save VRAM, or set cleanup to `light` in the app, which uses fast rules and no LLM.
- Any Ollama chat model works, but WisprRam is tuned for the Qwen2.5 instruct family.

### Speech (Whisper)

Set `stt_model` the same way (settings API or `WISPRRAM_STT_MODEL`). Changing it through the API reloads the model in the background, and `/health` reports `loaded: false` until it is ready.

| Model | Download | When |
|---|---|---|
| `large-v3-turbo` (default) | 1.6 GB | Best balance; about 2.2 GB VRAM |
| `large-v3` | 3.1 GB | Slightly more accurate, slower; needs more VRAM |
| `medium` | 1.5 GB | Smaller GPUs |
| `small` | 0.5 GB | CPU-only machines, or GPUs with 4 GB |
| `base`, `tiny` | under 0.2 GB | Last resort; noticeably less accurate |

Run `./scripts/run.sh fetch-model --model medium` to download a model ahead of time with a progress bar. If you mostly dictate in one language, set `language` (for example `en`) instead of `auto`: it skips language detection, about 0.2 s faster per dictation.

### Expected latency

Measured on an RTX 4060 Laptop (8 GB), `qwen2.5:3b`, median of 10 requests:

| Clip | Language | Total |
|---|---|---|
| 3 s | `en` | about 0.43 s |
| 3 s | `auto` | about 0.65 s |
| 12.7 s | `en` | about 0.84 s |
| 12.7 s | `auto` | about 1.06 s |
| 3 s, CPU fallback (`small`, int8) | | about 1.5 s |

Run `backend/scripts/bench.py` to measure your own machine.

## Upgrade

```bash
cd wisprram
git pull
cd backend && ./scripts/install.sh --service
```

The installer upgrades the packages and restarts the service. Your data in `~/.config/wisprram` is kept and the database migrates automatically.

## Uninstall

```bash
systemctl --user disable --now wisprram
rm ~/.config/systemd/user/wisprram.service && systemctl --user daemon-reload
rm -rf wisprram                       # the checkout, including backend/.venv
rm -rf ~/.config/wisprram             # history, tokens, kept audio (optional: this is your data)
ollama rm qwen2.5:3b                  # optional
rm -rf ~/.cache/huggingface/hub/models--mobiuslabsgmbh--faster-whisper-large-v3-turbo   # optional
```

## Troubleshooting

Start with `./scripts/run.sh doctor`; it checks Python, GPU, CUDA libraries, models, Ollama, the port and the data directory and prints a fix for each problem. Then `journalctl --user -u wisprram -e`.

| Symptom | Likely cause and fix |
|---|---|
| App says "can't reach server" | Wrong IP (check `hostname -I`; DHCP can change it, so give the server a fixed address in your router), the service is not running (`systemctl --user status wisprram`), or the firewall blocks 8790 (see above). Test with `curl http://<ip>:8790/health` from the computer. |
| `/health` shows `stt.loaded: false` for a long time | First start is downloading the 1.6 GB model; watch `journalctl --user -u wisprram -f`. `/v1/dictate` returns `503 stt_unavailable` until it is loaded. |
| `status: degraded` | One of: model still loading, Ollama unreachable, or the GPU failed and the server fell back to the CPU. `doctor` tells which. |
| `Could not load library libcudnn...` or `libcublas.so.12 not found` | The CUDA wheels are missing or not on `LD_LIBRARY_PATH`. Start through `scripts/run.sh` or the service, and make sure you installed with the `cuda` extra: `.venv/bin/pip install -e ".[cuda]"`. |
| Runs on CPU although you have a GPU | `nvidia-smi` must work (driver 525+). Reinstall with the `cuda` extra, then check `doctor`. |
| Out of memory on the GPU | Use a smaller Whisper model or `WISPRRAM_STT_COMPUTE_TYPE=int8_float16`, a smaller LLM, or stop other GPU programs. Ollama frees the LLM after `WISPRRAM_LLM_KEEP_ALIVE`. |
| Text is not cleaned up well, `cleanup_used` is `rules` | Ollama is unreachable or too slow (timeout 6 s). Check `ollama list`, that the model is pulled, and `WISPRRAM_OLLAMA_URL`. After a long idle the first request can be slow while the model reloads. |
| Pairing says "bad code" | The code expired (10 minutes) or was already used; run `pair` again. After 8 wrong tries you must wait a minute. |
| `no supported Python found` | Install uv (see Prerequisites) and re-run `install.sh`. |
| Service stops when you log out | Run `sudo loginctl enable-linger "$USER"` once. |
| Port already in use | Another program uses 8790: set `WISPRRAM_PORT`, restart, and use the new port in the apps. |

If you are still stuck, open an issue with the output of `./scripts/run.sh doctor` and the last lines of the log.
