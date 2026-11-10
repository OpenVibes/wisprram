"""Snippet expansion with placeholders (so the LLM can't rewrite the expansion)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

_TRAIL = re.compile(r"[\s.,!?;:\"'”’)\]]+$")
_LEAD = re.compile(r"^[\s\"'“‘(\[]+")
PLACEHOLDER_RE = re.compile(r"[\[\(\{]{1,2}\s*S(\d+)\s*[\]\)\}]{1,2}", re.IGNORECASE)


def placeholder(i: int) -> str:
    return f"[[S{i}]]"


@dataclass
class SnippetExpansion:
    text: str
    mapping: dict[int, str] = field(default_factory=dict)
    applied: list[str] = field(default_factory=list)

    def restore(self, text: str) -> str:
        if not self.mapping:
            return text
        return PLACEHOLDER_RE.sub(lambda m: self.mapping.get(int(m.group(1)), m.group(0)), text)

    def all_present(self, text: str) -> bool:
        found = {int(m.group(1)) for m in PLACEHOLDER_RE.finditer(text)}
        return set(self.mapping) <= found

    def all_present_for(self, source: str, text: str) -> bool:
        """Every placeholder that occurs in `source` must also occur in `text`."""
        want = {int(m.group(1)) for m in PLACEHOLDER_RE.finditer(source)}
        found = {int(m.group(1)) for m in PLACEHOLDER_RE.finditer(text)}
        return want <= found


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip()).lower()


def expand_snippets(text: str, snippets: list[dict]) -> SnippetExpansion:
    """Replace trigger phrases (case-insensitive, whole words, trailing punctuation tolerated)
    with placeholders. If the entire utterance is just a trigger, the whole text becomes the expansion."""
    result = SnippetExpansion(text=text)
    if not text.strip() or not snippets:
        return result
    trig = [s for s in snippets if s["trigger"].strip()]
    trig.sort(key=lambda s: len(s["trigger"]), reverse=True)

    whole = _norm(_LEAD.sub("", _TRAIL.sub("", text.strip())))
    for s in trig:
        if _norm(s["trigger"]) == whole:
            result.text = placeholder(0)
            result.mapping[0] = s["expansion"]
            result.applied.append(s["trigger"])
            return result

    out = text
    for s in trig:
        words = s["trigger"].split()
        pat = re.compile(r"(?<!\w)" + r"[\s,]+".join(re.escape(w) for w in words) + r"(?!\w)", re.IGNORECASE)
        if not pat.search(out):
            continue

        def repl(_m, s=s):
            i = len(result.mapping)
            result.mapping[i] = s["expansion"]
            return placeholder(i)

        out = pat.sub(repl, out)
        result.applied.append(s["trigger"])
    result.text = out
    return result
