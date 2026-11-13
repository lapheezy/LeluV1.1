#!/usr/bin/env python3
"""
Isolated CPU benchmark of MOSS-TTS-Nano ONNX (OpenMOSS/MOSS-TTS-Nano @ 8b7bcc9).
Uses the published runtime classes unchanged; only adds a chunk callback (to
measure first audio) and a cancel flag (to measure STOP) around the same
frame loop synthesize_single_chunk() runs.

  python moss_bench.py --repo DIR --ref REF.wav --out DIR [--threads 4] [--mode full|stability|worker]
Prints JSON lines. Never downloads (models must already be in DIR/models).
"""
import argparse
import json
import os
import sys
import threading
import time
import wave
from pathlib import Path

import numpy as np

T0 = time.perf_counter()


def mem() -> dict:
    out = {}
    for line in open("/proc/self/status"):
        if line.startswith(("VmRSS:", "VmHWM:")):
            out["rssMiB" if line.startswith("VmRSS") else "peakMiB"] = int(line.split()[1]) // 1024
    return out


def cpu_seconds() -> float:
    t = os.times()
    return t.user + t.system


def emit(event: str, **fields) -> None:
    print(json.dumps({"event": event, "t": round(time.perf_counter() - T0, 3), **fields, **mem()}), flush=True)


class Cancelled(Exception):
    pass


SENTENCES = {
    "short": "Paris is the capital of France.",
    "medium": "Good evening. I'm Lélu, and I can answer you while we keep talking.",
    "long": "The ocean stretched out before her like a boundless sapphire tapestry, its waves whispering ancient lullabies to the shore, while gulls traced slow circles in the warm evening light.",
}


def write_wav(path: Path, mono: np.ndarray, rate: int) -> None:
    pcm = (np.clip(mono, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--mode", default="full", choices=["full", "stability", "worker", "quality"])
    parser.add_argument("--repeat", type=int, default=10)
    parser.add_argument("--label", default="")
    parser.add_argument("--no-spin", action="store_true", help="disable ORT intra-op thread spinning in every session")
    parser.add_argument("--lean", action="store_true", help="also disable ORT's CPU memory arena and memory-pattern planning")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, args.repo)
    os.environ["HF_HUB_OFFLINE"] = "1"

    emit("start", threads=args.threads, mode=args.mode, label=args.label)
    if args.no_spin:
        import onnxruntime as ort

        _Base = ort.SessionOptions

        class _NoSpin(_Base):  # same options, plus: idle threads sleep instead of busy-waiting
            def __init__(self, *a, **k):
                super().__init__(*a, **k)
                self.add_session_config_entry("session.intra_op.allow_spinning", "0")
                if args.lean:
                    self.enable_cpu_mem_arena = False
                    self.enable_mem_pattern = False

        ort.SessionOptions = _NoSpin
    import onnx_tts_runtime as otr  # noqa: E402

    emit("imported")
    c0, w0 = cpu_seconds(), time.perf_counter()
    rt = otr.OnnxTtsRuntime(model_dir=Path(args.repo) / "models", thread_count=args.threads, output_dir=out)
    emit("loaded", loadSeconds=round(time.perf_counter() - w0, 2), loadCpuSeconds=round(cpu_seconds() - c0, 2))
    w0 = time.perf_counter()
    prompt_codes = rt.encode_reference_audio(args.ref)
    emit("reference_encoded", seconds=round(time.perf_counter() - w0, 2), promptFrames=len(prompt_codes))
    sample_rate = int(rt.codec_meta["codec_config"]["sample_rate"])
    gd = rt.manifest["generation_defaults"]
    gd["sample_mode"] = "fixed"
    gd["do_sample"] = True

    def synth(text: str, cancel_after_first: bool = False) -> dict:
        """The published streaming path, with a chunk timestamp and a cancel check."""
        prepared = str(rt.prepare_synthesis_text(text=text, voice="", enable_wetext=False, enable_normalize_tts_text=True)["text"])
        chunks_text = rt.split_voice_clone_text(prepared, max_tokens=75)
        started, c_start = time.perf_counter(), cpu_seconds()
        first_at = None
        cancel = {"requested_at": None}
        timing = {"codec": 0.0}
        arrivals: list[tuple[float, int]] = []  # (seconds since start, samples already emitted before this chunk)
        total_samples = {"n": 0}
        audio_parts: list[np.ndarray] = []
        cancelled = False
        for chunk_text in chunks_text:
            token_ids = rt.encode_text(chunk_text)
            rows = rt.build_voice_clone_request_rows(prompt_codes, token_ids)
            pending: list[list[int]] = []
            emitted = {"samples": 0, "first": None}
            rt.codec_streaming_session.reset()

            def decode(force: bool) -> None:
                nonlocal first_at
                if not pending:
                    return
                budget = otr._resolve_stream_decode_frame_budget(emitted["samples"], sample_rate, emitted["first"])
                if not force and len(pending) < max(1, budget):
                    return
                take = len(pending) if force else min(len(pending), max(1, budget))
                frames = pending[:take]
                del pending[:take]
                d0 = time.perf_counter()
                decoded = rt.codec_streaming_session.run_frames(frames)
                timing["codec"] += time.perf_counter() - d0
                if decoded is None:
                    return
                audio, length = decoded
                if length <= 0:
                    return
                if emitted["first"] is None:
                    emitted["first"] = time.perf_counter()
                if first_at is None:
                    first_at = time.perf_counter()
                    if cancel_after_first:
                        cancel["requested_at"] = time.perf_counter()
                arrivals.append((time.perf_counter() - started, total_samples["n"]))
                total_samples["n"] += length
                emitted["samples"] += length
                audio_parts.append(otr._merge_audio_channels([audio[0, ch, :length] for ch in range(audio.shape[1])]))

            def on_frame(_frames, _step, frame) -> None:
                if cancel["requested_at"] is not None:
                    raise Cancelled()
                pending.append(list(frame))
                decode(False)

            try:
                rt.generate_audio_frames(rows, on_frame=on_frame)
                decode(True)
            except Cancelled:
                cancelled = True
            finally:
                rt.codec_streaming_session.reset()
            if cancelled:
                break
        ended = time.perf_counter()
        mono = np.concatenate(audio_parts) if audio_parts else np.zeros(0, dtype=np.float32)
        if mono.ndim > 1:
            mono = mono.mean(axis=1)
        audio_s = len(mono) / sample_rate
        result = {
            "chars": len(text),
            "firstAudioMs": None if first_at is None else int((first_at - started) * 1000),
            "totalMs": int((ended - started) * 1000),
            "audioSeconds": round(audio_s, 2),
            "rtf": round((ended - started) / audio_s, 3) if audio_s else None,
            "cpuSeconds": round(cpu_seconds() - c_start, 2),
            "cancelled": cancelled,
            "codecMs": int(timing["codec"] * 1000),
            # Smallest head start that lets playback (started when the first chunk
            # arrives + this delay) never run past the audio received so far.
            "gaplessPrebufferMs": int(max([0.0] + [(t - arrivals[0][0]) - pos / sample_rate for t, pos in arrivals]) * 1000) if arrivals else None,
            "chunks": len(arrivals),
        }
        if cancelled and cancel["requested_at"] is not None:
            result["stopToReturnMs"] = round((ended - cancel["requested_at"]) * 1000, 1)
        result["_audio"] = mono
        return result

    if args.mode == "full":
        synth("Warm up.")  # first-call graph initialisation, reported separately below
        for name, text in SENTENCES.items():
            for run in (1, 2):
                r = synth(text)
                audio = r.pop("_audio")
                if run == 1:
                    write_wav(out / f"moss-{name}.wav", audio, sample_rate)
                emit("synth", sentence=name, run=run, **r)
        r = synth(SENTENCES["long"], cancel_after_first=True)
        r.pop("_audio")
        emit("cancel", **r)
    elif args.mode == "stability":
        for i in range(args.repeat):
            r = synth(SENTENCES["medium"])
            r.pop("_audio")
            emit("repeat", i=i + 1, **r)
    elif args.mode == "quality":
        texts = [
            "Of course. I'll remind you tomorrow morning at nine.",
            "That's a good question. Let me think about it for a moment.",
            "Lélu here. I found three new messages for you.",
            "The weather today is sunny, with a high of twenty four degrees.",
            "I'm sorry, I didn't catch that. Could you say it again?",
            "Your meeting with the design team starts in fifteen minutes.",
            "Hello! It's lovely to hear from you again.",
            "I've saved the document and shared it with your project folder.",
            "Sure. Here is a short summary of what we discussed today.",
            "Good night. Sleep well, and I'll be here when you wake up.",
        ]
        for i, text in enumerate(texts):
            rt.rng = np.random.default_rng(1000 + i)
            r = synth(text)
            audio = r.pop("_audio")
            write_wav(out / f"q{i:02d}.wav", audio, sample_rate)
            (out / f"q{i:02d}.txt").write_text(text)
            emit("quality", i=i, **r)
    elif args.mode == "worker":  # used for concurrency: one process per simultaneous request
        synth("Warm up.")
        barrier = Path(args.out) / "go"
        while not barrier.exists():
            time.sleep(0.05)
        r = synth(SENTENCES["medium"])
        r.pop("_audio")
        emit("concurrent", **r)
    emit("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
