#!/usr/bin/env python3
"""
==========================================================
LÉLU — VOXCPM2 INFERENCE SERVER
==========================================================

A small, local server around the OFFICIAL OpenBMB VoxCPM
implementation (`pip install voxcpm`, model `openbmb/VoxCPM2`,
Apache-2.0). It exposes the OpenAI-compatible TTS shape the
LÉLU route already speaks, plus the reference-conditioning
fields that make her cloned voice possible.

    LÉLU /api/voice/voxcpm/tts  ->  POST /v1/audio/speech

WHY NOT vLLM-OMNI
-----------------
vLLM-Omni is OpenBMB's recommended path for concurrent,
multi-tenant GPU serving, and its `/v1/audio/speech` endpoint is
OpenAI-compatible for plain synthesis. Its documented HTTP examples
do not publish the reference-audio field names for cloning, and
guessing a field name would produce plausible-looking silence. This
server therefore uses the documented Python API
(`model.generate(... prompt_wav_path, prompt_text, reference_wav_path)`)
and publishes an explicit contract instead. Point VOXCPM_BASE_URL at
either one; switch here if you need batching.

CONTRACT
--------
GET  /health
POST /v1/audio/speech
  { "model": "openbmb/VoxCPM2", "input": "Text to speak.",
    "voice": "default", "response_format": "wav",
    "prompt_audio": "<base64 wav>", "prompt_text": "<exact transcript>",
    "reference_audio": "<base64 wav>", "reference_text": "<transcript>",
    "cfg_value": 2.0, "inference_timesteps": 10, "seed": 42,
    "normalize": true }
  -> audio/wav (48 kHz mono), or JSON with an error status.

The reference clip is required. `prompt_audio` + `prompt_text` drive
continuation-style cloning; passing the same clip as `reference_audio`
enables VoxCPM2's "ultimate cloning", which is the highest-fidelity
mode. Supplying only `reference_audio` still clones, with lower
similarity.

This server never substitutes a stock voice when a reference is
missing: it returns an error.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_ID = os.environ.get("VOXCPM_MODEL", "openbmb/VoxCPM2")
HOST = os.environ.get("VOXCPM_HOST", "127.0.0.1")
PORT = int(os.environ.get("VOXCPM_PORT", "8000"))
DEFAULT_CFG = float(os.environ.get("VOXCPM_CFG", "2.0"))
DEFAULT_STEPS = int(os.environ.get("VOXCPM_STEPS", "10"))
DEFAULT_SEED = int(os.environ.get("VOXCPM_SEED", "42"))
MAX_INPUT_CHARS = 1200

# Consent gate, defence in depth: the LÉLU route already refuses to call
# this server without an attestation. The server refuses too, so pointing
# a client straight at it cannot bypass the gate.
CONSENT_ATTESTED = os.environ.get("LELU_VOICE_CONSENT_ATTESTED", "").strip().lower() == "true"

_model = None
_model_error: str | None = None
_model_lock = threading.Lock()

_audio_dir = tempfile.mkdtemp(prefix="lelu-voxcpm-ref-")
_written: dict[str, str] = {}


def log(message: str) -> None:
    print(f"[lelu-voxcpm] {message}", flush=True)


def load_model():
    """Load once, on first request, so /health answers while weights download."""
    global _model, _model_error
    with _model_lock:
        if _model is not None:
            return _model
        if _model_error is not None:
            raise RuntimeError(_model_error)
        try:
            from voxcpm import VoxCPM  # official package

            log(f"loading {MODEL_ID} (this is the slow part)")
            _model = VoxCPM.from_pretrained(MODEL_ID, load_denoiser=False)
            log(f"model ready; sample rate {sample_rate(_model)} Hz")
            return _model
        except Exception as error:  # noqa: BLE001 - reported to the caller verbatim
            _model_error = f"{type(error).__name__}: {error}"
            log(f"model load failed: {_model_error}")
            raise


def sample_rate(model) -> int:
    """VoxCPM2 emits 48 kHz; read it from the model rather than assume it."""
    for path in ("tts_model", "model"):
        target = getattr(model, path, None)
        rate = getattr(target, "sample_rate", None)
        if isinstance(rate, int) and rate > 0:
            return rate
    rate = getattr(model, "sample_rate", None)
    return rate if isinstance(rate, int) and rate > 0 else 48_000


def materialise(base64_audio: str, label: str) -> str:
    """Decode a reference clip to a cached file. Same bytes -> same path."""
    raw = base64.b64decode(base64_audio, validate=True)
    if len(raw) < 512:
        raise ValueError(f"{label} is too small to be audio ({len(raw)} bytes).")
    digest = hashlib.sha256(raw).hexdigest()[:32]
    path = _written.get(digest)
    if path and os.path.exists(path):
        return path
    path = os.path.join(_audio_dir, f"{label}-{digest}.wav")
    with open(path, "wb") as handle:
        handle.write(raw)
    _written[digest] = path
    return path


def synthesise(payload: dict) -> bytes:
    import soundfile as sf  # dependency of voxcpm

    text = str(payload.get("input") or "").strip()
    if not text:
        raise ValueError("No text to speak.")
    if len(text) > MAX_INPUT_CHARS:
        raise ValueError(f"Text exceeds {MAX_INPUT_CHARS} characters.")

    reference_b64 = payload.get("reference_audio") or ""
    prompt_b64 = payload.get("prompt_audio") or reference_b64
    if not reference_b64 and not prompt_b64:
        raise ValueError("A reference clip is required; refusing to use a stock voice.")

    reference_path = materialise(reference_b64, "reference") if reference_b64 else None
    prompt_path = materialise(prompt_b64, "prompt") if prompt_b64 else None
    prompt_text = str(payload.get("prompt_text") or payload.get("reference_text") or "").strip() or None

    model = load_model()
    kwargs = {
        "text": text,
        "cfg_value": float(payload.get("cfg_value", DEFAULT_CFG)),
        "inference_timesteps": int(payload.get("inference_timesteps", DEFAULT_STEPS)),
        "seed": int(payload.get("seed", DEFAULT_SEED)),
        "normalize": bool(payload.get("normalize", True)),
    }
    if prompt_path is not None:
        kwargs["prompt_wav_path"] = prompt_path
        if prompt_text:
            kwargs["prompt_text"] = prompt_text
    if reference_path is not None:
        kwargs["reference_wav_path"] = reference_path

    wav = model.generate(**kwargs)
    buffer = io.BytesIO()
    sf.write(buffer, wav, sample_rate(model), format="WAV", subtype="PCM_16")
    return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # quieter default logging
        log(fmt % args)

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        if not self.path.startswith("/health"):
            self._json(404, {"error": "unknown route"})
            return
        self._json(
            200,
            {
                "status": "ok",
                "model": MODEL_ID,
                "loaded": _model is not None,
                "loadError": _model_error,
                "consentAttested": CONSENT_ATTESTED,
                "sampleRate": sample_rate(_model) if _model is not None else None,
                "referenceConditioned": True,
            },
        )

    def do_POST(self) -> None:  # noqa: N802 - stdlib naming
        if not self.path.startswith("/v1/audio/speech"):
            self._json(404, {"error": "unknown route"})
            return
        if not CONSENT_ATTESTED:
            self._json(
                403,
                {
                    "error": "Voice cloning is gated: LELU_VOICE_CONSENT_ATTESTED is not \"true\".",
                },
            )
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 48_000_000:
            self._json(413, {"error": "request body missing or too large"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:  # noqa: BLE001
            self._json(400, {"error": "malformed JSON body"})
            return
        try:
            audio = synthesise(payload)
        except ValueError as error:
            self._json(400, {"error": str(error)})
            return
        except Exception as error:  # noqa: BLE001 - surfaced, never silent
            self._json(502, {"error": f"{type(error).__name__}: {error}"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)


def main() -> int:
    if not CONSENT_ATTESTED:
        log(
            "REFUSING TO START: LELU_VOICE_CONSENT_ATTESTED is not \"true\".\n"
            "  Set it only when the reference recording is your own voice or you\n"
            "  hold the speaker's explicit authorisation to clone it."
        )
        return 2
    log(f"serving {MODEL_ID} on http://{HOST}:{PORT} (reference-conditioned)")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("stopping")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
