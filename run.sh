#!/usr/bin/env bash
# Builds the frontend and starts the single-origin server on :8765.
# Expose it with:  tailscale funnel 8765
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d backend/.venv ]; then
  python3 -m venv backend/.venv
fi
backend/.venv/bin/pip install -q -r backend/requirements.txt

(cd frontend && npm install --silent && npm run build)

exec backend/.venv/bin/python backend/server.py
