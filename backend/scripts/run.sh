#!/usr/bin/env bash
# Launcher for the WisprRam server and its CLI (serve | pair | token | doctor | fetch-model).
# Puts the pip-installed CUDA 12 libs (cuBLAS, cuDNN 9) on LD_LIBRARY_PATH when they are installed
# (pip install -e ".[cuda]"); on CPU-only machines it just runs the server.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${WISPRRAM_VENV:-$HERE/.venv}"
PY="$VENV/bin/python"
if [ ! -x "$PY" ]; then
  echo "No Python environment at $VENV. Run: $HERE/scripts/install.sh" >&2
  exit 1
fi
# shellcheck source=_cudalibs.sh
. "$HERE/scripts/_cudalibs.sh"
export HF_HUB_DISABLE_TELEMETRY=1
export PYTHONUNBUFFERED=1
cd "$HERE"
if [ "$#" -eq 0 ]; then set -- serve; fi
exec "$PY" -m wisprram_server "$@"
