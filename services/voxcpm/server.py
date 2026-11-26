#!/usr/bin/env python3
"""
==========================================================
LÉLU — VOXCPM2 SPEECH SIDECAR
==========================================================

LÉLU's own voice, synthesised by the real OpenBMB VoxCPM2 model
(`openbmb/VoxCPM2`, https://github.com/OpenBMB/VoxCPM) from the
reference recording committed in this repository:

    services/voice-reference/lelu-voice-reference.m4a  (never under public/)

WHY A SIDECAR
-------------
LÉLU is a Vite/Bun application; VoxCPM2 is PyTorch. They cannot live in
the same process, so this file is the HTTP boundary between them. It is
the ONLY place Python runs, and the browser can never reach it directly:
`plugins/voiceApi.ts` talks to it server-side, on loopback or a tunnel
protected by `VOXCPM_TOKEN`.

ONE VOICE, EVERY WORKER
-----------------------
The same file runs unchanged on a laptop CPU, on a Kaggle or Colab GPU
notebook, in a Hugging Face Space or on Lightning — the deployment
kits in `deploy/` all launch exactly this. Whatever machine answers,
the contract is identical, so `src/core/voice/voiceIdentity.ts` stays
the single definition of WHO she sounds like. A worker going to sleep
changes the invoice, never the speaker.

CONTRACT
--------
    GET  /health            → model, device, sample rate, reference, queue, timings
    GET  /metrics           → same numbers, for a poller
    GET  /v1/models         → OpenAI-shaped model list
    POST /warmup            → load the model now (blocks until ready)
    POST /v1/audio/speech   → OpenAI-compatible: {input, model, voice,
                              response_format, speed, stream}
                              → audio/wav (default) or raw PCM16 chunks

Everything the model needs is decided HERE and reported: reference audio,
cfg scale, diffusion steps, sample rate. Nothing is guessed downstream.

RESOURCE DISCIPLINE
-------------------
· the model is loaded once and kept for the life of the process
  (`VOXCPM_WARMUP=1` loads it at start, so the first reply is not the
  slowest one);
· one generation at a time (a single model instance on one device —
  concurrent calls would thrash the same weights);
· a bounded queue: past `VOXCPM_MAX_QUEUE` waiting requests the answer is
  503, never an unbounded pile of work;
· identical text is served from an in-process LRU cache, because a
  repeated sentence must not cost another generation;
· every response reports `rtf` (real-time factor) measured, not assumed.

CLI
---
    python services/voxcpm/server.py --port 8788 --warmup
    python services/voxcpm/server.py --port 8788 --token "$SECRET"
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import select
import signal
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# Her reference voice. Not under public/: everything there is copied into
# dist/ and served to any browser (it was, until 2026-11-26). The old path is
# still read if a checkout has not moved the file yet.
_REFERENCE_NEW = ROOT / "services" / "voice-reference" / "lelu-voice-reference.m4a"
_REFERENCE_OLD = ROOT / "public" / "audio" / "voice" / "lelu-voice-reference.m4a"
DEFAULT_REFERENCE = _REFERENCE_NEW if _REFERENCE_NEW.exists() or not _REFERENCE_OLD.exists() else _REFERENCE_OLD


def _memory() -> dict:
    """Current and peak RSS of this process, in GiB (Linux /proc only)."""
    out: dict = {}
    try:
        with open("/proc/self/status", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith(("VmRSS:", "VmHWM:")):
                    key, value = line.split(":", 1)
                    out["rssGiB" if key == "VmRSS" else "peakGiB"] = round(int(value.split()[0]) / 1048576, 2)
    except OSError:
        pass
    return out


def _available_gib() -> "float | None":
    """MemAvailable of the machine in GiB (Linux /proc only), or None."""
    try:
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("MemAvailable:"):
                    return round(int(line.split()[1]) / 1048576, 2)
    except OSError:
        pass
    return None


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return default if value is None or value.strip() == "" else value.strip()


def _torch_threads() -> "int | None":
    try:
        import torch

        return int(torch.get_num_threads())
    except Exception:
        return None


class Cancelled(Exception):
    """The client went away before its generation began."""


class CancelledMidGeneration(Cancelled):
    """The client went away WHILE its sentence was being generated."""

    def __init__(self, steps: int):
        super().__init__(f"client gone after {steps} generation steps")
        self.steps = steps


# Live conversation: stop a sentence nobody will hear.
#
# A barge-in aborts the page's request, but model.generate() used to run the
# sentence to its end ("client_gone_after_generation"): at RTF 9 a 119-character
# sentence held the worker for about a minute, the reply to the interruption
# queued behind it, timed out, and the page reported her voice failed (measured
# in the live run). VoxCPM2 generates in steps (`for i in tqdm(range(max_len))`
# in voxcpm/model/voxcpm2.py, ~0.5–1.5 s each here). The module's tqdm is
# wrapped so that, between two steps, the request's cancellation check runs and
# a gone client ends the generation. The model's computation is not changed.
# VOXCPM_CANCEL_MID_SENTENCE=0 turns this off.
_step_check = threading.local()


def _install_step_cancellation() -> bool:
    if _env("VOXCPM_CANCEL_MID_SENTENCE", "1") == "0":
        return False
    try:
        import voxcpm.model.voxcpm2 as v2
    except Exception:
        return False
    original = getattr(v2, "tqdm", None)
    if original is None or getattr(original, "_lelu_cancellable", False):
        return original is not None

    def cancellable(iterable, *args, **kwargs):
        check = getattr(_step_check, "fn", None)
        for step, item in enumerate(original(iterable, *args, **kwargs)):
            if check is not None and step > 0 and check():
                raise CancelledMidGeneration(step)
            yield item

    cancellable._lelu_cancellable = True  # type: ignore[attr-defined]
    v2.tqdm = cancellable
    return True


class FairTurn:
    """
    One generation at a time, in ARRIVAL order.

    `threading.Lock` is not fair: with three sentences of one reply waiting,
    the worker generated the third, then the second, and the first — the one
    the page was waiting to play — last (measured, 2026-11-26). Tickets make
    the order the order of arrival. A waiter whose client has gone gives up
    its turn instead of generating audio nobody will hear.
    """

    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._next_ticket = 0
        self._serving = 0

    def acquire(self, cancelled=None) -> None:
        with self._cond:
            ticket = self._next_ticket
            self._next_ticket += 1
            try:
                while self._serving != ticket:
                    self._cond.wait(timeout=0.25)
                    if cancelled is not None and self._serving != ticket and cancelled():
                        raise Cancelled()
            except Cancelled:
                # Give the turn away: everyone after us moves up.
                self._skip(ticket)
                raise

    def _skip(self, ticket: int) -> None:
        # Mark this ticket as done without running; called with the lock held.
        self._skipped = getattr(self, "_skipped", set())
        self._skipped.add(ticket)
        self._advance()

    def _advance(self) -> None:
        skipped = getattr(self, "_skipped", set())
        while self._serving in skipped:
            skipped.discard(self._serving)
            self._serving += 1
        self._cond.notify_all()

    def release(self) -> None:
        with self._cond:
            self._serving += 1
            self._advance()

    def turn(self, cancelled=None):
        lock = self

        class _Turn:
            def __enter__(self_inner):
                lock.acquire(cancelled)
                return self_inner

            def __exit__(self_inner, *exc):
                lock.release()
                return False

        return _Turn()

    # `with engine._generation_lock:` keeps working (self-test).
    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *exc):
        self.release()
        return False


class Config:
    """Everything the sidecar reads from the environment, in one place."""

    def __init__(self) -> None:
        self.model_id = _env("VOXCPM_MODEL_ID", "openbmb/VoxCPM2")
        self.device = _env("VOXCPM_DEVICE", "auto")
        self.host = _env("VOXCPM_HOST", "127.0.0.1")
        self.port = int(_env("VOXCPM_PORT", "8788"))
        self.reference = Path(_env("VOXCPM_REFERENCE_AUDIO", str(DEFAULT_REFERENCE)))
        # A reference clip is conditioning, not a corpus: a dozen seconds
        # carries the timbre, and a minute of it only costs prefill.
        self.reference_seconds = float(_env("VOXCPM_REFERENCE_SECONDS", "12"))
        self.cache_dir = Path(_env("VOXCPM_CACHE_DIR", str(ROOT / ".voxcpm")))
        self.cfg_value = float(_env("VOXCPM_CFG_VALUE", "2.0"))
        self.timesteps = int(_env("VOXCPM_TIMESTEPS", "10"))
        self.max_chars = int(_env("VOXCPM_MAX_CHARS", "900"))
        self.max_queue = int(_env("VOXCPM_MAX_QUEUE", "4"))
        self.cache_entries = int(_env("VOXCPM_CACHE_ENTRIES", "48"))
        self.token = _env("VOXCPM_TOKEN", "")
        self.warmup = _env("VOXCPM_WARMUP", "1") == "1"
        # torch.compile is a CUDA optimisation; on CPU it costs minutes.
        self.optimize = _env("VOXCPM_OPTIMIZE", "0") == "1"
        # Weights are fetched by bootstrap.py (disk check, resumable,
        # verified), never as a side effect of loading: a missing 5 GB
        # snapshot is reported as FAILED/weights-missing instead.
        self.allow_download = _env("VOXCPM_ALLOW_DOWNLOAD", "0") == "1"
        # Loading VoxCPM2 on CPU peaks far above its steady RSS (measured
        # 11 GiB peak, 6.6 GiB steady on 2026-11-13). Below this much free
        # memory the load is refused instead of being OOM-killed mid-way,
        # which used to take the machine's other services down with it.
        self.min_available_gib = float(_env("VOXCPM_MIN_AVAILABLE_GB", "8"))

    def as_dict(self) -> dict:
        return {
            "modelId": self.model_id,
            "device": self.device,
            "reference": str(self.reference),
            "referenceSeconds": self.reference_seconds,
            "cfgValue": self.cfg_value,
            "inferenceTimesteps": self.timesteps,
            "maxChars": self.max_chars,
            "maxQueue": self.max_queue,
            "authRequired": bool(self.token),
            "optimize": self.optimize,
            "allowDownload": self.allow_download,
            "minAvailableGb": self.min_available_gib,
        }


class Engine:
    """
    One VoxCPM2 model, one device, one generation at a time.

    Nothing here decides WHO she sounds like beyond pointing the model at
    the reference recording: the voice is the clip, and the clip is in the
    repository.
    """

    def __init__(self, config: Config) -> None:
        self.config = config
        self._model = None
        self._load_lock = threading.Lock()
        self._generation_lock = FairTurn()
        self._cache: "dict[str, bytes]" = {}
        self._cache_order: "list[str]" = []
        self._cache_lock = threading.Lock()
        self._pending = 0
        self._pending_lock = threading.Lock()
        self.load_seconds: "float | None" = None
        self.load_error: "str | None" = None
        self.generated = 0
        self.served_from_cache = 0
        self.last: "dict | None" = None
        self.reference_path: "Path | None" = None
        self.reference_meta: dict = {}
        # Lifecycle. READY is only ever set after a real generation has
        # produced non-silent audio (see `_selftest`), never on "loaded".
        self.state = "STARTING"
        self.state_since = time.time()
        self.state_error: "str | None" = None
        self.phases: dict = {}
        self.selftest_result: "dict | None" = None
        self.state_file = Path(_env("VOXCPM_STATE_FILE", "")) if _env("VOXCPM_STATE_FILE", "") else None
        self._set_state("STARTING")

    # -- lifecycle -------------------------------------------------------

    def _set_state(self, state: str, error: "str | None" = None) -> None:
        self.state = state
        self.state_since = time.time()
        self.state_error = error
        self.phases[state] = round(self.state_since, 3)
        sys.stderr.write(json.dumps({"event": "state", "state": state, "error": error, **_memory()}) + "\n")
        sys.stderr.flush()
        if self.state_file is None:
            return
        payload = {
            "state": state,
            "error": error,
            "pid": os.getpid(),
            "since": self.state_since,
            "phases": self.phases,
            "loadSeconds": self.load_seconds,
            "selftest": self.selftest_result,
            "memory": _memory(),
        }
        temporary = self.state_file.with_suffix(".tmp")
        temporary.parent.mkdir(parents=True, exist_ok=True)
        temporary.write_text(json.dumps(payload, indent=2))
        temporary.replace(self.state_file)

    def _selftest(self, model) -> dict:
        """One real generation from the reference clip. Silence is failure."""
        import numpy as np

        text = _env("VOXCPM_SELFTEST_TEXT", "Hello, I am ready.")
        started = time.time()
        with self._generation_lock:
            # Through the same path real sentences take: her reference is
            # encoded here, once, before READY — the first person to speak does
            # not wait for it — and READY proves that path speaks.
            wav = self._generate(model, text, self.config.cfg_value, self.config.timesteps)
        samples = np.asarray(wav, dtype="float32").reshape(-1)
        rate = self.sample_rate or 24000
        seconds = len(samples) / float(rate) if rate else 0.0
        rms = float(np.sqrt(np.mean(samples**2))) if len(samples) else 0.0
        result = {
            "text": text,
            "ms": int((time.time() - started) * 1000),
            "audioSeconds": round(seconds, 2),
            "rms": round(rms, 4),
            "peak": round(float(np.max(np.abs(samples))) if len(samples) else 0.0, 3),
        }
        result["ok"] = seconds >= 0.3 and rms >= 0.005
        return result

    # -- reference audio -------------------------------------------------

    def prepare_reference(self) -> Path:
        """Decode the committed m4a into the mono WAV VoxCPM2 conditions on."""
        if self.reference_path is not None:
            return self.reference_path
        source = self.config.reference
        if not source.exists():
            raise FileNotFoundError(f"reference audio not found: {source}")
        self.config.cache_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        target = self.config.cache_dir / f"reference-{digest[:12]}-{int(self.config.reference_seconds)}s.wav"
        if not target.exists():
            import imageio_ffmpeg  # ships its own ffmpeg binary

            command = [
                imageio_ffmpeg.get_ffmpeg_exe(),
                "-y",
                "-v",
                "error",
                "-i",
                str(source),
                "-t",
                f"{self.config.reference_seconds:.3f}",
                "-ac",
                "1",
                "-ar",
                "24000",
                "-c:a",
                "pcm_s16le",
                str(target),
            ]
            completed = subprocess.run(command, capture_output=True, text=True)
            if completed.returncode != 0 or not target.exists():
                raise RuntimeError(
                    "could not decode the reference recording: "
                    + (completed.stderr.strip()[-400:] or f"ffmpeg exit {completed.returncode}")
                )
        import soundfile as sf

        info = sf.info(str(target))
        self.reference_path = target
        self.reference_meta = {
            "source": str(source),
            "sha256": digest,
            "seconds": round(float(info.duration), 2),
            "sampleRate": int(info.samplerate),
            "channels": int(info.channels),
            "wav": str(target),
        }
        return target

    # -- model -----------------------------------------------------------

    def ensure_model(self):
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            try:
                from voxcpm import VoxCPM
            except Exception as exc:  # pragma: no cover - reported, not raised
                self.load_error = f"voxcpm import failed: {type(exc).__name__}: {exc}"
                raise RuntimeError(self.load_error) from exc
            available = _available_gib()
            if available is not None and available < self.config.min_available_gib:
                self.load_error = (
                    f"insufficient-memory: {available} GiB available, "
                    f"{self.config.min_available_gib} GiB required to load (VOXCPM_MIN_AVAILABLE_GB)"
                )
                self._set_state("FAILED", f"load: {self.load_error}")
                raise RuntimeError(self.load_error)
            started = time.time()
            self._set_state("LOADING")
            try:
                model = VoxCPM.from_pretrained(
                    self.config.model_id,
                    load_denoiser=False,
                    device=self.config.device,
                    optimize=self.config.optimize,
                    local_files_only=not self.config.allow_download,
                )
            except MemoryError as exc:
                self.load_error = f"out-of-memory: {exc}"
                self._set_state("FAILED", f"load: {self.load_error}")
                raise
            except Exception as exc:
                text = f"{type(exc).__name__}: {exc}"
                if not self.config.allow_download and (
                    "LocalEntryNotFound" in text or "local_files_only" in text or "offline" in text.lower()
                    or "not found" in text.lower() and "snapshot" in text.lower()
                ):
                    text = "weights-missing: run services/voxcpm/bootstrap.py to fetch them (" + text[:300] + ")"
                self.load_error = text
                self._set_state("FAILED", f"load: {self.load_error}")
                raise
            self.load_seconds = round(time.time() - started, 1)
            self.load_error = None
            self.mid_sentence_cancel = _install_step_cancellation()
            self.compiled = self._compile(model)
            # Loaded is not ready: prove the weights speak before saying so.
            self._model = model
            self._set_state("INITIALIZING")
            try:
                self.prepare_reference()
                self.selftest_result = self._selftest(model)
            except Exception as exc:
                self.selftest_result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
            if not self.selftest_result.get("ok") and self.compiled == "estimator":
                # A compile can only fail on first use. Fall back to the
                # uncompiled estimator (correct, only slower) and test again.
                decoder = model.tts_model.feat_decoder
                decoder.estimator = getattr(decoder.estimator, "_orig_mod", decoder.estimator)
                sys.stderr.write(json.dumps({"event": "compile_fallback", "selftest": self.selftest_result}) + "\n")
                self.compiled = "failed"
                try:
                    self.selftest_result = self._selftest(model)
                except Exception as exc:
                    self.selftest_result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
            if not self.selftest_result.get("ok"):
                self._model = None  # never serve weights that failed to speak
                self._set_state("FAILED", f"selftest: {self.selftest_result}")
                raise RuntimeError(f"self-test failed: {self.selftest_result}")
            self._set_state("READY")
            return self._model

    @property
    def sample_rate(self) -> "int | None":
        model = self._model
        if model is None:
            return None
        try:
            return int(model.tts_model.sample_rate)
        except Exception:
            return None

    # -- admission -------------------------------------------------------

    def acquire(self) -> bool:
        with self._pending_lock:
            if self._pending >= self.config.max_queue:
                return False
            self._pending += 1
            return True

    def release(self) -> None:
        with self._pending_lock:
            self._pending = max(0, self._pending - 1)

    @property
    def pending(self) -> int:
        with self._pending_lock:
            return self._pending

    # -- cache -----------------------------------------------------------

    def _cache_key(self, text: str, cfg_value: float, timesteps: int) -> str:
        digest = self.reference_meta.get("sha256", "")
        return hashlib.sha256(f"{text}\x00{cfg_value}\x00{timesteps}\x00{digest}".encode()).hexdigest()

    def _cache_get(self, key: str) -> "bytes | None":
        with self._cache_lock:
            audio = self._cache.get(key)
            if audio is not None:
                self._cache_order.remove(key)
                self._cache_order.append(key)
                self.served_from_cache += 1
            return audio

    def _cache_put(self, key: str, audio: bytes) -> None:
        with self._cache_lock:
            self._cache[key] = audio
            self._cache_order.append(key)
            while len(self._cache_order) > max(1, self.config.cache_entries):
                oldest = self._cache_order.pop(0)
                self._cache.pop(oldest, None)

    # -- generation ------------------------------------------------------

    def _wav_bytes(self, samples) -> bytes:
        import soundfile as sf

        buffer = io.BytesIO()
        sf.write(buffer, samples, self.sample_rate or 24000, format="WAV", subtype="PCM_16")
        return buffer.getvalue()

    def wav_for(
        self, text: str, cfg_value: "float | None" = None, timesteps: "int | None" = None, cancelled=None
    ) -> "tuple[bytes, dict]":
        """Synthesise `text` in her voice and return a complete WAV."""
        cfg_value = self.config.cfg_value if cfg_value is None else float(cfg_value)
        timesteps = self.config.timesteps if timesteps is None else int(timesteps)
        self.prepare_reference()
        key = self._cache_key(text, cfg_value, timesteps)
        cached = self._cache_get(key)
        if cached is not None:
            return cached, {"cached": True, "ms": 0, "audioSeconds": None, "rtf": None}

        model = self.ensure_model()
        with self._generation_lock.turn(cancelled):
            # Timed from our turn, not from arrival: waiting behind another
            # sentence is not synthesis, and counting it inflated the RTF the
            # page sizes its wait on (measured 18.75 for a real 7–8).
            started = time.time()
            _step_check.fn = cancelled
            try:
                wav = self._generate(model, text, cfg_value, timesteps)
            finally:
                _step_check.fn = None
        elapsed_ms = int((time.time() - started) * 1000)
        audio = self._wav_bytes(wav)
        sample_rate = self.sample_rate or 24000
        audio_seconds = round(len(wav) / float(sample_rate), 2)
        meta = {
            "cached": False,
            "ms": elapsed_ms,
            "audioSeconds": audio_seconds,
            "rtf": round(elapsed_ms / 1000.0 / audio_seconds, 2) if audio_seconds else None,
        }
        self.generated += 1
        self.last = {"text": text[:120], "chars": len(text), **meta, "at": int(time.time() * 1000)}
        self._cache_put(key, audio)
        return audio, meta

    # Her reference, encoded once. VoxCPM.generate() builds this prompt cache
    # (one pass of the 12 s reference through the audio VAE encoder) inside
    # EVERY call, i.e. for every sentence she says. The library exposes the
    # two steps separately (build_prompt_cache / _generate_with_prompt_cache,
    # the exact calls generate() makes), so the cache is built once per
    # reference file and reused. VOXCPM_REUSE_REFERENCE=0 restores the
    # per-call path. Measured cost of one encode: `referenceEncodeMs` in /health.
    _prompt_cache = None
    _prompt_cache_for = None
    reference_encode_ms = None

    compiled = "off"

    def _compile(self, model) -> str:
        """
        Compile the diffusion estimator for this CPU (live conversation).

        The estimator runs `inference_timesteps` times per generation step and
        is ~55 % of a sentence's time; VoxCPM compiles only on CUDA. Inductor's
        CPU backend took it from 31 to 24 ms per call (RTF 3.1 -> 2.7 on 4
        cores, services/voxcpm/bench_step.py). Same weights, same arithmetic.
        Compiling the language-model steps instead recompiled every step (RTF
        11.8) and is not offered. The compile itself happens in the self-test,
        before READY. VOXCPM_COMPILE=off disables it; a machine without a C++
        compiler falls back to the uncompiled model and /health says so.
        """
        mode = _env("VOXCPM_COMPILE", "estimator").lower()
        if mode in ("off", "0", "none", "false"):
            return "off"
        try:
            import torch

            decoder = model.tts_model.feat_decoder
            decoder.estimator = torch.compile(decoder.estimator, dynamic=False)
            return "estimator"
        except Exception as exc:  # never fatal: the uncompiled model is correct, only slower
            sys.stderr.write(json.dumps({"event": "compile_skipped", "error": f"{type(exc).__name__}: {exc}"[:300]}) + "\n")
            return "failed"

    def _reference_cache(self, model):
        ref = str(self.reference_path)
        if self._prompt_cache is None or self._prompt_cache_for != ref:
            started = time.time()
            self._prompt_cache = model.tts_model.build_prompt_cache(reference_wav_path=ref)
            self.reference_encode_ms = int((time.time() - started) * 1000)
            self._prompt_cache_for = ref
            sys.stderr.write(json.dumps({"event": "reference_cached", "encodeMs": self.reference_encode_ms}) + "\n")
        return self._prompt_cache

    def _generate(self, model, text: str, cfg_value: float, timesteps: int, streaming: bool = False):
        """One generation in her voice; a list-free generator when streaming."""
        import re as _re

        reuse = _env("VOXCPM_REUSE_REFERENCE", "1") != "0" and hasattr(getattr(model, "tts_model", None), "build_prompt_cache")
        if not reuse:
            call = model.generate_streaming if streaming else model.generate
            return call(text=text, reference_wav_path=str(self.reference_path), cfg_value=cfg_value, inference_timesteps=timesteps)
        cache = self._reference_cache(model)
        # The same normalisation and arguments VoxCPM._generate uses.
        clean = _re.sub(r"\s+", " ", text.replace("\n", " "))
        result = model.tts_model._generate_with_prompt_cache(
            target_text=clean,
            prompt_cache=cache,
            min_len=2,
            max_len=4096,
            inference_timesteps=timesteps,
            cfg_value=cfg_value,
            retry_badcase=True,
            retry_badcase_max_times=3,
            retry_badcase_ratio_threshold=6.0,
            streaming=streaming,
        )
        if streaming:
            def chunks():
                try:
                    for wav, _, _ in result:
                        yield wav.squeeze(0).cpu().numpy()
                finally:
                    result.close()
            return chunks()
        try:
            wav, _, _ = next(result)
        finally:
            result.close()
        return wav.squeeze(0).cpu().numpy()

    def stream_for(self, text: str, cfg_value: "float | None" = None, timesteps: "int | None" = None, cancelled=None):
        """Yield raw PCM16 chunks as the model produces them."""
        import numpy as np

        cfg_value = self.config.cfg_value if cfg_value is None else float(cfg_value)
        timesteps = self.config.timesteps if timesteps is None else int(timesteps)
        self.prepare_reference()
        model = self.ensure_model()
        produced = 0
        with self._generation_lock.turn(cancelled):
            started = time.time()
            for chunk in self._generate(model, text, cfg_value, timesteps, streaming=True):
                if chunk is None or len(chunk) == 0:
                    continue
                produced += len(chunk)
                yield (np.clip(np.asarray(chunk, dtype="float32"), -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
        sample_rate = self.sample_rate or 24000
        elapsed_ms = int((time.time() - started) * 1000)
        audio_seconds = round(produced / float(sample_rate), 2)
        self.generated += 1
        self.last = {
            "text": text[:120],
            "chars": len(text),
            "cached": False,
            "streamed": True,
            "ms": elapsed_ms,
            "audioSeconds": audio_seconds,
            "rtf": round(elapsed_ms / 1000.0 / audio_seconds, 2) if audio_seconds else None,
            "at": int(time.time() * 1000),
        }

    # -- reporting -------------------------------------------------------

    def health(self) -> dict:
        loaded = self._model is not None
        payload = {
            "ok": True,
            "state": self.state,
            "ready": self.state == "READY",
            "stateSince": round(self.state_since, 3),
            "stateError": self.state_error,
            "selftest": self.selftest_result,
            "pid": os.getpid(),
            "memory": {**_memory(), "availableGiB": _available_gib()},
            "engine": "voxcpm2",
            "modelId": self.config.model_id,
            "device": self.config.device,
            "loaded": loaded,
            "loadSeconds": self.load_seconds,
            "loadError": self.load_error,
            "referenceReused": _env("VOXCPM_REUSE_REFERENCE", "1") != "0",
            "referenceEncodeMs": self.reference_encode_ms,
            "cancelMidSentence": bool(getattr(self, "mid_sentence_cancel", False)),
            "compiled": self.compiled,
            "threads": _torch_threads(),
            "sampleRate": self.sample_rate,
            "reference": self.reference_meta or None,
            "queueDepth": self.pending,
            "maxQueue": self.config.max_queue,
            "cacheEntries": len(self._cache),
            "generated": self.generated,
            "servedFromCache": self.served_from_cache,
            "last": self.last,
            "config": self.config.as_dict(),
        }
        if loaded:
            try:
                import torch

                payload["hardware"] = {
                    "torch": torch.__version__,
                    "cuda": bool(torch.cuda.is_available()),
                    "deviceName": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
                    "vramTotalGb": round(torch.cuda.get_device_properties(0).total_memory / 1e9, 2) if torch.cuda.is_available() else None,
                    "threads": torch.get_num_threads(),
                }
            except Exception:
                payload["hardware"] = None
        return payload


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    engine: Engine = None  # type: ignore[assignment]
    server_version = "LeluVoxCPM/1.0"

    # -- plumbing --------------------------------------------------------

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003 - stdlib name
        return

    def _authorised(self) -> bool:
        token = self.engine.config.token
        if not token:
            return True
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {token}" or self.headers.get("X-Voxcpm-Token", "") == token

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > 65_536:
            raise ValueError("request body too large")
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            raise ValueError(f"malformed JSON: {exc.msg}") from exc
        if not isinstance(parsed, dict):
            raise ValueError("body must be a JSON object")
        return parsed

    # -- GET -------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802 - stdlib name
        path = self.path.split("?")[0].rstrip("/") or "/"
        if path in ("/health", "/metrics"):
            self._json(200, self.engine.health())
            return
        if path == "/v1/models":
            self._json(
                200,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": "voxcpm2",
                            "object": "model",
                            "owned_by": "openbmb",
                            "metadata": {"engine": "VoxCPM2", "voice": "Lélu reference clip"},
                        }
                    ],
                },
            )
            return
        self._json(
            200,
            {
                "service": "lélu voxcpm2 sidecar",
                "routes": ["GET /health", "GET /v1/models", "POST /warmup", "POST /v1/audio/speech"],
                "config": self.engine.config.as_dict(),
            },
        )

    # -- POST ------------------------------------------------------------

    def do_POST(self) -> None:  # noqa: N802 - stdlib name
        path = self.path.split("?")[0].rstrip("/")
        if not self._authorised():
            self._json(401, {"ok": False, "error": "missing or wrong bearer token"})
            return
        if path == "/warmup":
            try:
                self.engine.ensure_model()
            except Exception as exc:
                self._json(503, {"ok": False, "error": f"model unavailable: {exc}"})
                return
            self._json(200, self.engine.health())
            return
        if path == "/v1/audio/speech":
            self._speech()
            return
        self._json(404, {"ok": False, "error": f"no route {path}"})

    def _client_gone(self) -> bool:
        """True once the client has closed its connection (STOP, timeout)."""
        try:
            readable, _, _ = select.select([self.connection], [], [], 0)
            if readable:
                return self.connection.recv(1, socket.MSG_PEEK) == b""
        except OSError:
            return True
        return False

    def _speech(self) -> None:
        try:
            body = self._body()
        except ValueError as exc:
            self._json(400, {"ok": False, "error": str(exc)})
            return

        text = str(body.get("input") or body.get("text") or "").strip()
        text = " ".join(text.split())
        if not text:
            self._json(400, {"ok": False, "error": "`input` is empty: there is nothing to say"})
            return
        if len(text) > self.engine.config.max_chars:
            self._json(
                413,
                {
                    "ok": False,
                    "error": f"`input` exceeds {self.engine.config.max_chars} characters",
                    "length": len(text),
                },
            )
            return

        response_format = str(body.get("response_format") or "wav").lower()
        if response_format not in ("wav", "pcm"):
            self._json(
                400,
                {
                    "ok": False,
                    "error": f"unsupported response_format '{response_format}'",
                    "supported": ["wav", "pcm"],
                    "note": "VoxCPM2 emits 16-bit PCM/WAV; mp3 needs a separate encoder and is refused rather than faked.",
                },
            )
            return
        stream = bool(body.get("stream")) and response_format == "pcm"
        cfg_value = body.get("cfg_value")
        timesteps = body.get("inference_timesteps")

        if not self.engine.acquire():
            self._json(
                503,
                {
                    "ok": False,
                    "error": "busy: the generation queue is full",
                    "queueDepth": self.engine.pending,
                    "maxQueue": self.engine.config.max_queue,
                    "retryAfterSeconds": 5,
                },
            )
            return

        try:
            if stream:
                self._speech_stream(text, cfg_value, timesteps)
                return
            audio, meta = self.engine.wav_for(text, cfg_value, timesteps, cancelled=self._client_gone)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Lelu-Engine", "voxcpm2")
            self.send_header("X-Lelu-Voice", "lelu-reference")
            self.send_header("X-Lelu-Synthesis-Ms", str(meta.get("ms") or 0))
            if meta.get("audioSeconds"):
                self.send_header("X-Lelu-Audio-Seconds", str(meta["audioSeconds"]))
            if meta.get("rtf") is not None:
                self.send_header("X-Lelu-Rtf", str(meta["rtf"]))
            self.send_header("X-Lelu-Cached", "1" if meta.get("cached") else "0")
            self.end_headers()
            self.wfile.write(audio)
        except CancelledMidGeneration as exc:
            sys.stderr.write(json.dumps({"event": "cancelled_mid_generation", "chars": len(text), "steps": exc.steps}) + "\n")
        except Cancelled:
            sys.stderr.write(json.dumps({"event": "cancelled_before_start", "chars": len(text)}) + "\n")
        except (BrokenPipeError, ConnectionResetError):
            sys.stderr.write(json.dumps({"event": "client_gone_after_generation", "chars": len(text)}) + "\n")
        except FileNotFoundError as exc:
            self._json(503, {"ok": False, "error": str(exc)})
        except RuntimeError as exc:
            self._json(503, {"ok": False, "error": f"model unavailable: {exc}"})
        except Exception as exc:  # generation failure is reported, never audio
            self._json(500, {"ok": False, "error": f"generation failed: {type(exc).__name__}: {exc}"})
        finally:
            self.engine.release()

    def _speech_stream(self, text: str, cfg_value, timesteps) -> None:
        # The sample rate is a property of the loaded model, so it is known
        # before the first byte and can be sent as a header.
        try:
            self.engine.ensure_model()
        except Exception as exc:
            self._json(503, {"ok": False, "error": f"model unavailable: {exc}"})
            return
        sample_rate = self.engine.sample_rate or 24000
        self.send_response(200)
        self.send_header("Content-Type", f"audio/L16;rate={sample_rate};channels=1")
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Audio-Format", "pcm_s16le")
        self.send_header("X-Sample-Rate", str(sample_rate))
        self.send_header("X-Lelu-Engine", "voxcpm2")
        self.end_headers()
        cancelled = False
        try:
            for chunk in self.engine.stream_for(text, cfg_value, timesteps, cancelled=self._client_gone):
                self.wfile.write(f"{len(chunk):X}\r\n".encode("ascii"))
                self.wfile.write(chunk)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
        except Cancelled:
            cancelled = True
            sys.stderr.write(json.dumps({"event": "cancelled_before_start", "chars": len(text)}) + "\n")
        except (BrokenPipeError, ConnectionResetError):
            # The client closed (STOP / barge-in). Leaving the loop closes the
            # generator, which ends the generation: that is the cancellation.
            cancelled = True
            sys.stderr.write(json.dumps({"event": "stream_cancelled", "chars": len(text)}) + "\n")
        except Exception as exc:
            sys.stderr.write(json.dumps({"event": "stream_error", "error": str(exc)}) + "\n")
        finally:
            if not cancelled:
                try:
                    self.wfile.write(b"0\r\n\r\n")
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass


def main() -> int:
    config = Config()
    parser = argparse.ArgumentParser(description="Lélu VoxCPM2 speech sidecar")
    parser.add_argument("--host", default=config.host)
    parser.add_argument("--port", type=int, default=config.port)
    parser.add_argument("--token", default=config.token)
    parser.add_argument("--device", default=config.device)
    parser.add_argument("--reference", default=str(config.reference))
    parser.add_argument("--warmup", action="store_true", default=config.warmup)
    parser.add_argument("--no-warmup", dest="warmup", action="store_false")
    args = parser.parse_args()

    config.host = args.host
    config.port = args.port
    config.token = args.token
    config.device = args.device
    config.reference = Path(args.reference)

    engine = Engine(config)
    Handler.engine = engine

    if args.warmup:
        def warm() -> None:
            try:
                engine.prepare_reference()
                engine.ensure_model()
                sys.stderr.write(
                    json.dumps(
                        {
                            "event": "warm",
                            "model": config.model_id,
                            "device": config.device,
                            "loadSeconds": engine.load_seconds,
                            "sampleRate": engine.sample_rate,
                        }
                    )
                    + "\n"
                )
            except Exception as exc:
                sys.stderr.write(json.dumps({"event": "warm_failed", "error": str(exc)}) + "\n")

        threading.Thread(target=warm, daemon=True).start()

    try:
        server = ThreadingHTTPServer((config.host, config.port), Handler)
    except OSError as exc:
        engine._set_state("FAILED", f"bind {config.host}:{config.port}: {exc}")
        return 98  # EADDRINUSE-style exit so the supervisor can classify it
    server.daemon_threads = True

    def _graceful(signum, _frame) -> None:
        sys.stderr.write(json.dumps({"event": "signal", "signal": signum}) + "\n")
        # shutdown() blocks until serve_forever returns, so not on this thread.
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, _graceful)
    signal.signal(signal.SIGINT, _graceful)
    sys.stderr.write(
        json.dumps(
            {
                "event": "listening",
                "host": config.host,
                "port": config.port,
                "model": config.model_id,
                "device": config.device,
                "authRequired": bool(config.token),
            }
        )
        + "\n"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    if engine.state != "FAILED":
        engine._set_state("STOPPED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
