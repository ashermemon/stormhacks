#!/usr/bin/env bash
# Runs on the server as the `stormhacks` user (invoked by GitHub Actions over SSH,
# or by setup-server.sh with --first-run). Idempotent.
set -euo pipefail

APP_DIR=/opt/stormhacks
DATA_DIR=/var/lib/stormhacks
DB="$DATA_DIR/stormhacks.db"
BRANCH=main
FIRST_RUN=0
[ "${1:-}" = "--first-run" ] && FIRST_RUN=1

cd "$APP_DIR"
exec 9>"$DATA_DIR/deploy.lock"
flock 9   # serialise overlapping deploys

old=$(git rev-parse HEAD)
git fetch --quiet origin "$BRANCH"
new=$(git rev-parse "origin/$BRANCH")

if [ "$FIRST_RUN" = 0 ] && [ "$old" = "$new" ]; then
  echo "Already at $new, nothing to do."
  exit 0
fi

changed() {  # did any of these paths change between old and new?
  [ "$FIRST_RUN" = 1 ] || ! git diff --quiet "$old" "$new" -- "$@"
}

# Snapshot the DB (consistent, via SQLite backup API) before touching anything.
if [ -f "$DB" ]; then
  stamp=$(date +%Y%m%d-%H%M%S)
  .venv/bin/python - "$DB" "$DATA_DIR/backups/stormhacks-$stamp.db" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1]); dst = sqlite3.connect(sys.argv[2])
src.backup(dst); dst.close(); src.close()
PY
  ls -1t "$DATA_DIR"/backups/stormhacks-*.db | tail -n +31 | xargs -r rm --
fi

# The DB is outside the checkout and *.db is gitignored, so reset is safe.
git reset --hard "origin/$BRANCH"

if changed backend/requirements.txt; then
  .venv/bin/pip install -q -r backend/requirements.txt
fi

if changed frontend; then
  (cd frontend && npm ci --no-audit --no-fund && npm run build)
fi

# Frontend files are read from disk per request, so only backend changes need a restart.
if [ "$FIRST_RUN" = 0 ] && changed backend; then
  sudo /usr/bin/systemctl restart stormhacks
  echo "Restarted stormhacks."
fi

echo "Deployed $new"
