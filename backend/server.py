"""Single-origin game server.

One port serves both:
  - the built frontend (static files from frontend/dist), over plain HTTP
  - the game WebSocket at /ws

So a single `tailscale funnel 8765` exposes everything under one URL.

The WebSocket side is a relay: it assigns ids, remembers each player's last state,
and forwards updates. It never interprets `state`; it only checks that it is a
small JSON object.
"""
import asyncio
import json
import mimetypes
import os
import uuid
from http import HTTPStatus
from pathlib import Path

import websockets
from websockets.datastructures import Headers
from websockets.http11 import Response

PORT = int(os.environ.get("PORT", "8765"))
STATIC_DIR = Path(
    os.environ.get("FRONTEND_DIR", Path(__file__).resolve().parent.parent / "frontend" / "dist")
).resolve()
WS_PATH = "/ws"
MAX_MESSAGE_BYTES = 1024

players = {}  # id -> websocket
states = {}  # id -> last state


def http_response(status, body, content_type="text/plain; charset=utf-8", extra=None):
    headers = Headers(
        {
            "Content-Type": content_type,
            "Content-Length": str(len(body)),
            "Connection": "close",
        }
    )
    for key, value in (extra or {}).items():
        headers[key] = value
    return Response(status.value, status.phrase, headers, body)


def serve_static(connection, request):
    """process_request hook: answer plain HTTP requests, let /ws upgrade through."""
    path = request.path.split("?", 1)[0]
    if path == WS_PATH:
        return None

    relative = "index.html" if path == "/" else path.lstrip("/")
    target = (STATIC_DIR / relative).resolve()
    if not target.is_relative_to(STATIC_DIR):
        return http_response(HTTPStatus.FORBIDDEN, b"Forbidden")
    if not target.is_file():
        if not STATIC_DIR.is_dir():
            return http_response(
                HTTPStatus.SERVICE_UNAVAILABLE,
                b"Frontend not built. Run: cd frontend && npm run build",
            )
        return http_response(HTTPStatus.NOT_FOUND, b"Not found")

    content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
        content_type += "; charset=utf-8"
    return http_response(HTTPStatus.OK, target.read_bytes(), content_type)


async def broadcast(message, exclude=None):
    data = json.dumps(message)
    targets = [ws for pid, ws in players.items() if pid != exclude]
    await asyncio.gather(*(ws.send(data) for ws in targets), return_exceptions=True)


async def handler(ws):
    pid = uuid.uuid4().hex[:8]
    players[pid] = ws
    print(f"+ {pid} ({len(players)} online)")

    try:
        await ws.send(json.dumps({"type": "welcome", "id": pid, "players": states}))

        async for raw in ws:
            if len(raw) > MAX_MESSAGE_BYTES:
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(msg, dict) or msg.get("type") != "state":
                continue
            state = msg.get("state")
            if not isinstance(state, dict):
                continue

            states[pid] = state
            await broadcast({"type": "state", "id": pid, "state": state}, exclude=pid)
    finally:
        players.pop(pid, None)
        states.pop(pid, None)
        await broadcast({"type": "leave", "id": pid})
        print(f"- {pid} ({len(players)} online)")


async def main():
    async with websockets.serve(
        handler,
        "0.0.0.0",
        PORT,
        max_size=MAX_MESSAGE_BYTES,
        process_request=serve_static,
    ):
        print(f"Serving {STATIC_DIR} and ws://…{WS_PATH} on :{PORT}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
