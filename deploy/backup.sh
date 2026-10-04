#!/usr/bin/env bash
# Consistent snapshot of the game database (SQLite backup API, safe while the server runs).
#   backup.sh <prefix> <keep>   e.g.  backup.sh hourly 48
# Writes /var/lib/stormhacks/backups/<prefix>-<timestamp>.db, verifies it, and deletes all but
# the newest <keep> files with that prefix.
set -euo pipefail

PREFIX="${1:?prefix}"
KEEP="${2:?keep}"
APP_DIR="${APP_DIR:-/opt/stormhacks}"
DATA_DIR="${DATA_DIR:-/var/lib/stormhacks}"
DB="$DATA_DIR/stormhacks.db"
OUT_DIR="$DATA_DIR/backups"

[ -f "$DB" ] || { echo "no database at $DB yet, nothing to back up"; exit 0; }
mkdir -p "$OUT_DIR"
out="$OUT_DIR/$PREFIX-$(date +%Y%m%d-%H%M%S).db"

"${PYTHON:-$APP_DIR/.venv/bin/python}" - "$DB" "$out" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
ok = dst.execute("PRAGMA integrity_check").fetchone()[0]
dst.close(); src.close()
if ok != "ok":
    sys.exit(f"backup failed integrity check: {ok}")
PY

ls -1t "$OUT_DIR/$PREFIX"-*.db | tail -n +$((KEEP + 1)) | xargs -r rm --
echo "backed up to $out"
