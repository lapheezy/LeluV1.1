"""Zero-cost cloud reconstruction driver for the LÉLU Foundry.

Runs reconstruction on free hosted GPU infrastructure (Hugging Face ZeroGPU
Spaces) and immediately copies every artefact into the persistent LÉLU asset
tree. Nothing here costs money: the Spaces are free community/ZeroGPU
deployments, and the only credential is an optional free Hugging Face token
(read from HF_TOKEN, never written to disk).

    export HF_TOKEN=...            # optional; needed for ZeroGPU quota
    python cloud_recon.py pshuman  <image> [outdir]
    python cloud_recon.py trellis  <image> [outdir]

Each run appends to foundry/cloud/runs.jsonl: space, endpoint, input sha256,
timestamps, wall clock, GPU wait, success/error text, and every output file
with its sha256. If the only copy of a mesh lived in a Space, this log plus the
copied files are what makes that recoverable.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.abspath(os.path.join(HERE, "..", "..", "leluverse", "assets",
                                    "characters", "lelu_character", "foundry"))
CLOUD = os.path.join(BASE, "cloud")
RUNS = os.path.join(CLOUD, "runs.jsonl")

SPACES = {
    "pshuman": "fffiloni/PSHuman",
    "trellis": "microsoft/TRELLIS.2",
}


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def log(entry: dict) -> None:
    os.makedirs(CLOUD, exist_ok=True)
    with open(RUNS, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, indent=None) + "\n")


def copy_outputs(paths, outdir: str) -> list[dict]:
    os.makedirs(outdir, exist_ok=True)
    saved = []
    for p in paths:
        if not p:
            continue
        try:
            src = str(p)
            if not os.path.exists(src):
                continue
            dst = os.path.join(outdir, os.path.basename(src))
            shutil.copy2(src, dst)
            saved.append({"file": os.path.relpath(dst, BASE), "bytes": os.path.getsize(dst),
                          "sha256": sha256(dst)})
        except Exception:
            saved.append({"file": str(p), "note": "could not copy", "error": traceback.format_exc(limit=1)})
    return saved


def unflip_for_space(image: str, outdir: str) -> tuple[str, bool]:
    """PSHuman's Space mirrors its input (`image.transpose(FLIP_LEFT_RIGHT)` at
    app.py:56), so a mirrored copy is sent: the Space's flip then restores the
    photograph's true orientation. Asymmetries (thigh tattoo, hair sweep,
    single-shoulder straps) stay on the correct side."""
    from PIL import Image
    os.makedirs(outdir, exist_ok=True)
    dst = os.path.join(outdir, "input_preflipped.png")
    Image.open(image).transpose(Image.FLIP_LEFT_RIGHT).save(dst)
    return dst, True


def run_pshuman(image: str, outdir: str, token: str | None, preflip: bool = True):
    from gradio_client import Client, handle_file

    sent, flipped = (unflip_for_space(image, outdir) if preflip else (image, False))
    client = Client(SPACES["pshuman"], token=token, verbose=False)
    started = time.time()
    result = client.predict(handle_file(sent), False, api_name="/process_image")
    elapsed = time.time() - started
    paths = list(result) if isinstance(result, (list, tuple)) else [result]
    saved = copy_outputs(paths, outdir)
    return {"elapsed_s": round(elapsed, 1), "input_sent": sent,
            "input_preflipped_for_space_flip": flipped,
            "raw_result": [str(p) for p in paths], "saved": saved}


def run_trellis(image: str, outdir: str, token: str | None):
    from gradio_client import Client, handle_file

    client = Client(SPACES["trellis"], token=token, verbose=False)
    started = time.time()
    client.predict(api_name="/start_session")
    result = client.predict(handle_file(image), 0, "1024",
                            7.5, 0.7, 12, 5.0,
                            7.5, 0.5, 12, 3.0,
                            1.0, 0.0, 12, 3.0,
                            api_name="/image_to_3d")
    glb = client.predict(300000, 2048, api_name="/extract_glb")
    elapsed = time.time() - started
    paths = [result, glb] if not isinstance(result, (list, tuple)) else list(result) + [glb]
    saved = copy_outputs(paths, outdir)
    return {"elapsed_s": round(elapsed, 1), "input_sent": sent,
            "input_preflipped_for_space_flip": flipped,
            "raw_result": [str(p) for p in paths], "saved": saved}


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    route, image = sys.argv[1], os.path.abspath(sys.argv[2])
    outdir = os.path.abspath(sys.argv[3]) if len(sys.argv) > 3 else os.path.join(
        CLOUD, f"{route}_{time.strftime('%Y%m%dT%H%M%S')}")
    token = os.environ.get("HF_TOKEN") or None
    entry = {"route": route, "space": SPACES.get(route), "image": image,
             "image_sha256": sha256(image), "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
             "token_present": bool(token), "outdir": outdir}
    try:
        fn = {"pshuman": run_pshuman, "trellis": run_trellis}.get(route)
        if fn is None:
            raise SystemExit(f"unknown route {route}; use pshuman or trellis")
        entry.update(fn(image, outdir, token))
        entry["status"] = "ok" if entry.get("saved") else "empty-result"
    except BaseException as exc:                      # noqa: BLE001 - reported verbatim
        entry["status"] = "error"
        entry["error_type"] = type(exc).__name__
        entry["error"] = str(exc)[:4000]
        entry["traceback"] = traceback.format_exc()[-4000:]
        print("[cloud] FAILED:", type(exc).__name__, str(exc)[:1500])
    finally:
        entry["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        log(entry)
    print(json.dumps({k: v for k, v in entry.items() if k not in ("traceback", "raw_result")}, indent=2))
    return 0 if entry.get("status") == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
