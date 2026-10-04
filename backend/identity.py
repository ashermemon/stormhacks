"""Persistent player identities, backed by SQLite.

A browser proves who it is with a secret token that the server issues on first
visit. Only a hash of the token is stored. The public player id (broadcast to
everyone) is separate from the token, so seeing an id never lets you
impersonate that player.

Names are unique case-insensitively and can be changed.
"""
import hashlib
import os
import secrets
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

DB_PATH = Path(os.environ.get("STORMHACKS_DB", Path(__file__).resolve().parent / "stormhacks.db"))
MAX_NAME_LENGTH = 16


class IdentityError(Exception):
    """Raised with a message that is safe to show to the player."""


@dataclass(frozen=True)
class Identity:
    id: str
    name: str


def validate_name(name):
    if not isinstance(name, str):
        raise IdentityError("Name is required.")
    name = " ".join(name.split())
    if not name:
        raise IdentityError("Name is required.")
    if len(name) > MAX_NAME_LENGTH:
        raise IdentityError(f"Name can be at most {MAX_NAME_LENGTH} characters.")
    if not all(c.isalnum() or c in "_- " for c in name):
        raise IdentityError("Name can only contain letters, numbers, spaces, - and _.")
    return name


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


class IdentityStore:
    def __init__(self, path=DB_PATH):
        self.db = sqlite3.connect(path)
        with self.db:
            self.db.execute(
                """
                CREATE TABLE IF NOT EXISTS identities (
                    token_hash TEXT PRIMARY KEY,
                    id         TEXT NOT NULL UNIQUE,
                    name       TEXT NOT NULL,
                    name_key   TEXT NOT NULL UNIQUE,
                    created    REAL NOT NULL,
                    last_seen  REAL NOT NULL
                )
                """
            )

    def _name_taken(self, name, except_id=None):
        row = self.db.execute(
            "SELECT id FROM identities WHERE name_key = ?", (name.casefold(),)
        ).fetchone()
        return row is not None and row[0] != except_id

    def id_for_token(self, token):
        """The player id a token belongs to, or None. Read-only: never creates anything."""
        if not isinstance(token, str) or not token:
            return None
        row = self.db.execute(
            "SELECT id FROM identities WHERE token_hash = ?", (_hash(token),)
        ).fetchone()
        return row[0] if row else None

    def login(self, token, name):
        """Return (token, Identity). Unknown or missing token creates a new identity.

        If the token belongs to an existing identity and `name` differs from the
        stored one, that is a rename and is checked for uniqueness.
        """
        name = validate_name(name)
        now = time.time()

        if isinstance(token, str) and token:
            row = self.db.execute(
                "SELECT id, name FROM identities WHERE token_hash = ?", (_hash(token),)
            ).fetchone()
            if row:
                pid, stored_name = row
                if stored_name != name:
                    self.rename(pid, name)
                with self.db:
                    self.db.execute(
                        "UPDATE identities SET last_seen = ? WHERE id = ?", (now, pid)
                    )
                return token, Identity(pid, name)

        if self._name_taken(name):
            raise IdentityError("That name is already taken.")

        token = secrets.token_urlsafe(32)
        for _ in range(5):
            pid = secrets.token_hex(4)
            try:
                with self.db:
                    self.db.execute(
                        "INSERT INTO identities VALUES (?, ?, ?, ?, ?, ?)",
                        (_hash(token), pid, name, name.casefold(), now, now),
                    )
                return token, Identity(pid, name)
            except sqlite3.IntegrityError:
                continue  # id collision; pick another
        raise IdentityError("Could not create identity, try again.")

    def rename(self, pid, name):
        name = validate_name(name)
        if self._name_taken(name, except_id=pid):
            raise IdentityError("That name is already taken.")
        with self.db:
            self.db.execute(
                "UPDATE identities SET name = ?, name_key = ? WHERE id = ?",
                (name, name.casefold(), pid),
            )
        return name
