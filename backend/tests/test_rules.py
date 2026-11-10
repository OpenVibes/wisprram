import pytest

from wisprram_server.cleanup import ratio_ok, rule_cleanup, sanitize_llm_output


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("um so I think uh we should meet", "So I think we should meet"),
        ("Um, hello there", "Hello there"),
        ("hello comma how are you question mark", "Hello, how are you?"),
        ("Hello, comma, how are you? Question mark.", "Hello, how are you?"),
        ("I will be there at five period", "I will be there at five."),
        ("see you tomorrow exclamation mark", "See you tomorrow!"),
        ("first line new line second line", "First line\nSecond line"),
        ("first paragraph new paragraph second paragraph", "First paragraph\n\nSecond paragraph"),
        ("it was a long period of time", "It was a long period of time"),
        ("we met in a period of growth", "We met in a period of growth"),
        ("the meeting is at 4pm no wait 5pm", "The meeting is at 5pm"),
        ("um so I think uh we should meet at 4 no actually 5 pm", "So I think we should meet at 5 pm"),
        ("i think i'm ready and i will go", "I think I'm ready and I will go"),
        ("this is is a test", "This is a test"),
        ("it was, like, really good", "It was really good"),
        ("hello    world", "Hello world"),
        ("that costs three dollars. and it works", "That costs three dollars. And it works"),
        ("use e.g. this one", "Use e.g. this one"),
        ("", ""),
        ("   ", ""),
        ("um uh", ""),
    ],
)
def test_rule_cleanup(raw, expected):
    assert rule_cleanup(raw) == expected


def test_very_casual_drops_final_period():
    assert rule_cleanup("see you soon.", "very_casual") == "See you soon"


def test_no_space_before_punct_and_idempotent():
    out = rule_cleanup("well , okay !")
    assert out == "Well, okay!"
    assert rule_cleanup(out) == out


def test_ratio_guard():
    raw = "um so I think we should meet tomorrow at five"
    assert ratio_ok(raw, "I think we should meet tomorrow at five.")
    assert not ratio_ok(raw, "")
    assert not ratio_ok(raw, "Paris")  # an answer, far too short
    assert not ratio_ok(raw, raw * 3)
    assert ratio_ok("ok", "OK.")  # tiny inputs tolerated


@pytest.mark.parametrize(
    "out,expected",
    [
        ('"Hello there."', "Hello there."),
        ("Here is the cleaned text: Hello there.", "Hello there."),
        ("<transcript>Hello there.</transcript>", "Hello there."),
        ("```\nHello there.\n```", "Hello there."),
        ("Cleaned text: Hello there.", "Hello there."),
        ("She said \"hi\" to me", 'She said "hi" to me'),
    ],
)
def test_sanitize(out, expected):
    assert sanitize_llm_output(out) == expected


# --- regression: self-corrections across a sentence break / repeated preposition (lead, 2026-11-09)
from wisprram_server.cleanup import numbers_ok, rule_prepass  # noqa: E402


def test_self_correction_across_period_and_preposition():
    out = rule_prepass("the meeting is on Tuesday at 3. No wait, at 4pm new paragraph thanks everyone")
    assert "at 4pm" in out and "3" not in out and "wait" not in out.lower()


def test_self_correction_keeps_single_preposition():
    assert rule_prepass("let's meet at 4 no actually 5 pm") == "let's meet at 5 pm"


def test_numbers_guard_rejects_swapped_correction():
    assert not numbers_ok("meet at 3, no wait, at 4pm", "Meet at 4pm, no wait, at 3pm.")
    assert numbers_ok("meet at 4:00 pm with 2 people", "Meet at 4 pm with 2 people.")
    assert not numbers_ok("call 2 people", "Call two people.")
    assert numbers_ok("send [[S0]] to 3 people", "Send [[S0]] to 3 people.")
