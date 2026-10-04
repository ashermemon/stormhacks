"""Single-origin game server.

One port serves both:
  - the built frontend (static files from frontend/dist), over plain HTTP
  - the game WebSocket at /ws

So a single `tailscale funnel 8765` exposes everything under one URL.

The WebSocket side is a relay. Players identify with a `hello` message (token + name,
see identity.py), then the server relays their `state`, `chat` and `rename` messages
to everyone. It never interprets `state`; it only checks that it is a small JSON object.
"""
import asyncio
import json
import mimetypes
import os
from http import HTTPStatus
from pathlib import Path

import websockets
from websockets.datastructures import Headers
from websockets.http11 import Response

from chat import RateLimiter, clean_message
from identity import IdentityError, IdentityStore

PORT = int(os.environ.get("PORT", "8765"))
STATIC_DIR = Path(
    os.environ.get("FRONTEND_DIR", Path(__file__).resolve().parent.parent / "frontend" / "dist")
).resolve()
WS_PATH = "/ws"
MAX_MESSAGE_BYTES = 1024
HELLO_TIMEOUT = 10  # seconds to send the hello message after connecting
CHAT_INTERVAL = 0.5  # minimum seconds between chat messages per player
RENAME_INTERVAL = 2

players = {}  # id -> websocket
states = {}  # id -> last state
names = {}  # id -> display name
store = IdentityStore()


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


async def send(ws, message):
    await ws.send(json.dumps(message))


async def authenticate(ws):
    """Wait for the hello message. Returns (token, Identity), or None if rejected."""
    try:
        raw = await asyncio.wait_for(ws.recv(), HELLO_TIMEOUT)
        msg = json.loads(raw)
    except (asyncio.TimeoutError, ValueError, websockets.ConnectionClosed):
        return None
    if not isinstance(msg, dict) or msg.get("type") != "hello":
        return None
    try:
        return store.login(msg.get("token"), msg.get("name"))
    except IdentityError as error:
        await send(ws, {"type": "error", "message": str(error)})
        return None


async def handler(ws):
    auth = await authenticate(ws)
    if auth is None:
        return
    token, identity = auth
    pid, name = identity.id, identity.name

    # One live session per identity: a newer connection replaces the older one.
    old = players.get(pid)
    old_name = names.get(pid)
    players[pid] = ws
    names[pid] = name
    print(f"+ {name} [{pid}] ({len(players)} online)")

    chat_limit = RateLimiter(CHAT_INTERVAL)
    rename_limit = RateLimiter(RENAME_INTERVAL)

    try:
        if old is not None:
            await old.close(4000, "Signed in from another tab")

        await send(
            ws,
            {
                "type": "welcome",
                "id": pid,
                "name": name,
                "token": token,
                "players": {i: s for i, s in states.items() if i != pid},
                "names": {i: n for i, n in names.items() if i != pid},
            },
        )
        if old is None:
            await broadcast({"type": "join", "id": pid, "name": name}, exclude=pid)
        elif old_name != name:
            await broadcast({"type": "renamed", "id": pid, "name": name}, exclude=pid)

        async for raw in ws:
            if len(raw) > MAX_MESSAGE_BYTES:
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue

            kind = msg.get("type")
            if kind == "state":
                state = msg.get("state")
                if not isinstance(state, dict):
                    continue
                states[pid] = state
                await broadcast({"type": "state", "id": pid, "state": state}, exclude=pid)

            elif kind == "chat":
                text = clean_message(msg.get("text"))
                if text is None:
                    continue
                if not chat_limit.allow():
                    await send(ws, {"type": "error", "message": "You are sending messages too fast."})
                    continue
                await broadcast({"type": "chat", "id": pid, "name": names[pid], "text": text})

            elif kind == "rename":
                if not rename_limit.allow():
                    await send(ws, {"type": "error", "message": "You are renaming too fast."})
                    continue
                try:
                    new_name = store.rename(pid, msg.get("name"))
                except IdentityError as error:
                    await send(ws, {"type": "error", "message": str(error)})
                    continue
                names[pid] = new_name
                await broadcast({"type": "renamed", "id": pid, "name": new_name})
    finally:
        # A replaced session must not clean up the identity's newer session.
        if players.get(pid) is ws:
            del players[pid]
            states.pop(pid, None)
            names.pop(pid, None)
            await broadcast({"type": "leave", "id": pid})
        print(f"- {name} [{pid}] ({len(players)} online)")


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
