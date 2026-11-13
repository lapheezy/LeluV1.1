#!/usr/bin/env python3
"""Join a LiveKit room with a given JWT as a real participant, then leave.

    .venv-livekit-agent/bin/python services/livekit-agent/probe_connect.py URL TOKEN [SECONDS]

Prints one JSON line: room name, room sid, local identity, remote participants
seen, and the connection state. Exit 0 only if the connection reached CONNECTED.
Used by tests/livekit-token.test.ts to prove a token the app issued works.
"""
import asyncio
import json
import sys

from livekit import rtc


async def main(url: str, token: str, hold: float) -> int:
    room = rtc.Room()
    await room.connect(url, token, options=rtc.RoomOptions(auto_subscribe=False))
    await asyncio.sleep(hold)
    result = {
        "connected": room.connection_state == rtc.ConnectionState.CONN_CONNECTED,
        "room": room.name,
        "roomSid": await room.sid,
        "identity": room.local_participant.identity,
        "remote": sorted(p.identity for p in room.remote_participants.values()),
    }
    await room.disconnect()
    print(json.dumps(result), flush=True)
    return 0 if result["connected"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 1.0)))
