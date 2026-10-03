"""Relay server: assigns ids, remembers each player's last state, forwards updates.

The server never interprets `state`; it only checks that it is a small JSON object.
"""
import asyncio
import json
import os
import uuid

import websockets

PORT = int(os.environ.get("PORT", "8765"))
MAX_MESSAGE_BYTES = 1024

players = {}  # id -> websocket
states = {}  # id -> last state


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
    async with websockets.serve(handler, "0.0.0.0", PORT, max_size=MAX_MESSAGE_BYTES):
        print(f"Relay server listening on :{PORT}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
