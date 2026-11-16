#!/usr/bin/env python3
"""
==========================================================
LÉLU — MOSS-TTS-Nano CPU SPEECH WORKER (opt-in candidate)
==========================================================
A drop-in for services/voxcpm/server.py: the SAME HTTP contract, so the
app (plugins/voxApi.ts → VoxcpmPool) and the LiveKit agent need no change.
Select it by pointing the pool at it (VOXCPM_BASE_URL=http://127.0.0.1:8789).
VoxCPM2 stays the default and the rollback.

    GET  /health            → state/ready/selftest/memory + the fields the pool reads
    POST /warmup            → load now
    POST /v1/audio/speech   → {input, response_format: wav|pcm, stream}
                              wav, or chunked PCM16 mono 48 kHz (audio/L16;rate=48000;channels=1)

Model: OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX + MOSS-Audio-Tokenizer-Nano-ONNX
(Apache-2.0, ungated), runtime code OpenMOSS/MOSS-TTS-Nano @ 8b7bcc9, both
fetched by services/mossnano/install.sh. Their code is used unchanged.

What this file adds, each measured in CPU-TTS-BACKEND-COMPARISON.md:
· ONNX Runtime threads do not spin and the CPU memory arena is off
  (RTF ~1.8 → ~0.9 on 4 vCPU; 3.3 GB → 1.9 GB resident);
· the reference clip is encoded ONCE at load, not per request;
· "Lélu" is respelled "Lay-loo" before synthesis: written with its accent
  the model looped or garbled the sentence in half of the test clips;
· a client disconnect (STOP, barge-in) aborts generation between frames;
· one generation at a time, bounded queue (503 past it);
· READY only after a real generation produced non-silent audio.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / ".mossnano"


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def _memory() -> dict:
    out: dict = {}
    try:
        for line in open("/proc/self/status", encoding="utf-8"):
            if line.startswith(("VmRSS:", "VmHWM:")):
                key, value = line.split(":", 1)
                out["rssGiB" if key == "VmRSS" else "peakGiB"] = round(int(value.split()[0]) / 1048576, 2)
    except OSError:
        pass
    return out


# Words the model mispronounces as written, and the spelling it says right.
# Matched case-insensitively as whole words; extend via MOSS_LEXICON (JSON).
DEFAULT_LEXICON = {"Lélu": "Lay-loo", "LÉLU": "Lay-loo", "Lelu": "Lay-loo", "LELU": "Lay-loo"}


def pronounce(text: str, lexicon: dict) -> str:
    for written, spoken in lexicon.items():
        text = re.sub(rf"(?<!\w){re.escape(written)}(?!\w)", spoken, text, flags=re.IGNORECASE)
    return text


class Cancelled(Exception):
    pass


class SilenceGate:
    """Caps dead air the model generates (measured: 1.8 s between two
    sentences) WITHOUT delaying anything: quiet audio is passed through at
    once until the current quiet run reaches its cap, and only the excess is
    dropped. (Holding quiet audio back until speech resumed made every natural
    pause play twice in a live stream: once as a stall, once as the pause.)
    Caps: 100 ms before a chunk's first sound, 300 ms for any later pause."""

    LEAD, INNER = 0.10, 0.30

    def __init__(self, rate: int, write) -> None:
        self.rate, self.write = rate, write
        self.block = rate // 100  # 10 ms
        self.quiet = 0
        self.heard = False
        self.removed = 0

    def push(self, mono: np.ndarray) -> None:
        for start in range(0, len(mono), self.block):
            part = mono[start : start + self.block]
            if float(np.sqrt(np.mean(part ** 2))) >= 0.01:
                self.quiet, self.heard = 0, True
                self._emit(part)
                continue
            cap = int(self.rate * (self.INNER if self.heard else self.LEAD))
            if self.quiet + len(part) <= cap:
                self._emit(part)
            else:
                self.removed += len(part)
            self.quiet += len(part)

    def end_chunk(self) -> None:
        self.quiet, self.heard = 0, False

    def _emit(self, mono: np.ndarray) -> None:
        if len(mono):
            self.write((np.clip(mono, -1.0, 1.0) * 32767.0).astype("<i2").tobytes())


class Config:
    def __init__(self) -> None:
        self.src = Path(_env("MOSS_SRC", str(STATE / "src")))
        self.models = Path(_env("MOSS_MODELS", str(STATE / "models")))
        self.host = _env("MOSS_HOST", "127.0.0.1")
        self.port = int(_env("MOSS_PORT", "8789"))
        self.token = _env("MOSS_TOKEN", "")
        self.threads = int(_env("MOSS_THREADS", "3"))
        self.reference = Path(_env("MOSS_REFERENCE_AUDIO", str(ROOT / "public" / "audio" / "voice" / "lelu-voice-reference.m4a")))
        self.reference_seconds = float(_env("MOSS_REFERENCE_SECONDS", "12"))
        self.max_chars = int(_env("MOSS_MAX_CHARS", "900"))
        self.max_queue = int(_env("MOSS_MAX_QUEUE", "4"))
        self.warmup = _env("MOSS_WARMUP", "1") == "1"
        self.lexicon = {**DEFAULT_LEXICON, **json.loads(_env("MOSS_LEXICON", "{}"))}
        state_file = _env("MOSS_STATE_FILE", _env("VOXCPM_STATE_FILE", ""))
        self.state_file = Path(state_file) if state_file else None

    def as_dict(self) -> dict:
        return {
            "modelId": "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX",
            "device": "cpu",
            "threads": self.threads,
            "reference": str(self.reference),
            "referenceSeconds": self.reference_seconds,
            "maxChars": self.max_chars,
            "maxQueue": self.max_queue,
            "authRequired": bool(self.token),
            "lexicon": self.lexicon,
        }


class Engine:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.rt = None
        self.otr = None
        self.prompt_codes = None
        self.sample_rate = 48000
        self.reference_meta: dict = {}
        self._load_lock = threading.Lock()
        self._generation_lock = threading.Lock()
        self._pending = 0
        self._pending_lock = threading.Lock()
        self.load_seconds = None
        self.load_error = None
        self.selftest_result = None
        self.generated = 0
        self.last = None
        self.state = "STARTING"
        self.state_since = time.time()
        self.state_error = None
        self.phases: dict = {}
        self._set_state("STARTING")

    # -- lifecycle -------------------------------------------------------

    def _set_state(self, state: str, error: "str | None" = None) -> None:
        self.state, self.state_since, self.state_error = state, time.time(), error
        self.phases[state] = round(self.state_since, 3)
        sys.stderr.write(json.dumps({"event": "state", "state": state, "error": error, **_memory()}) + "\n")
        sys.stderr.flush()
        if self.config.state_file:
            payload = {"state": state, "error": error, "pid": os.getpid(), "since": self.state_since, "phases": self.phases,
                       "loadSeconds": self.load_seconds, "selftest": self.selftest_result, "memory": _memory()}
            tmp = self.config.state_file.with_suffix(".tmp")
            tmp.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_text(json.dumps(payload, indent=2))
            tmp.replace(self.config.state_file)

    def _reference_wav(self) -> Path:
        """The committed clip, first N seconds, 48 kHz mono WAV (read-only: the original is never changed)."""
        source = self.config.reference
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        out = STATE / "cache" / f"reference-{digest[:12]}-{int(self.config.reference_seconds)}s.wav"
        if not out.exists():
            import imageio_ffmpeg

            out.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", "-i", str(source), "-t", str(self.config.reference_seconds),
                 "-ac", "1", "-ar", "48000", str(out)],
                check=True,
            )
        self.reference_meta = {"source": str(source), "sha256": digest, "seconds": self.config.reference_seconds, "sampleRate": 48000, "wav": str(out)}
        return out

    def _patch_runtime(self) -> None:
        """No spinning, no memory arena; load the reference with soundfile instead of torchaudio."""
        import onnxruntime as ort

        base = ort.SessionOptions

        class Lean(base):
            def __init__(self, *a, **k):
                super().__init__(*a, **k)
                self.add_session_config_entry("session.intra_op.allow_spinning", "0")
                self.enable_cpu_mem_arena = False
                self.enable_mem_pattern = False

        ort.SessionOptions = Lean

    def ensure_loaded(self):
        if self.rt is not None:
            return self.rt
        with self._load_lock:
            if self.rt is not None:
                return self.rt
            self._set_state("LOADING")
            started = time.time()
            try:
                sys.path.insert(0, str(self.config.src))
                os.environ.setdefault("HF_HUB_OFFLINE", "1")  # a worker never downloads
                self._patch_runtime()
                import onnx_tts_runtime as otr
                import soundfile as sf

                rt = otr.OnnxTtsRuntime(model_dir=self.config.models, thread_count=self.config.threads, output_dir=STATE / "out")

                def load_reference(path, _rt=rt):
                    data, rate = sf.read(str(path), dtype="float32", always_2d=True)
                    mono = data.mean(axis=1)
                    target = int(_rt.codec_meta["codec_config"]["sample_rate"])
                    if rate != target:
                        t = np.arange(0, len(mono) / rate, 1 / target)
                        mono = np.interp(t, np.arange(len(mono)) / rate, mono).astype(np.float32)
                    channels = int(_rt.codec_meta["codec_config"]["channels"])
                    wave = np.repeat(mono[None, :], channels, axis=0)
                    return wave[None, :, :].astype(np.float32)

                rt._load_reference_audio = load_reference
                self.prompt_codes = rt.encode_reference_audio(self._reference_wav())
                self.sample_rate = int(rt.codec_meta["codec_config"]["sample_rate"])
                gd = rt.manifest["generation_defaults"]
                gd["sample_mode"], gd["do_sample"] = "fixed", True
                self.otr, self.rt = otr, rt
            except Exception as exc:
                self.load_error = f"{type(exc).__name__}: {exc}"
                self._set_state("FAILED", f"load: {self.load_error}")
                raise
            self.load_seconds = round(time.time() - started, 1)
            self._set_state("INITIALIZING")
            try:
                chunks: list[bytes] = []
                meta = self.synthesize("Hello, I'm ready.", chunks.append)
                pcm = np.frombuffer(b"".join(chunks), dtype="<i2").astype(np.float32) / 32768
                rms = float(np.sqrt(np.mean(pcm ** 2))) if len(pcm) else 0.0
                self.selftest_result = {**meta, "rms": round(rms, 4), "ok": meta["audioSeconds"] >= 0.3 and rms >= 0.005}
            except Exception as exc:
                self.selftest_result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
            if not self.selftest_result.get("ok"):
                self.rt = None
                self._set_state("FAILED", f"selftest: {self.selftest_result}")
                raise RuntimeError(f"self-test failed: {self.selftest_result}")
            self._set_state("READY")
            return self.rt

    # -- synthesis -------------------------------------------------------

    def acquire(self) -> bool:
        with self._pending_lock:
            if self._pending >= self.config.max_queue:
                return False
            self._pending += 1
            return True

    def release(self) -> None:
        with self._pending_lock:
            self._pending -= 1

    def synthesize(self, text: str, write) -> dict:
        """Stream PCM16 mono to `write(bytes)` as it is decoded. If `write` raises (the
        client went away), generation stops between frames."""
        rt, otr = self.rt, self.otr
        spoken = pronounce(text, self.config.lexicon)
        prepared = str(rt.prepare_synthesis_text(text=spoken, voice="", enable_wetext=False, enable_normalize_tts_text=True)["text"])
        started = time.perf_counter()
        first_at = None
        samples = 0
        sent = {"bytes": 0}

        def counted_write(data: bytes) -> None:
            nonlocal first_at
            if first_at is None:
                first_at = time.perf_counter()
            sent["bytes"] += len(data)
            try:
                write(data)
            except (BrokenPipeError, ConnectionResetError, OSError) as exc:
                raise Cancelled() from exc

        gate = SilenceGate(self.sample_rate, counted_write)
        with self._generation_lock:
            for chunk_text in rt.split_voice_clone_text(prepared, max_tokens=75):
                rows = rt.build_voice_clone_request_rows(self.prompt_codes, rt.encode_text(chunk_text))
                pending: list[list[int]] = []
                emitted = {"samples": 0, "first": None}
                rt.codec_streaming_session.reset()

                def decode(force: bool) -> None:
                    nonlocal samples
                    if not pending:
                        return
                    budget = otr._resolve_stream_decode_frame_budget(emitted["samples"], self.sample_rate, emitted["first"])
                    if not force and len(pending) < max(1, budget):
                        return
                    take = len(pending) if force else min(len(pending), max(1, budget))
                    frames = pending[:take]
                    del pending[:take]
                    decoded = rt.codec_streaming_session.run_frames(frames)
                    if decoded is None:
                        return
                    audio, length = decoded
                    if length <= 0:
                        return
                    mono = np.mean([audio[0, ch, :length] for ch in range(audio.shape[1])], axis=0)
                    if emitted["first"] is None:
                        emitted["first"] = time.perf_counter()
                    emitted["samples"] += length
                    samples += length
                    gate.push(mono.astype(np.float32))

                def on_frame(_frames, _step, frame) -> None:
                    pending.append(list(frame))
                    decode(False)

                try:
                    rt.generate_audio_frames(rows, on_frame=on_frame)
                    decode(True)
                    gate.end_chunk()
                finally:
                    rt.codec_streaming_session.reset()
        elapsed = time.perf_counter() - started
        audio_s = sent["bytes"] / 2 / self.sample_rate
        meta = {
            "ms": int(elapsed * 1000),
            "firstAudioMs": None if first_at is None else int((first_at - started) * 1000),
            "audioSeconds": round(audio_s, 2),
            "rtf": round(elapsed / audio_s, 3) if audio_s else None,
            "silenceTrimmedSeconds": round(gate.removed / self.sample_rate, 2),
        }
        self.generated += 1
        self.last = {"text": text[:120], "spoken": spoken[:120], "chars": len(text), **meta, "at": int(time.time() * 1000)}
        return meta

    def health(self) -> dict:
        loaded = self.rt is not None
        return {
            "ok": True,
            "state": self.state,
            "ready": self.state == "READY",
            "stateSince": round(self.state_since, 3),
            "stateError": self.state_error,
            "selftest": self.selftest_result,
            "pid": os.getpid(),
            "memory": _memory(),
            "engine": "moss-tts-nano",
            "modelId": "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX",
            "device": "cpu",
            "loaded": loaded,
            "loadSeconds": self.load_seconds,
            "loadError": self.load_error,
            "sampleRate": self.sample_rate if loaded else None,
            "reference": self.reference_meta or None,
            "queueDepth": self._pending,
            "maxQueue": self.config.max_queue,
            "generated": self.generated,
            "last": self.last,
            "config": self.config.as_dict(),
            "hardware": {"cuda": False, "deviceName": "cpu", "threads": self.config.threads},
        }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    engine: Engine = None  # type: ignore[assignment]
    server_version = "LeluMossNano/1.0"

    def log_message(self, fmt, *args):  # noqa: A003
        return

    def _authorised(self) -> bool:
        token = self.engine.config.token
        if not token:
            return True
        return self.headers.get("Authorization", "") == f"Bearer {token}" or self.headers.get("X-Voxcpm-Token", "") == token

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        path = self.path.split("?")[0].rstrip("/") or "/"
        if path in ("/health", "/metrics"):
            return self._json(200, self.engine.health())
        if path == "/v1/models":
            return self._json(200, {"object": "list", "data": [{"id": "moss-tts-nano", "object": "model", "owned_by": "openmoss"}]})
        return self._json(200, {"service": "lélu moss-tts-nano worker", "routes": ["GET /health", "POST /warmup", "POST /v1/audio/speech"]})

    def do_POST(self):  # noqa: N802
        path = self.path.split("?")[0].rstrip("/")
        if not self._authorised():
            return self._json(401, {"ok": False, "error": "missing or wrong bearer token"})
        if path == "/warmup":
            try:
                self.engine.ensure_loaded()
            except Exception as exc:
                return self._json(503, {"ok": False, "error": f"model unavailable: {exc}"})
            return self._json(200, self.engine.health())
        if path != "/v1/audio/speech":
            return self._json(404, {"ok": False, "error": f"no route {path}"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > 65_536:
                return self._json(413, {"ok": False, "error": "request body too large"})
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}") if length else {}
        except ValueError as exc:
            return self._json(400, {"ok": False, "error": f"malformed JSON: {exc}"})
        text = " ".join(str(body.get("input") or body.get("text") or "").split())
        if not text:
            return self._json(400, {"ok": False, "error": "`input` is empty"})
        if len(text) > self.engine.config.max_chars:
            return self._json(413, {"ok": False, "error": f"`input` exceeds {self.engine.config.max_chars} characters"})
        fmt = str(body.get("response_format") or "wav").lower()
        if fmt not in ("wav", "pcm"):
            return self._json(400, {"ok": False, "error": f"unsupported response_format '{fmt}'", "supported": ["wav", "pcm"]})
        stream = bool(body.get("stream")) and fmt == "pcm"
        if self.engine.state != "READY":
            return self._json(503, {"ok": False, "error": f"model unavailable: worker is {self.engine.state}"})
        if not self.engine.acquire():
            return self._json(503, {"ok": False, "error": "busy: the generation queue is full", "retryAfterSeconds": 3})
        try:
            if stream:
                self._stream(text)
            else:
                chunks: list[bytes] = []
                meta = self.engine.synthesize(text, chunks.append)
                pcm = b"".join(chunks)
                wav = _wav_header(len(pcm), self.engine.sample_rate) + pcm
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(wav)))
                self.send_header("Cache-Control", "no-store")
                self._meta_headers(meta)
                self.end_headers()
                self.wfile.write(wav)
        except Exception as exc:  # reported, never audio
            if not getattr(self, "_headers_sent", False):
                self._json(500, {"ok": False, "error": f"generation failed: {type(exc).__name__}: {exc}"})
        finally:
            self.engine.release()

    def _meta_headers(self, meta: dict) -> None:
        self.send_header("X-Lelu-Engine", "moss-tts-nano")
        self.send_header("X-Lelu-Voice", "lelu-reference")
        self.send_header("X-Lelu-Synthesis-Ms", str(meta.get("ms") or 0))
        self.send_header("X-Lelu-First-Audio-Ms", str(meta.get("firstAudioMs") or 0))
        self.send_header("X-Lelu-Audio-Seconds", str(meta.get("audioSeconds") or 0))
        if meta.get("rtf") is not None:
            self.send_header("X-Lelu-Rtf", str(meta["rtf"]))
        self.send_header("X-Lelu-Cached", "0")

    def _stream(self, text: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", f"audio/L16;rate={self.engine.sample_rate};channels=1")
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Lelu-Engine", "moss-tts-nano")
        self.end_headers()
        self._headers_sent = True

        def write(data: bytes) -> None:
            self.wfile.write(f"{len(data):X}\r\n".encode("ascii") + data + b"\r\n")
            self.wfile.flush()

        try:
            self.engine.synthesize(text, write)
        except Cancelled:
            sys.stderr.write(json.dumps({"event": "stream_cancelled", "chars": len(text)}) + "\n")
            return
        try:
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


def _wav_header(data_bytes: int, rate: int) -> bytes:
    import struct

    return b"RIFF" + struct.pack("<I", 36 + data_bytes) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16) + b"data" + struct.pack("<I", data_bytes)


def main() -> int:
    config = Config()
    parser = argparse.ArgumentParser(description="LÉLU MOSS-TTS-Nano CPU speech worker")
    parser.add_argument("--host", default=config.host)
    parser.add_argument("--port", type=int, default=config.port)
    parser.add_argument("--warmup", action="store_true", default=config.warmup)
    args = parser.parse_args()
    config.host, config.port = args.host, args.port
    engine = Engine(config)
    Handler.engine = engine
    if args.warmup:
        threading.Thread(target=lambda: _safe(engine.ensure_loaded), daemon=True).start()
    try:
        server = ThreadingHTTPServer((config.host, config.port), Handler)
    except OSError as exc:
        engine._set_state("FAILED", f"bind {config.host}:{config.port}: {exc}")
        return 98
    server.daemon_threads = True

    def graceful(signum, _frame):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, graceful)
    signal.signal(signal.SIGINT, graceful)
    sys.stderr.write(json.dumps({"event": "listening", "host": config.host, "port": config.port, "engine": "moss-tts-nano"}) + "\n")
    try:
        server.serve_forever()
    finally:
        server.server_close()
    if engine.state != "FAILED":
        engine._set_state("STOPPED")
    return 0


def _safe(fn):
    try:
        fn()
    except Exception as exc:
        sys.stderr.write(json.dumps({"event": "warm_failed", "error": str(exc)}) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
