# shellcheck shell=bash
# Sourced by run.sh and test.sh. Requires $PY (the venv's python).
# If the pip CUDA wheels (extra "[cuda]") are installed, put their libraries on LD_LIBRARY_PATH.
# Without the wheels this does nothing, which is correct for CPU-only machines.
_nvlibs="$("$PY" - <<'PYEOF' 2>/dev/null || true
import importlib, os
dirs = []
for mod in ("nvidia.cublas.lib", "nvidia.cudnn.lib", "nvidia.cuda_runtime.lib"):
    try:
        dirs.append(list(importlib.import_module(mod).__path__)[0])
    except Exception:
        pass
print(os.pathsep.join(dirs))
PYEOF
)"
if [ -n "$_nvlibs" ]; then
  export LD_LIBRARY_PATH="${_nvlibs}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
unset _nvlibs
