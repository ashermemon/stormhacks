#!/usr/bin/env bash
# Builds the frontend and starts the single-origin server on :8765.
# Expects an activated Python venv. Expose it with:  tailscale funnel 8765
set -euo pipefail
cd "$(dirname "$0")"

pip install -q -r backend/requirements.txt

(cd frontend && npm install --silent && npm run build)

exec python backend/server.py
