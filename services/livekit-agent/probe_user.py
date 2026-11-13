#!/usr/bin/env python3
"""
Scripted USER participant for testing the LÉLU voice agent over a real
LiveKit server. NOT a real-device test: the "microphone" is a WAV file.

    probe_user.py --url ws://… --token JWT --utterance in.wav --out-dir DIR \
                  [--reply "text"] [--stop-after-ms 1500] [--barge-in in.wav]

Steps: publish the utterance as a mic track → wait for the agent's
`transcript` → (optionally) send `reply` → record the agent's audio track
→ (optionally) send `stop`, or talk over her (barge-in), and measure how
long the agent's audio stays non-silent afterwards. Prints one JSON report.
"""
import argparse
import asyncio
import json
import time
import wave

import numpy as np
from livekit import rtc

TOPIC = "lelu.voice"


def read_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as handle:
        rate, channels = handle.getframerate(), handle.getnchannels()
        data = np.frombuffer(handle.readframes(handle.getnframes()), dtype="<i2")
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1).astype(np.int16)
    return data, rate


async def play(source: rtc.AudioSource, pcm: np.ndarray, rate: int) -> None:
    step = rate // 100  # 10 ms frames
    for start in range(0, len(pcm), step):
        chunk = pcm[start : start + step]
        if len(chunk) < step:
            chunk = np.pad(chunk, (0, step - len(chunk)))
        await source.capture_frame(rtc.AudioFrame(chunk.tobytes(), rate, 1, step))


async def silence(source: rtc.AudioSource, rate: int, seconds: float) -> None:
    await play(source, np.zeros(int(rate * seconds), dtype=np.int16), rate)


async def main(args) -> int:
    room = rtc.Room()
    events: list[dict] = []
    got: dict[str, asyncio.Event] = {k: asyncio.Event() for k in ("ready", "transcript", "speaking", "spoke", "stopped")}
    received: list[tuple[float, np.ndarray]] = []
    t0 = time.time()

    @room.on("data_received")
    def _data(packet: rtc.DataPacket) -> None:
        if packet.topic != TOPIC:
            return
        message = json.loads(packet.data.decode())
        message["_t"] = round(time.time() - t0, 3)
        events.append(message)
        if message["type"] in got:
            got[message["type"]].set()

    @room.on("track_subscribed")
    def _track(track: rtc.Track, _pub, participant: rtc.RemoteParticipant) -> None:
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return

        async def record() -> None:
            async for event in rtc.AudioStream(track, sample_rate=48000, num_channels=1):
                received.append((time.time() - t0, np.frombuffer(event.frame.data, dtype=np.int16).copy()))

        asyncio.create_task(record())

    await room.connect(args.url, args.token)
    utterance, rate = read_wav(args.utterance)
    source = rtc.AudioSource(rate, 1)
    await room.local_participant.publish_track(rtc.LocalAudioTrack.create_audio_track("mic", source), rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
    await asyncio.sleep(1.0)
    await silence(source, rate, 0.8)  # let the VAD learn the floor
    spoke_at = time.time() - t0
    await play(source, utterance, rate)
    await silence(source, rate, 1.5)  # end of turn
    report: dict = {"utteranceSentAt": spoke_at}
    try:
        await asyncio.wait_for(got["transcript"].wait(), 60)
    except asyncio.TimeoutError:
        report["error"] = "no transcript within 60 s"
    transcript = next((e for e in events if e["type"] == "transcript"), None)
    report["transcript"] = transcript

    if args.reply and transcript:
        await room.local_participant.publish_data(json.dumps({"type": "reply", "turnId": transcript["turnId"], "text": args.reply}), reliable=True, topic=TOPIC)
        try:
            await asyncio.wait_for(got["speaking"].wait(), 300)
        except asyncio.TimeoutError:
            report["error"] = "agent never started speaking"
        if args.stop_after_ms is not None and got["speaking"].is_set():
            await asyncio.sleep(args.stop_after_ms / 1000)
            report["stopSentAt"] = round(time.time() - t0, 3)
            await room.local_participant.publish_data(json.dumps({"type": "stop"}), reliable=True, topic=TOPIC)
            await asyncio.wait_for(got["stopped"].wait(), 30)
            await asyncio.sleep(3)
        elif args.barge_in and got["speaking"].is_set():
            await asyncio.sleep(1.5)
            barge, brate = read_wav(args.barge_in)
            report["bargeInStartedAt"] = round(time.time() - t0, 3)
            await play(source, barge[: brate * 2], brate) if brate == rate else None
            await asyncio.wait_for(got["stopped"].wait(), 30)
            await asyncio.sleep(3)
        else:
            await asyncio.wait_for(got["spoke"].wait(), 600)
            await asyncio.sleep(1)

    # Analyse what we heard from the agent.
    if received:
        times = np.array([t for t, _ in received])
        energy = np.array([float(np.sqrt(np.mean(f.astype(np.float32) ** 2))) for _, f in received])
        loud = times[energy > 300]
        report["agentAudio"] = {
            "frames": len(received),
            "firstLoudAt": round(float(loud[0]), 3) if len(loud) else None,
            "lastLoudAt": round(float(loud[-1]), 3) if len(loud) else None,
        }
        cut = report.get("stopSentAt") or report.get("bargeInStartedAt")
        if cut is not None and len(loud):
            report["agentAudio"]["audibleAfterStopMs"] = int(max(0.0, float(loud[-1]) - cut) * 1000)
        pcm = np.concatenate([f for _, f in received])
        with wave.open(f"{args.out_dir}/agent-heard.wav", "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(48000)
            # keep only the loud span so the file is the reply, not minutes of silence
            if len(loud):
                start = int(float(loud[0] - times[0]) * 48000)
                end = int(float(loud[-1] - times[0] + 0.3) * 48000)
                pcm = pcm[max(0, start - 4800) : end]
            handle.writeframes(pcm.tobytes())
    report["events"] = events
    await room.disconnect()
    print(json.dumps(report, ensure_ascii=False))
    return 0 if "error" not in report else 1


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--token", required=True)
    p.add_argument("--utterance", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--reply")
    p.add_argument("--stop-after-ms", type=int)
    p.add_argument("--barge-in")
    raise SystemExit(asyncio.run(main(p.parse_args())))
