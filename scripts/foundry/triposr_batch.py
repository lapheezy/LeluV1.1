#!/usr/bin/env python3
"""
==========================================================
TEMPORAL STUDIO — TRIPOSR BATCH WORKER (CPU, Free)

Mission 4's benchmark needs to ask the *same* engine for a whole
object and for a single body part, many times, without paying the
model-load cost on every request. This worker loads TripoSR once,
then runs a list of jobs against it and reports per-job timings.

It is deliberately the same preprocessing chain as
`triposr_to_glb.py` (rembg → resize_foreground → mid-grey
composite), because a component crop that skipped it would be
reconstructed under different conditions and the comparison would
not be like for like.

  --jobs jobs.json    [{"id","image","out","mcResolution","crop"}]
  --check             report whether the worker can run

Each result is printed as one JSON line: ok, id, out, timings,
vertices/triangles, and the mesh bounding box. Failures are printed
as JSON lines too, and the process exits non-zero only if the model
itself could not load.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback

import os
import sys as _sys

# Same shim/repo resolution the single-image worker relies on.
_here = os.path.dirname(os.path.abspath(__file__))
if _here not in _sys.path:
    _sys.path.insert(0, _here)


def emit(payload: dict) -> None:
    print(json.dumps(payload), flush=True)


def fail(stage: str, message: str, detail: str | None = None) -> None:
    payload = {"ok": False, "stage": stage, "error": message}
    if detail and detail.strip():
        payload["detail"] = detail.strip().splitlines()[-1]
    emit(payload)
    sys.exit(2)


def preflight() -> dict:
    result: dict = {"ok": True, "missing": [], "versions": {}}
    try:
        import torch

        result["versions"]["torch"] = torch.__version__
    except Exception as exc:
        result["missing"].append(f"torch ({exc.__class__.__name__})")
    for module in ("tsr", "torchmcubes", "trimesh", "omegaconf", "transformers", "PIL", "numpy"):
        try:
            imported = __import__(module)
            result["versions"][module] = str(getattr(imported, "__version__", "unknown"))
        except Exception as exc:
            result["missing"].append(f"{module} ({exc.__class__.__name__})")
    if result["missing"]:
        result["ok"] = False
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--jobs")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--model", default="stabilityai/TripoSR")
    parser.add_argument("--grid-size", type=float, default=1.0)
    parser.add_argument("--chunk-size", type=int, default=8192)
    parser.add_argument("--foreground-ratio", type=float, default=0.85)
    args = parser.parse_args()

    state = preflight()
    if args.check:
        emit(state)
        sys.exit(0 if state["ok"] else 2)
    if not state["ok"]:
        fail("preflight", f"missing dependencies: {', '.join(state['missing'])}")
    if not args.jobs:
        fail("arguments", "--jobs is required unless --check is used")

    try:
        jobs = json.loads(open(args.jobs, "r", encoding="utf-8").read())
    except Exception as exc:
        fail("jobs", f"could not read job list: {exc}")

    try:
        import numpy as np
        import torch
        from PIL import Image
        from tsr.system import TSR
        from tsr.utils import resize_foreground
        from glb_writer import write_glb
    except Exception as exc:
        fail("imports", str(exc), traceback.format_exc())

    try:
        from rembg import remove
    except Exception:
        remove = None

    load_started = time.time()
    try:
        model = TSR.from_pretrained(args.model, config_name="config.yaml", weight_name="model.ckpt")
        model.renderer.set_chunk_size(args.chunk_size)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model.to(device)
        model.eval()
    except Exception as exc:
        fail("load", f"could not load TripoSR: {exc}", traceback.format_exc())
    load_seconds = time.time() - load_started
    emit({"ok": True, "stage": "model-loaded", "device": device, "loadSeconds": round(load_seconds, 3), "jobs": len(jobs)})

    for index, job in enumerate(jobs):
        started = time.time()
        job_id = job.get("id", f"job-{index}")
        try:
            image = Image.open(job["image"])
            if job.get("crop"):
                x0, y0, x1, y1 = [int(round(v)) for v in job["crop"]]
                image = image.crop((x0, y0, x1, y1))
            if image.mode == "RGBA":
                background = Image.new("RGBA", image.size, (255, 255, 255, 0))
                image = Image.alpha_composite(background, image)
            image = image.convert("RGB")

            if remove is not None:
                # Identical chain to the single-image worker.
                rgba = remove(image)
                if rgba.mode != "RGBA":
                    rgba = rgba.convert("RGBA")
                rgba = resize_foreground(rgba, args.foreground_ratio)
                arr = np.array(rgba).astype(np.float32) / 255.0
                alpha = arr[:, :, 3:4]
                composited = arr[:, :, :3] * alpha + (1.0 - alpha) * 0.5
                image = Image.fromarray((composited * 255.0).astype(np.uint8))

            if job.get("debugImage"):
                image.save(job["debugImage"])

            infer_started = time.time()
            with torch.no_grad():
                scene_codes = model([image], device=device)
                meshes = model.extract_mesh(scene_codes, True, resolution=int(job.get("mcResolution", 96)))
            infer_seconds = time.time() - infer_started

            mesh = meshes[0]
            vertices = np.asarray(mesh.vertices, dtype=np.float64)
            faces = np.asarray(mesh.faces, dtype=np.int64)
            if vertices.size == 0 or faces.size == 0:
                raise RuntimeError("TripoSR returned an empty mesh")

            # Same normalisation as the single-image worker: recentre, then
            # scale the largest extent to the requested grid size.
            vertices = vertices - 0.5 * (vertices.max(axis=0) + vertices.min(axis=0))
            span = float(np.max(np.abs(vertices)))
            if span <= 0:
                raise RuntimeError("degenerate mesh: zero extent")
            vertices = vertices * (args.grid_size / (2.0 * span))
            stats = write_glb(job["out"], vertices, faces)

            emit(
                {
                    "ok": True,
                    "id": job_id,
                    "out": job["out"],
                    "cropped": bool(job.get("crop")),
                    "vertices": int(len(vertices)),
                    "triangles": int(len(faces)),
                    "glbBytes": stats["bytes"],
                    "bbox": [
                        [float(vertices.min(axis=0)[a]), float(vertices.max(axis=0)[a])] for a in range(3)
                    ],
                    "loadSeconds": round(load_seconds if index == 0 else 0.0, 3),
                    "inferSeconds": round(infer_seconds, 3),
                    "totalSeconds": round(time.time() - started, 3),
                }
            )
        except Exception as exc:
            emit({"ok": False, "id": job_id, "stage": "job", "error": str(exc), "detail": traceback.format_exc().splitlines()[-1] if traceback.format_exc() else None})


if __name__ == "__main__":
    main()
