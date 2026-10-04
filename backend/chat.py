"""Chat message cleaning and per-connection rate limiting."""
import re
import time
import unicodedata

MAX_CHAT_LENGTH = 200

# Stems of blocked words. Matching works on a normalised copy of the text (case, accents,
# zero-width characters and look-alike letters folded away) and tolerates the usual dodges:
# stretched letters (fuuuck), symbol swaps (sh1t, @ss, $hit), masked letters (f**k) and
# spaced or dotted letters (f u c k, f.u.c.k). A word must stand alone, or carry a common
# prefix/suffix, so innocent words that merely contain one ("class", "assist", "Essex",
# "cocktail", "Dickens") are left alone.
_SWEARS = (
    "ass",
    "bastard",
    "bitch",
    "cock",
    "cunt",
    "damn",
    "dick",
    "douchebag",
    "fag",
    "faggot",
    "fuck",
    "motherfuck",
    "nigga",
    "nigger",
    "piss",
    "pussy",
    "retard",
    "shit",
    "slut",
    "twat",
    "whore",
)
_PREFIXES = ("mother", "bull", "dumb", "jack", "horse", "smart", "dip")
_SUFFIXES = ("s", "es", "ed", "er", "ers", "in", "ing", "y", "head", "face", "hole", "holes")

# Characters people swap in for a letter.
_LOOKALIKES = {
    "a": "@4",
    "e": "3",
    "i": "1!|",
    "o": "0",
    "s": "$5",
    "t": "7+",
    "u": "v",
}
# Cyrillic/Greek letters that look like Latin ones.
_FOLD = str.maketrans(
    {
        "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c",
        "\u0445": "x", "\u0443": "y", "\u0456": "i", "\u03bf": "o", "\u03b1": "a",
    }
)


def _word_pattern(word):
    # Short words may only be split by punctuation: "a s s" is probably ordinary text.
    gap = r"[\s._\-]?" if len(word) > 3 else r"[._\-]?"
    parts = []
    for position, letter in enumerate(word):
        chars = re.escape(letter) + "".join(re.escape(c) for c in _LOOKALIKES.get(letter, ""))
        if position:
            chars += r"\*"  # a masked letter: f**k
        parts.append(f"[{chars}]+")
    prefix = "(?:" + "|".join(_PREFIXES) + ")?"
    suffix = "(?:" + "|".join(_SUFFIXES) + ")?"
    return prefix + gap.join(parts) + suffix


_SWEAR_RE = re.compile(
    r"(?<![a-z0-9])(?:"
    + "|".join(_word_pattern(w) for w in sorted(_SWEARS, key=len, reverse=True))
    + r")(?![a-z0-9])"
)


def _normalise(text):
    """Return (folded, origin): folded text for matching, and each char's index in `text`."""
    folded, origin = [], []
    for index, char in enumerate(text):
        for piece in unicodedata.normalize("NFKD", char):
            if unicodedata.category(piece) in ("Mn", "Cf"):
                continue  # accents, zero-width joiners and the like
            for lowered in piece.casefold().translate(_FOLD):
                folded.append(lowered)
                origin.append(index)
    return "".join(folded), origin


def _mask(original):
    if len(original) <= 2:
        return "*" * len(original)
    return original[0] + "*" * (len(original) - 2) + original[-1]


def filter_swears(text):
    """Replace swear words with a first/last-letter mask (e.g. f**k)."""
    folded, origin = _normalise(text)
    out, last = [], 0
    for match in _SWEAR_RE.finditer(folded):
        start, end = origin[match.start()], origin[match.end() - 1] + 1
        span = text[start:end]
        # "455" is just a number even though the digits could stand for letters.
        if start < last or not any(c.isalpha() for c in span):
            continue
        out.append(text[last:start])
        out.append(_mask(span))
        last = end
    out.append(text[last:])
    return "".join(out)


def clean_message(text):
    """Collapse whitespace, drop control characters, censor swears, cap length.

    Returns None if empty after cleaning.
    """
    if not isinstance(text, str):
        return None
    text = " ".join(text.split())
    text = "".join(c for c in text if c.isprintable())
    text = filter_swears(text[:MAX_CHAT_LENGTH])
    return text or None


class RateLimiter:
    def __init__(self, interval):
        self.interval = interval
        self._last = float("-inf")

    def allow(self):
        now = time.monotonic()
        if now - self._last < self.interval:
            return False
        self._last = now
        return True
