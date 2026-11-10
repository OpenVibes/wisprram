from wisprram_server.dictionary import apply_sounds_like, hotwords, spelling_hint
from wisprram_server.snippets import expand_snippets

SN = [
    {"id": "1", "trigger": "my email", "expansion": "alex@example.com"},
    {"id": "2", "trigger": "my signature", "expansion": "Best,\nAlex"},
    {"id": "3", "trigger": "my email address", "expansion": "long@example.com"},
]


def test_whole_utterance_trigger_with_punctuation():
    e = expand_snippets("My email.", SN)
    assert e.restore(e.text) == "alex@example.com"
    assert e.applied == ["my email"]


def test_inline_trigger_case_insensitive_keeps_punctuation():
    e = expand_snippets("Please send it to My Email.", SN)
    assert "[[S0]]" in e.text
    assert e.restore(e.text) == "Please send it to alex@example.com."


def test_longest_trigger_wins():
    e = expand_snippets("use my email address please", SN)
    assert e.restore(e.text) == "use long@example.com please"


def test_multiline_expansion_verbatim_and_no_regex_escapes():
    sn = [{"id": "1", "trigger": "path", "expansion": r"C:\Users\x\1 $& \g<0>"}]
    e = expand_snippets("the path is here", sn)
    assert e.restore(e.text) == r"the C:\Users\x\1 $& \g<0> is here"


def test_whole_words_only():
    e = expand_snippets("my emailing habits", SN)
    assert e.applied == [] and e.text == "my emailing habits"


def test_placeholder_variants_restore_and_presence():
    e = expand_snippets("send to my email now", SN)
    assert e.all_present("Send to [[S0]] now.")
    assert e.all_present("Send to [s0] now.")
    assert not e.all_present("Send to now.")
    assert e.restore("Send to [S0] now.") == "Send to alex@example.com now."


def test_multiple_snippets():
    e = expand_snippets("my email then my signature", SN)
    assert e.restore(e.text) == "alex@example.com then Best,\nAlex"
    assert set(e.applied) == {"my email", "my signature"}


def test_no_snippets():
    assert expand_snippets("hello", []).text == "hello"


D = [
    {"id": "1", "term": "Kubernetes", "sounds_like": ["cooper netties", "kuber nettys"]},
    {"id": "2", "term": "Alex", "sounds_like": []},
]


def test_hotwords():
    assert hotwords(D) == "Kubernetes, Alex"
    assert hotwords([]) is None


def test_sounds_like_replacement():
    assert apply_sounds_like("deploy on Cooper Netties today", D) == "deploy on Kubernetes today"
    assert apply_sounds_like("nothing here", D) == "nothing here"


def test_spelling_hint():
    h = spelling_hint(D)
    assert "Kubernetes (may be heard as: cooper netties, kuber nettys)" in h and "Alex" in h
