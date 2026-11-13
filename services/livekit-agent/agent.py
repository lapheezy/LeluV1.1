#!/usr/bin/env python3
"""
==========================================================
LÉLU — LIVEKIT VOICE AGENT (transport only, never a second brain)
==========================================================
Per room:  user mic ──LiveKit──▶ Silero VAD ──▶ Groq Whisper (via LÉLU's
broker) ──data "transcript"──▶ the PAGE, whose existing cognition
(AIService, the same conversation as text chat) writes the reply
──data "reply"──▶ here ──▶ VoxCPM2 worker (via LÉLU's /api/voice/vox)
──PCM──▶ one published audio track ──LiveKit──▶ the user.

This process holds no LLM client, no memory and no conversation. If you
are looking for where she decides what to say: it is not here.

Data channel, topic "lelu.voice", JSON:
  agent → page   {type:"ready"} · {type:"user_speaking"} · {type:"transcript", turnId, text}
                 {type:"speaking", turnId} · {type:"spoke", turnId} · {type:"stopped", turnId, reason}
                 {type:"error", where, detail}
  page  → agent  {type:"reply", turnId, text} · {type:"stop"}

STOP and barge-in both: cancel the synthesis task (closing the HTTP stream,
which aborts the worker's generation), clear the LiveKit audio source queue
(so already-buffered audio is dropped, not played out), and report "stopped".

Control API (loopback; LELU_VOICE_AGENT_TOKEN required for POST):
  GET  /health          → {ok, rooms, vad, stt, tts}
  POST /rooms {room}    → join that room (idempotent)
  POST /rooms/leave {room}

Env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LELU_VOICE_AGENT_TOKEN,
     LELU_APP_URL (default http://127.0.0.1:5173), LELU_VOICE_AGENT_PORT (8790)
"""
from __future__ import annotations

import asyncio
import hmac
import io
import json
import os
import re
import sys
import time
import wave

import aiohttp
import numpy as np
from aiohttp import web
from livekit import api, rtc
from livekit.agents import vad as agents_vad
from livekit.plugins import silero

TOPIC = "lelu.voice"
AGENT_IDENTITY = "lelu-voice-agent"
OUT_RATE = 48_000
VAD_RATE = 16_000
APP_URL = os.environ.get("LELU_APP_URL", "http://127.0.0.1:5173").rstrip("/")
STT_URL = os.environ.get("LELU_STT_URL", f"{APP_URL}/api/model/groq/audio/transcriptions")
TTS_URL = os.environ.get("LELU_TTS_URL", f"{APP_URL}/api/voice/vox/speech")
WHISPER_MODEL = os.environ.get("LELU_STT_MODEL", "whisper-large-v3-turbo")
WHISPER_NAME_HINT = "Talking with Lélu."  # same hint the page uses (transcriptionTransport.ts)
IDLE_LEAVE_SECONDS = float(os.environ.get("LELU_AGENT_IDLE_LEAVE", "120"))
# "sentence": synthesise a whole sentence, then play it — no gaps, more latency.
#   Right for a CPU worker (RTF ~5): streamed playback would starve and stutter.
# "stream": play chunks as they arrive — right only when the worker is faster
#   than real time (a GPU).
PLAYBACK = os.environ.get("LELU_AGENT_PLAYBACK", "sentence")


def log(event: str, **fields) -> None:
    sys.stderr.write(json.dumps({"at": round(time.time(), 3), "event": event, **fields}, ensure_ascii=False) + "\n")
    sys.stderr.flush()


def sentences(text: str, limit: int = 220) -> list[str]:
    """Speak in sentence-sized pieces so the first audio arrives sooner."""
    parts = [p.strip() for p in re.split(r"(?<=[.!?…])\s+", " ".join(text.split())) if p.strip()]
    out: list[str] = []
    for part in parts:
        while len(part) > limit:
            cut = part.rfind(" ", 0, limit)
            cut = cut if cut > 40 else limit
            out.append(part[:cut].strip())
            part = part[cut:].strip()
        if out and len(out[-1]) + len(part) < 80:  # glue very short sentences
            out[-1] = f"{out[-1]} {part}"
        else:
            out.append(part)
    return out


def split_frame(frame: rtc.AudioFrame, ms: int = 20):
    """Hand LiveKit 20 ms frames: capture_frame paces playout per frame, and a
    multi-second frame would overflow the source queue."""
    step = frame.sample_rate * ms // 1000
    data = np.frombuffer(frame.data, dtype=np.int16)
    for start in range(0, len(data), step):
        part = data[start : start + step]
        yield rtc.AudioFrame(part.tobytes(), frame.sample_rate, 1, len(part))


def wav_bytes(pcm: np.ndarray, rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.astype("<i2").tobytes())
    return buffer.getvalue()


class RoomSession:
    def __init__(self, agent: "Agent", room_name: str) -> None:
        self.agent = agent
        self.room_name = room_name
        self.room = rtc.Room()
        self.source = rtc.AudioSource(OUT_RATE, 1, queue_size_ms=1000)
        self.turn = 0
        self.speaking_turn: int | None = None
        self.speak_task: asyncio.Task | None = None
        self.listen_tasks: dict[str, asyncio.Task] = {}
        self.last_user_seen = time.time()
        self.closed = asyncio.Event()

    # -- plumbing ------------------------------------------------------

    async def send(self, payload: dict) -> None:
        try:
            await self.room.local_participant.publish_data(json.dumps(payload), reliable=True, topic=TOPIC)
        except Exception as exc:  # the room may be closing
            log("send_failed", room=self.room_name, error=str(exc))

    async def start(self) -> None:
        token = (
            api.AccessToken(self.agent.key, self.agent.secret)
            .with_identity(AGENT_IDENTITY)
            .with_name("LÉLU voice")
            .with_grants(api.VideoGrants(room_join=True, room=self.room_name, can_publish=True, can_subscribe=True, can_publish_data=True))
            .to_jwt()
        )

        @self.room.on("track_subscribed")
        def _on_track(track: rtc.Track, _pub, participant: rtc.RemoteParticipant) -> None:
            if track.kind == rtc.TrackKind.KIND_AUDIO and participant.identity.startswith("user-"):
                old = self.listen_tasks.pop(participant.identity, None)
                if old:
                    old.cancel()
                self.listen_tasks[participant.identity] = asyncio.create_task(self.listen(track, participant.identity))
                log("listening", room=self.room_name, participant=participant.identity)
                # Only now can she hear: say so, so the page never invites
                # the user to speak into a microphone nobody is receiving.
                asyncio.create_task(self.send({"type": "listening"}))

        @self.room.on("participant_connected")
        def _on_join(participant: rtc.RemoteParticipant) -> None:
            self.last_user_seen = time.time()
            log("participant_joined", room=self.room_name, participant=participant.identity)
            asyncio.create_task(self.send({"type": "ready"}))

        @self.room.on("participant_disconnected")
        def _on_leave(participant: rtc.RemoteParticipant) -> None:
            task = self.listen_tasks.pop(participant.identity, None)
            if task:
                task.cancel()
            log("participant_left", room=self.room_name, participant=participant.identity)

        @self.room.on("data_received")
        def _on_data(packet: rtc.DataPacket) -> None:
            if packet.topic != TOPIC or not packet.participant or not packet.participant.identity.startswith("user-"):
                return
            try:
                message = json.loads(packet.data.decode("utf-8"))
            except ValueError:
                return
            asyncio.create_task(self.on_message(message))

        @self.room.on("disconnected")
        def _on_disconnected(reason=None) -> None:
            log("room_disconnected", room=self.room_name, reason=str(reason))
            self.closed.set()

        await self.room.connect(self.agent.url, token)
        track = rtc.LocalAudioTrack.create_audio_track("lelu-voice", self.source)
        await self.room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        log("joined", room=self.room_name, sid=await self.room.sid)
        await self.send({"type": "ready"})
        asyncio.create_task(self.idle_watch())

    async def idle_watch(self) -> None:
        while not self.closed.is_set():
            await asyncio.sleep(5)
            if any(p.identity.startswith("user-") for p in self.room.remote_participants.values()):
                self.last_user_seen = time.time()
            elif time.time() - self.last_user_seen > IDLE_LEAVE_SECONDS:
                log("idle_leave", room=self.room_name)
                await self.close()
                return

    async def close(self) -> None:
        await self.stop_speaking("closing")
        for task in self.listen_tasks.values():
            task.cancel()
        await self.room.disconnect()
        self.closed.set()
        self.agent.sessions.pop(self.room_name, None)

    # -- ears ----------------------------------------------------------

    async def listen(self, track: rtc.Track, identity: str) -> None:
        stream = rtc.AudioStream(track, sample_rate=VAD_RATE, num_channels=1)
        vad_stream = self.agent.vad.stream()

        async def feed() -> None:
            async for event in stream:
                vad_stream.push_frame(event.frame)

        feeder = asyncio.create_task(feed())
        try:
            async for event in vad_stream:
                if event.type == agents_vad.VADEventType.START_OF_SPEECH:
                    await self.send({"type": "user_speaking"})
                    if self.speaking_turn is not None:
                        log("barge_in", room=self.room_name, turn=self.speaking_turn)
                        await self.stop_speaking("barge-in")
                elif event.type == agents_vad.VADEventType.END_OF_SPEECH:
                    frames = event.frames or []
                    if not frames:
                        continue
                    pcm = np.concatenate([np.frombuffer(f.data, dtype=np.int16) for f in frames])
                    rate = frames[0].sample_rate
                    if len(pcm) < rate * 0.3:
                        continue  # a click, not speech
                    asyncio.create_task(self.transcribe(pcm, rate, round(len(pcm) / rate, 2)))
        finally:
            feeder.cancel()
            await vad_stream.aclose()
            await stream.aclose()

    async def transcribe(self, pcm: np.ndarray, rate: int, seconds: float) -> None:
        started = time.time()
        form = aiohttp.FormData()
        form.add_field("file", wav_bytes(pcm, rate), filename="utterance.wav", content_type="audio/wav")
        form.add_field("model", WHISPER_MODEL)
        form.add_field("response_format", "json")
        form.add_field("prompt", WHISPER_NAME_HINT)
        try:
            async with self.agent.http.post(STT_URL, data=form, timeout=aiohttp.ClientTimeout(total=30)) as response:
                body = await response.text()
                if response.status != 200:
                    log("stt_failed", status=response.status, body=body[:200])
                    await self.send({"type": "error", "where": "stt", "detail": f"HTTP {response.status}"})
                    return
                text = (json.loads(body).get("text") or "").strip()
        except Exception as exc:
            log("stt_failed", error=str(exc))
            await self.send({"type": "error", "where": "stt", "detail": str(exc)})
            return
        if not text:
            return
        self.turn += 1
        log("transcript", room=self.room_name, turn=self.turn, seconds=seconds, sttMs=int((time.time() - started) * 1000), text=text)
        await self.send({"type": "transcript", "turnId": self.turn, "text": text, "audioSeconds": seconds})

    # -- mouth ---------------------------------------------------------

    async def on_message(self, message: dict) -> None:
        kind = message.get("type")
        if kind == "stop":
            await self.stop_speaking("stop")
        elif kind == "reply":
            text = str(message.get("text") or "").strip()
            if not text:
                return
            await self.stop_speaking("superseded")
            turn = int(message.get("turnId") or 0)
            self.speak_task = asyncio.create_task(self.speak(turn, text))

    async def stop_speaking(self, reason: str) -> None:
        task, turn = self.speak_task, self.speaking_turn
        self.speak_task = None
        if task is not None and task.done():
            task, turn = None, None  # already finished: nothing was interrupted
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self.source.clear_queue()  # drop buffered audio: silence now, not after the buffer drains
        if task is not None and turn is not None:
            self.speaking_turn = None
            log("stopped", room=self.room_name, turn=turn, reason=reason)
            await self.send({"type": "stopped", "turnId": turn, "reason": reason})

    async def speak(self, turn: int, text: str) -> None:
        self.speaking_turn = turn
        first = True
        started = time.time()
        samples_out = 0
        try:
            for piece in sentences(text):
                async with self.agent.http.post(
                    TTS_URL,
                    json={"input": piece, "stream": True, "response_format": "pcm"},
                    timeout=aiohttp.ClientTimeout(total=600, sock_read=120),
                ) as response:
                    if response.status != 200:
                        detail = (await response.text())[:300]
                        log("tts_failed", status=response.status, detail=detail)
                        await self.send({"type": "error", "where": "tts", "detail": f"HTTP {response.status}: {detail}"})
                        return
                    match = re.search(r"rate=(\d+)", response.headers.get("Content-Type", ""))
                    rate = int(match.group(1)) if match else OUT_RATE
                    resampler = rtc.AudioResampler(rate, OUT_RATE) if rate != OUT_RATE else None
                    carry = b""
                    chunks = response.content.iter_any()
                    if PLAYBACK == "sentence":
                        whole = b"".join([part async for part in chunks])

                        async def _once(data=whole):
                            yield data

                        chunks = _once()
                    async for chunk in chunks:
                        data = carry + chunk
                        usable = len(data) - (len(data) % 2)
                        carry = data[usable:]
                        if not usable:
                            continue
                        pcm = np.frombuffer(data[:usable], dtype="<i2")
                        frames = [rtc.AudioFrame(pcm.tobytes(), rate, 1, len(pcm))]
                        if resampler:
                            frames = resampler.push(frames[0])
                        for frame in (piece for f in frames for piece in split_frame(f)):
                            if first:
                                first = False
                                log("first_audio", room=self.room_name, turn=turn, ms=int((time.time() - started) * 1000))
                                await self.send({"type": "speaking", "turnId": turn})
                            samples_out += frame.samples_per_channel
                            await self.source.capture_frame(frame)
            if samples_out == 0:
                log("tts_empty", room=self.room_name, turn=turn)
                await self.send({"type": "error", "where": "tts", "detail": "the speech worker returned no audio"})
                return
            await self.source.wait_for_playout()
            log("spoke", room=self.room_name, turn=turn, seconds=round(samples_out / OUT_RATE, 2), ms=int((time.time() - started) * 1000))
            await self.send({"type": "spoke", "turnId": turn})
        finally:
            if self.speaking_turn == turn:
                self.speaking_turn = None


class Agent:
    def __init__(self) -> None:
        self.url = os.environ["LIVEKIT_URL"]
        self.key = os.environ["LIVEKIT_API_KEY"]
        self.secret = os.environ["LIVEKIT_API_SECRET"]
        self.control_token = os.environ.get("LELU_VOICE_AGENT_TOKEN", "")
        self.sessions: dict[str, RoomSession] = {}
        self.vad = silero.VAD.load(min_silence_duration=0.7, min_speech_duration=0.15, activation_threshold=0.5)
        self.http: aiohttp.ClientSession | None = None
        self.started = time.time()

    def authorised(self, request: web.Request) -> bool:
        presented = request.headers.get("X-Lelu-Agent-Token", "")
        return bool(self.control_token) and hmac.compare_digest(presented, self.control_token)

    async def health(self, _request: web.Request) -> web.Response:
        return web.json_response(
            {
                "ok": True,
                "uptimeSeconds": round(time.time() - self.started, 1),
                "rooms": sorted(self.sessions),
                "vad": "silero",
                "stt": STT_URL,
                "tts": TTS_URL,
            }
        )

    async def join(self, request: web.Request) -> web.Response:
        if not self.authorised(request):
            return web.json_response({"ok": False, "error": "unauthorised"}, status=401)
        body = await request.json()
        room = str(body.get("room") or "")
        if not re.fullmatch(r"lelu-[A-Za-z0-9_-]{1,80}", room):
            return web.json_response({"ok": False, "error": "invalid room"}, status=400)
        session = self.sessions.get(room)
        if session and not session.closed.is_set():
            return web.json_response({"ok": True, "room": room, "already": True})
        session = RoomSession(self, room)
        self.sessions[room] = session
        try:
            await session.start()
        except Exception as exc:
            self.sessions.pop(room, None)
            log("join_failed", room=room, error=str(exc))
            return web.json_response({"ok": False, "error": str(exc)}, status=502)
        return web.json_response({"ok": True, "room": room})

    async def leave(self, request: web.Request) -> web.Response:
        if not self.authorised(request):
            return web.json_response({"ok": False, "error": "unauthorised"}, status=401)
        room = str((await request.json()).get("room") or "")
        session = self.sessions.get(room)
        if session:
            await session.close()
        return web.json_response({"ok": True, "room": room, "left": bool(session)})


async def main() -> None:
    agent = Agent()
    agent.http = aiohttp.ClientSession()
    app = web.Application()
    app.router.add_get("/health", agent.health)
    app.router.add_post("/rooms", agent.join)
    app.router.add_post("/rooms/leave", agent.leave)
    runner = web.AppRunner(app)
    await runner.setup()
    port = int(os.environ.get("LELU_VOICE_AGENT_PORT", "8790"))
    await web.TCPSite(runner, "127.0.0.1", port).start()
    log("agent_listening", port=port, livekit=agent.url, stt=STT_URL, tts=TTS_URL, controlAuth=bool(agent.control_token))
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    import signal

    for signum in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(signum, stop.set)
    await stop.wait()
    for session in list(agent.sessions.values()):
        await session.close()
    await agent.http.close()
    await runner.cleanup()
    log("agent_stopped")


if __name__ == "__main__":
    asyncio.run(main())
