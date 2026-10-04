"""Authoritative trinket world.

The server is map-agnostic: a trinket is only an id, a species, a hidden tier and
a `seed`. Clients turn the seed into a position on whatever spawn-zone meshes the
current map provides (see frontend/src/trinkets/spawn.js), so changing the map
never touches the server.

Gambling rules: the tier is rolled at spawn and never leaves the server until the
trinket is cracked. What is *inside* is rolled at crack time. Timing well on the
crack rhythm raises the chance of an item from one tier higher.
"""
import os
import random
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(os.environ.get("STORMHACKS_DB", Path(__file__).resolve().parent / "stormhacks.db"))

SPECIES = ("clam", "crab", "urchin", "snail", "fish")
TIERS = ("common", "uncommon", "rare", "legendary")
SPAWN_WEIGHTS = (50, 28, 10, 5)  # per tier, same order as TIERS
BEATS = 7  # taps per crack
TARGET_COUNT = 40  # trinkets lying on the seabed or in paws at any time
FISH_COUNT = 12  # dedicated collectible fish in addition to the regular trinket pool

BUMP_CHANCE = 0.08  # chance the contents come from the next tier up
PERFECT_BUMP_CHANCE = 0.25  # same, if every tap was perfect
MIN_BEAT_SECONDS = 0.3  # a legitimate crack takes at least this long per beat

# Tap grades sent by the client.
MISS, GOOD, PERFECT = 0, 1, 2

# tier -> [(item id, display name, shells, weight)]
LOOT = {
    "common": [
        ("sea_glass", "Sea Glass", 2, 40),
        ("barnacle_button", "Barnacle Button", 3, 30),
        ("pebble", "Lucky Pebble", 4, 20),
        ("gritty_sand", "Gritty Sand", 0, 10),  # the dud
        ("goldfish", "Goldfish", 3, 30),
        ("soft_shell_clam", "Soft-Shell Clam", 3, 30),
        ("hermit_crab", "Hermit Crab", 4, 25),
    ],
    "uncommon": [
        ("seed_pearl", "Seed Pearl", 8, 40),
        ("mother_of_pearl", "Mother-of-Pearl", 10, 35),
        ("agate", "Polished Agate", 12, 25),
        ("clownfish", "Clownfish", 10, 30),
        ("razor_clam", "Razor Clam", 10, 30),
        ("blue_crab", "Blue Crab", 12, 25),
    ],
    "rare": [
        ("pink_pearl", "Pink Pearl", 30, 40),
        ("sunstone", "Sunstone", 40, 35),
        ("old_coin", "Old Coin", 50, 25),
        ("lionfish", "Lionfish", 40, 30),
        ("giant_clam", "Giant Clam", 45, 30),
        ("king_crab", "King Crab", 50, 25),
    ],
    "legendary": [
        ("black_pearl", "Black Pearl", 150, 45),
        ("golden_pearl", "Golden Pearl", 200, 40),
        ("moon_pearl", "Moon Pearl", 400, 15),
        ("coelacanth", "Ancient Coelacanth", 300, 25),
        ("golden_clam", "Golden Clam", 250, 30),
        ("ghost_crab", "Ghost Yeti Crab", 200, 35),
    ],
}
ITEM_INFO = {
    item: {"name": name, "tier": tier, "shells": shells}
    for tier, rows in LOOT.items()
    for item, name, shells, _ in rows
}


class TrinketStore:
    """Per-identity journal, finds and shell wallet, in the same SQLite file as identities."""

    def __init__(self, path=DB_PATH):
        self.db = sqlite3.connect(path)
        with self.db:
            self.db.execute(
                """CREATE TABLE IF NOT EXISTS trinket_journal (
                    player_id TEXT NOT NULL, species TEXT NOT NULL, tier TEXT NOT NULL,
                    count INTEGER NOT NULL, first_at REAL NOT NULL,
                    PRIMARY KEY (player_id, species, tier))"""
            )
            self.db.execute(
                """CREATE TABLE IF NOT EXISTS trinket_finds (
                    player_id TEXT NOT NULL, item TEXT NOT NULL,
                    count INTEGER NOT NULL, first_at REAL NOT NULL,
                    PRIMARY KEY (player_id, item))"""
            )
            self.db.execute(
                "CREATE TABLE IF NOT EXISTS trinket_wallet (player_id TEXT PRIMARY KEY, shells INTEGER NOT NULL)"
            )

    def record(self, pid, species, tier, item, shells):
        """Mark a crack in the journal. Returns (new_trinket_entry, new_item_entry)."""
        now = time.time()
        with self.db:
            entry = self.db.execute(
                "SELECT 1 FROM trinket_journal WHERE player_id=? AND species=? AND tier=?",
                (pid, species, tier),
            ).fetchone()
            self.db.execute(
                """INSERT INTO trinket_journal VALUES (?, ?, ?, 1, ?)
                   ON CONFLICT(player_id, species, tier) DO UPDATE SET count = count + 1""",
                (pid, species, tier, now),
            )
            found = self.db.execute(
                "SELECT 1 FROM trinket_finds WHERE player_id=? AND item=?", (pid, item)
            ).fetchone()
            self.db.execute(
                """INSERT INTO trinket_finds VALUES (?, ?, 1, ?)
                   ON CONFLICT(player_id, item) DO UPDATE SET count = count + 1""",
                (pid, item, now),
            )
            self.db.execute(
                """INSERT INTO trinket_wallet VALUES (?, ?)
                   ON CONFLICT(player_id) DO UPDATE SET shells = shells + excluded.shells""",
                (pid, shells),
            )
        return entry is None, found is None

    def journal(self, pid):
        trinkets = {
            f"{species}:{tier}": count
            for species, tier, count in self.db.execute(
                "SELECT species, tier, count FROM trinket_journal WHERE player_id=?", (pid,)
            )
        }
        finds = dict(
            self.db.execute("SELECT item, count FROM trinket_finds WHERE player_id=?", (pid,))
        )
        row = self.db.execute(
            "SELECT shells FROM trinket_wallet WHERE player_id=?", (pid,)
        ).fetchone()
        return {"trinkets": trinkets, "finds": finds, "shells": row[0] if row else 0}


class TrinketWorld:
    def __init__(self, store, rng=None, clock=time.monotonic):
        self.store = store
        self.rng = rng or random.Random()
        self.clock = clock
        self.trinkets = {}  # id -> {id, seed, species, tier, holder}
        self.cracking = {}  # player id -> {"tier", "beats", "started"}
        self._next_id = 1
        while len(self.trinkets) < TARGET_COUNT:
            self._spawn()
        for _ in range(FISH_COUNT):
            self._spawn("fish")

    def _spawn(self, species=None):
        trinket = {
            "id": self._next_id,
            "seed": self.rng.getrandbits(31),
            "species": species or self.rng.choice(SPECIES),
            "tier": self.rng.choices(TIERS, SPAWN_WEIGHTS)[0],
            "holder": None,
        }
        self._next_id += 1
        self.trinkets[trinket["id"]] = trinket
        return trinket

    @staticmethod
    def public(trinket):
        """What clients may know. The tier is deliberately absent."""
        return {
            "id": trinket["id"],
            "seed": trinket["seed"],
            "species": trinket["species"],
            "holder": trinket["holder"],
        }

    @staticmethod
    def catalog():
        """Static data the journal needs to draw empty slots."""
        return {
            "species": list(SPECIES),
            "tiers": list(TIERS),
            "items": [{"id": i, **info} for i, info in ITEM_INFO.items()],
        }

    def snapshot(self):
        return [self.public(t) for t in self.trinkets.values()]

    def held_by(self, pid):
        return next((t for t in self.trinkets.values() if t["holder"] == pid), None)

    def grab(self, pid, trinket_id):
        """Returns the public trinket if the grab succeeded, else None."""
        trinket = self.trinkets.get(trinket_id) if isinstance(trinket_id, int) else None
        if trinket is None or trinket["holder"] is not None or self.held_by(pid):
            return None
        trinket["holder"] = pid
        return self.public(trinket)

    def release(self, pid):
        """Player left or cancelled: the trinket goes back to the seabed. Returns it or None."""
        self.cracking.pop(pid, None)
        trinket = self.held_by(pid)
        if trinket is None:
            return None
        trinket["holder"] = None
        return self.public(trinket)

    def cancel_crack(self, pid):
        self.cracking.pop(pid, None)

    def begin_crack(self, pid):
        trinket = self.held_by(pid)
        if trinket is None:
            return None
        beats = BEATS if isinstance(BEATS, int) else self.rng.randint(*BEATS)
        self.cracking[pid] = {"tier": trinket["tier"], "beats": beats, "started": self.clock()}
        return {"beats": beats, "seed": trinket["seed"]}

    def _roll_item(self, tier, accuracy):
        tiers = list(TIERS)
        chance = BUMP_CHANCE + (PERFECT_BUMP_CHANCE - BUMP_CHANCE) * accuracy
        bumped = tier != TIERS[-1] and self.rng.random() < chance
        if bumped:
            tier = tiers[tiers.index(tier) + 1]
        rows = LOOT[tier]
        item, name, shells, _ = self.rng.choices(rows, [r[3] for r in rows])[0]
        return item, name, shells, tier, bumped

    def finish_crack(self, pid, grades):
        """Returns (crack result, replacement trinket) or None if the request is invalid."""
        session = self.cracking.get(pid)
        trinket = self.held_by(pid)
        if session is None or trinket is None:
            return None
        if not isinstance(grades, list) or len(grades) != session["beats"]:
            return None
        if not all(g in (MISS, GOOD, PERFECT) for g in grades):
            return None
        if self.clock() - session["started"] < MIN_BEAT_SECONDS * session["beats"]:
            return None

        del self.cracking[pid]
        del self.trinkets[trinket["id"]]
        replacement = self._spawn()

        accuracy = sum(grades) / (2 * len(grades))
        perfect = all(g == PERFECT for g in grades)
        item, name, shells, item_tier, bumped = self._roll_item(trinket["tier"], accuracy)
        # Sloppy taps trim the payout; clean ones are never worse than base value.
        shells = round(shells * (0.75 + 0.5 * accuracy))
        new_entry, new_item = self.store.record(
            pid, trinket["species"], trinket["tier"], item, shells
        )
        result = {
            "id": trinket["id"],
            "species": trinket["species"],
            "tier": trinket["tier"],
            "item": item,
            "name": name,
            "itemTier": item_tier,
            "bumped": bumped,
            "perfect": perfect,
            "shells": shells,
            "newEntry": new_entry,
            "newItem": new_item,
        }
        return result, self.public(replacement)
