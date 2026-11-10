#!/usr/bin/env bash
# Run pytest (with the CUDA libs on LD_LIBRARY_PATH when installed, so integration tests can use the GPU).
#   scripts/test.sh                      # everything (unit + integration)
#   scripts/test.sh -m "not integration" # unit tests only: no GPU, model or Ollama needed
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${WISPRRAM_VENV:-$HERE/.venv}/bin/python"
# shellcheck source=_cudalibs.sh
. "$HERE/scripts/_cudalibs.sh"
cd "$HERE"
exec "$PY" -m pytest "$@"
