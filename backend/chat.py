"""Chat message cleaning and per-connection rate limiting."""
import time

MAX_CHAT_LENGTH = 200


def clean_message(text):
    """Collapse whitespace, drop control characters, cap length. None if empty."""
    if not isinstance(text, str):
        return None
    text = " ".join(text.split())
    text = "".join(c for c in text if c.isprintable())
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
