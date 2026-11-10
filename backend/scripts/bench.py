#!/usr/bin/env python3
"""Latency benchmark against a running server.
   TOKEN=$(scripts/run.sh token --new --name bench) scripts/bench.py tests/fixtures/hello.wav tests/fixtures/long.wav
"""
import json
import os
import statistics as st
import sys

import httpx

URL = os.environ.get("URL", "http://127.0.0.1:8790")
TOKEN = os.environ["TOKEN"]
N = int(os.environ.get("N", "5"))
CLEANUP = os.environ.get("CLEANUP", "full")
LANG = os.environ.get("LANG_OPT", "auto")

for path in sys.argv[1:]:
    rows = []
    for i in range(N + 1):  # first run is a warm-up
        with open(path, "rb") as f:
            r = httpx.post(URL + "/v1/dictate", headers={"Authorization": f"Bearer {TOKEN}"}, timeout=60,
                           files={"audio": (os.path.basename(path), f.read(), "audio/wav")},
                           data={"options": json.dumps({"cleanup": CLEANUP, "language": LANG})})
        r.raise_for_status()
        j = r.json()
        if i:
            rows.append(j)
    med = lambda k: int(st.median(x["timings"][k] for x in rows))  # noqa: E731
    print(f"{os.path.basename(path):14} audio={rows[0]['audio_ms']/1000:5.1f}s  decode={med('decode_ms')}ms  "
          f"stt={med('stt_ms')}ms  llm={med('llm_ms')}ms  total={med('total_ms')}ms  "
          f"cleanup={rows[-1]['cleanup_used']}  text={rows[-1]['text'][:70]!r}")
