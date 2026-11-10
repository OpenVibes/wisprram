#!/usr/bin/env bash
# WisprRam server installer (Linux; macOS/Windows-WSL best effort, CPU only).
#
#   backend/scripts/install.sh              # create the venv, install, check everything
#   backend/scripts/install.sh --service    # ...and run it as a systemd --user service
#
# Safe to re-run: it reuses the venv, upgrades packages, and restarts the service if --service is given.
# Options: --service  --cpu (ignore the GPU)  --dev (test deps)  --skip-model  --no-ollama-pull  -h
# Environment: WISPRRAM_* (see README), WISPRRAM_VENV (venv location), OLLAMA_HOST.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${WISPRRAM_VENV:-$HERE/.venv}"
PY="$VENV/bin/python"

WANT_SERVICE=0
FORCE_CPU=0
WITH_DEV=0
SKIP_MODEL=0
SKIP_PULL=0

usage() {
  sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --service) WANT_SERVICE=1 ;;
    --cpu) FORCE_CPU=1 ;;
    --dev) WITH_DEV=1 ;;
    --skip-model) SKIP_MODEL=1 ;;
    --no-ollama-pull) SKIP_PULL=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

# ---- output helpers ------------------------------------------------------------------------
step() { printf '\n==> %s\n' "$*"; }
ok()   { printf '  [ok]   %s\n' "$*"; }
warn() { printf '  [warn] %s\n' "$*"; }
info() { printf '         %s\n' "$*"; }
die()  { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }

WARNINGS=0
note_warn() { WARNINGS=$((WARNINGS + 1)); warn "$@"; }

# uv is often installed in ~/.local/bin, which non-interactive shells may not have on PATH
export PATH="$HOME/.local/bin:$PATH"

echo "WisprRam server installer"
echo "  checkout: $HERE"

# ---- 1. platform ---------------------------------------------------------------------------
step "Checking the system"
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux)
    if [ "$ARCH" = "x86_64" ] || [ "$ARCH" = "amd64" ]; then
      ok "Linux $ARCH"
    else
      note_warn "Linux $ARCH is untested; CUDA wheels are only published for x86_64"
    fi ;;
  Darwin)
    note_warn "macOS is best effort: the server runs on CPU only and --service (systemd) is unavailable"
    WANT_SERVICE=0 ;;
  *)
    die "unsupported OS '$OS'. On Windows use WSL2 with Ubuntu and run this script there." ;;
esac

# ---- 2. python + venv ----------------------------------------------------------------------
step "Python environment"
UV=""
if command -v uv >/dev/null 2>&1; then UV="uv"; fi

py_ok() { # is $1 an interpreter in the supported 3.10-3.12 range?
  "$1" -c 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 12) else 1)' >/dev/null 2>&1
}

if [ -x "$PY" ] && py_ok "$PY"; then
  ok "reusing $VENV ($("$PY" -c 'import sys; print(sys.version.split()[0])'))"
else
  if [ -e "$VENV" ]; then
    if [ "$VENV" = "$HERE/.venv" ]; then
      warn "existing $VENV is broken or uses an unsupported Python; recreating it"
      rm -rf "$VENV"
    else
      die "$VENV exists but is not a Python 3.10-3.12 virtualenv; remove it or unset WISPRRAM_VENV"
    fi
  fi
  if [ -n "$UV" ]; then
    info "using uv ($(uv --version | head -1)); it will fetch Python 3.12 if it is not installed"
    uv venv --python 3.12 "$VENV" || die "uv could not create a Python 3.12 venv (offline?)"
  else
    BASEPY=""
    for cand in python3.12 python3.11 python3.10 python3; do
      if command -v "$cand" >/dev/null 2>&1 && py_ok "$(command -v "$cand")"; then
        BASEPY="$(command -v "$cand")"
        break
      fi
    done
    if [ -z "$BASEPY" ]; then
      printf '  [FAIL] no Python 3.10, 3.11 or 3.12 found (WisprRam does not support older or newer ones yet).\n' >&2
      cat >&2 <<'EOF'
         Easiest fix: install uv, which downloads a suitable Python for you, then re-run this script:
             curl -LsSf https://astral.sh/uv/install.sh | sh
         Or install Python from your package manager, e.g. on Ubuntu/Debian:
             sudo apt install python3.12 python3.12-venv
EOF
      exit 1
    fi
    info "using $BASEPY ($("$BASEPY" -c 'import sys; print(sys.version.split()[0])'))"
    if ! "$BASEPY" -m venv "$VENV"; then
      rm -rf "$VENV"
      printf '  [FAIL] could not create a virtualenv with %s.\n' "$BASEPY" >&2
      printf '         On Ubuntu/Debian: sudo apt install python3-venv   (then re-run), or install uv (see above).\n' >&2
      exit 1
    fi
  fi
  ok "created $VENV"
fi

# ---- 3. GPU --------------------------------------------------------------------------------
step "GPU"
EXTRAS=""
GPU_MODE=0
if [ "$FORCE_CPU" -eq 1 ]; then
  note_warn "--cpu given: installing for CPU only (small speech model, slower)"
elif command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
  GPU_NAME="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1 || true)"
  ok "NVIDIA GPU found: ${GPU_NAME:-unknown}"
  info "installing the CUDA 12 libraries (cuBLAS + cuDNN, about 1.5 GB download)"
  EXTRAS="cuda"
  GPU_MODE=1
else
  note_warn "no NVIDIA GPU / nvidia-smi: installing in CPU mode. It works, but the 'small' speech model on CPU is"
  info "slower (about 1.5 s for 3 s of speech) than large-v3-turbo on a GPU (about 0.3-0.5 s)."
  info "With an NVIDIA GPU, install the driver (so 'nvidia-smi' works) and re-run this script."
fi
if [ "$WITH_DEV" -eq 1 ]; then EXTRAS="${EXTRAS:+$EXTRAS,}dev"; fi

# ---- 4. install ----------------------------------------------------------------------------
step "Installing the server${EXTRAS:+ (extras: $EXTRAS)}"
cd "$HERE"
SPEC="."
if [ -n "$EXTRAS" ]; then SPEC=".[$EXTRAS]"; fi
if [ -n "$UV" ]; then
  uv pip install --python "$PY" -e "$SPEC"
else
  "$PY" -m pip --version >/dev/null 2>&1 || "$PY" -m ensurepip --upgrade >/dev/null
  "$PY" -m pip install --upgrade pip >/dev/null
  "$PY" -m pip install -e "$SPEC"
fi
ok "installed wisprram-server $("$PY" -m wisprram_server --version)"

cfg() { "$PY" -m wisprram_server config "$1" 2>/dev/null; }
OLLAMA_URL="$(cfg ollama_url || true)"; OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
LLM_MODEL="$(cfg llm_model || true)"; LLM_MODEL="${LLM_MODEL:-qwen2.5:3b}"
PORT="$(cfg port || true)"; PORT="${PORT:-8790}"

# ---- 5. Ollama -----------------------------------------------------------------------------
step "Ollama (text cleanup model: $LLM_MODEL)"
ollama_state() { # prints ok | missing | down
  "$PY" - "$OLLAMA_URL" "$LLM_MODEL" <<'PYEOF'
import json, sys, urllib.request
url, model = sys.argv[1].rstrip("/"), sys.argv[2]
try:
    names = [m["name"] for m in json.load(urllib.request.urlopen(url + "/api/tags", timeout=3)).get("models", [])]
except Exception:
    print("down")
    sys.exit(0)
want = model if ":" in model else model + ":latest"
print("ok" if want in names or model in names else "missing")
PYEOF
}
OLLAMA_HAVE_CLI=0
if command -v ollama >/dev/null 2>&1; then OLLAMA_HAVE_CLI=1; fi
case "$(ollama_state)" in
  ok)
    ok "Ollama is reachable at $OLLAMA_URL and has $LLM_MODEL" ;;
  missing)
    if [ "$SKIP_PULL" -eq 1 ]; then
      note_warn "$LLM_MODEL is not pulled (skipped: --no-ollama-pull). Run: ollama pull $LLM_MODEL"
    elif [ "$OLLAMA_HAVE_CLI" -eq 1 ]; then
      info "pulling $LLM_MODEL (about 2 GB, first time only)"
      if OLLAMA_HOST="$OLLAMA_URL" ollama pull "$LLM_MODEL"; then
        ok "pulled $LLM_MODEL"
      else
        note_warn "'ollama pull $LLM_MODEL' failed; cleanup uses simple rules until the model is available"
      fi
    else
      note_warn "Ollama at $OLLAMA_URL has no $LLM_MODEL. On the machine running Ollama: ollama pull $LLM_MODEL"
    fi ;;
  *)
    if [ "$OLLAMA_HAVE_CLI" -eq 1 ]; then
      note_warn "Ollama is installed but not reachable at $OLLAMA_URL. Start it ('ollama serve' or"
      info "'systemctl start ollama'), then: ollama pull $LLM_MODEL"
    else
      note_warn "Ollama is not installed. Without it WisprRam still works, with rules-only cleanup"
      info "(fillers, punctuation, capitalisation) instead of LLM rewriting. To get the full experience:"
      info "    curl -fsSL https://ollama.com/install.sh | sh"
      info "    ollama pull $LLM_MODEL"
      info "then re-run this script (or just restart the server)."
    fi ;;
esac

# ---- 6. speech model -----------------------------------------------------------------------
step "Speech model"
if [ "$SKIP_MODEL" -eq 1 ]; then
  info "skipped (--skip-model); the server downloads it on first start and logs the progress"
else
  info "downloading if needed (large-v3-turbo is about 1.6 GB; CPU mode uses the 0.5 GB 'small' model)"
  FETCH_ARGS=""
  if [ "$GPU_MODE" -eq 0 ]; then FETCH_ARGS="--cpu"; fi
  # shellcheck disable=SC2086  # FETCH_ARGS is either empty or one flag
  if "$HERE/scripts/run.sh" fetch-model $FETCH_ARGS; then
    ok "speech model ready"
  else
    note_warn "could not download the speech model now; the server will retry when it starts"
  fi
fi

# ---- 7. doctor -----------------------------------------------------------------------------
step "Running 'wisprram-server doctor'"
if "$HERE/scripts/run.sh" doctor; then
  ok "doctor finished without blocking problems"
else
  note_warn "doctor found problems (see above); fix them, then re-run this script"
fi

# ---- 8. service ----------------------------------------------------------------------------
SERVICE_UP=0
if [ "$WANT_SERVICE" -eq 1 ]; then
  step "Installing the systemd user service"
  if ! command -v systemctl >/dev/null 2>&1; then
    note_warn "systemctl not found; start the server manually: $HERE/scripts/run.sh serve"
  else
    "$HERE/scripts/install-service.sh"
    info "waiting for the server to answer (first start downloads/loads the model)"
    health() { # prints down | loading | ready
      "$PY" - "$PORT" <<'PYEOF'
import json, sys, urllib.request
try:
    j = json.load(urllib.request.urlopen(f"http://127.0.0.1:{sys.argv[1]}/health", timeout=2))
    print("ready" if j["stt"]["loaded"] else "loading")
except Exception:
    print("down")
PYEOF
    }
    state="down"
    for _ in $(seq 1 90); do
      state="$(health)"
      if [ "$state" = "ready" ]; then break; fi
      sleep 2
    done
    case "$state" in
      ready) SERVICE_UP=1; ok "server is up on port $PORT" ;;
      loading) note_warn "server is running but still loading the model; follow it with: journalctl --user -u wisprram -f" ;;
      *) note_warn "server did not answer yet; check: journalctl --user -u wisprram -e" ;;
    esac
  fi
fi

# ---- 9. what to do next --------------------------------------------------------------------
step "Done"
if [ "$WARNINGS" -gt 0 ]; then
  info "$WARNINGS warning(s) above; none stop the server from running."
fi
if [ "$WANT_SERVICE" -eq 0 ]; then
  echo
  echo "Start the server:"
  echo "    $HERE/scripts/run.sh serve"
  echo "or run it as a background service that starts on login:"
  echo "    $HERE/scripts/install.sh --service"
fi

# Real LAN addresses (default route first; Docker/libvirt bridges left out). Falls back to hostname -I.
LAN="$("$PY" -c 'from wisprram_server.netinfo import lan_ips; print(" ".join(lan_ips()))' 2>/dev/null || true)"
if [ -z "$LAN" ] && command -v hostname >/dev/null 2>&1; then
  for ip in $(hostname -I 2>/dev/null || true); do
    case "$ip" in
      *:*|127.*|172.17.*|192.168.122.*) continue ;; # IPv6, loopback, docker0, libvirt bridge
      *.*.*.*) LAN="$LAN $ip" ;;
    esac
  done
fi
FIRST_IP="${LAN# }"; FIRST_IP="${FIRST_IP%% *}"

echo
echo "Server URL for the WisprRam app (use the one on the same network as your computer):"
if [ -n "$LAN" ]; then
  for ip in $LAN; do echo "    http://$ip:$PORT"; done
else
  echo "    http://<this-machine's-address>:$PORT   (find it with: hostname -I)"
fi

if [ "$OS" = "Linux" ]; then
  SUBNET="192.168.1.0/24"
  if [ -n "$FIRST_IP" ]; then SUBNET="${FIRST_IP%.*}.0/24"; fi
  echo
  echo "If other devices cannot connect, a firewall is probably blocking port $PORT. Allow your LAN once:"
  echo "    ufw (Ubuntu/Debian):  sudo ufw allow from $SUBNET to any port $PORT proto tcp"
  echo "    firewalld (Fedora):   sudo firewall-cmd --permanent --add-port=$PORT/tcp && sudo firewall-cmd --reload"
  echo "  (adjust $SUBNET if your network uses a different range)"
  if [ "$WANT_SERVICE" -eq 1 ]; then
    echo
    echo "To keep the server running after you log out or reboot (needs sudo once):"
    echo "    sudo loginctl enable-linger \"$USER\""
  fi
fi

echo
echo "Pair the app (a 6-digit code, valid 10 minutes, single use):"
echo "    $HERE/scripts/run.sh pair"
if [ "$SERVICE_UP" -eq 1 ]; then
  echo
  "$HERE/scripts/run.sh" pair | head -1
fi
echo
echo "More: $HERE/README.md (configuration, troubleshooting, API)"
