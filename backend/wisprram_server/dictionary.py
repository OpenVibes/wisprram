"""Personal dictionary: Whisper hotwords, sounds-like replacement, LLM spelling hints."""
from __future__ import annotations

import re


def hotwords(entries: list[dict], max_terms: int = 40, max_chars: int = 400) -> str | None:
    terms: list[str] = []
    n = 0
    for e in entries:
        t = e["term"].strip()
        if not t or n + len(t) + 2 > max_chars or len(terms) >= max_terms:
            continue
        terms.append(t)
        n += len(t) + 2
    return ", ".join(terms) or None


def apply_sounds_like(text: str, entries: list[dict]) -> str:
    """Replace known mis-hearings ("sounds like" phrases) with the preferred term."""
    pairs = []
    for e in entries:
        for s in e.get("sounds_like") or []:
            if s.strip():
                pairs.append((s.strip(), e["term"]))
    pairs.sort(key=lambda p: len(p[0]), reverse=True)
    for src, term in pairs:
        pat = re.compile(r"(?<!\w)" + r"\s+".join(re.escape(w) for w in src.split()) + r"(?!\w)", re.IGNORECASE)
        text = pat.sub(lambda _m, t=term: t, text)
    return text


def spelling_hint(entries: list[dict], limit: int = 60) -> str:
    items = []
    for e in entries[:limit]:
        sl = e.get("sounds_like") or []
        items.append(e["term"] + (f" (may be heard as: {', '.join(sl)})" if sl else ""))
    return "; ".join(items)
