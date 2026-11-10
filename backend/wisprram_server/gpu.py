"""GPU info via nvidia-smi (cached briefly)."""
from __future__ import annotations

import subprocess
import time

_cache: tuple[float, dict | None] = (0.0, None)


def gpu_info(ttl: float = 2.0) -> dict | None:
    global _cache
    now = time.time()
    if now - _cache[0] < ttl:
        return _cache[1]
    info = None
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.used,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3, check=True,
        ).stdout.strip().splitlines()[0]
        name, used, total = [p.strip() for p in out.split(",")]
        info = {"name": name, "mem_used_mb": int(float(used)), "mem_total_mb": int(float(total))}
    except Exception:
        info = None
    _cache = (now, info)
    return info
