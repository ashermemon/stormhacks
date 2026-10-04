"""Chat message cleaning and per-connection rate limiting."""
import re
import time

MAX_CHAT_LENGTH = 200

# Whole-word matches only (case-insensitive). Kept short and common; expand as needed.
_SWEARS = (
    "ass",
    "asses",
    "asshole",
    "assholes",
    "bastard",
    "bastards",
    "bitch",
    "bitches",
    "bullshit",
    "cock",
    "cocks",
    "cunt",
    "cunts",
    "damn",
    "damned",
    "dick",
    "dicks",
    "fag",
    "faggot",
    "faggots",
    "fuck",
    "fucked",
    "fucker",
    "fuckers",
    "fucking",
    "fucks",
    "motherfucker",
    "motherfuckers",
    "nigger",
    "niggers",
    "nigga",
    "niggas",
    "piss",
    "pissed",
    "pissing",
    "shit",
    "shits",
    "shitty",
    "slut",
    "sluts",
    "whore",
    "whores",
)

_SWEAR_RE = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in sorted(_SWEARS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)


def _censor_match(match):
    word = match.group(0)
    if len(word) <= 2:
        return "*" * len(word)
    return word[0] + "*" * (len(word) - 2) + word[-1]


def filter_swears(text):
    """Replace swear words with a first/last-letter mask (e.g. f**k)."""
    return _SWEAR_RE.sub(_censor_match, text)


def clean_message(text):
    """Collapse whitespace, drop control characters, censor swears, cap length.

    Returns None if empty after cleaning.
    """
    if not isinstance(text, str):
        return None
    text = " ".join(text.split())
    text = "".join(c for c in text if c.isprintable())
    text = filter_swears(text)
    return text[:MAX_CHAT_LENGTH] or None


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
