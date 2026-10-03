# client.py
import asyncio
import websockets

SERVER = "wss://konstantin-macbook-6.miku-harmonic.ts.net/"

async def receive(ws):
    async for message in ws:
        print("\nREMOTE:", message)

async def main():
    async with websockets.connect(SERVER) as ws:
        asyncio.create_task(receive(ws))

        while True:
            msg = await asyncio.to_thread(input, "> ")
            await ws.send(msg)

asyncio.run(main())