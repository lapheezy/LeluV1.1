#!/usr/bin/env python3
"""
==========================================================
TEMPORAL STUDIO — TRIPOSR → GLB WORKER (CPU, Free)

The only image-to-3D worker the NRE pipeline knows how to call
that needs no account, no token and no payment: TripoSR
(MIT code, MIT weights, CPU path documented upstream).

This script does exactly one job and reports what it did:

  image bytes -> TripoSR forward pass -> marching-cubes mesh
              -> normalised, recentred GLB + JSON summary on stdout

It never invents success. If Torch, the `tsr` package, torchmcubes
or the checkpoint are missing, it exits non-zero with a JSON error
naming the missing piece, which is what the pipeline's preflight
records as the blocker.

  --check          report whether the worker can run, without running
  --image PATH     input image
  --out PATH       output .glb
  --mc-resolution  marching cubes resolution (256 default; 128 for CPU speed)
  --grid-size      side length of the normalised unit box, in metres

Run with the interpreter that has torch installed, e.g.
  /tmp/triposr-venv/bin/python scripts/foundry/triposr_to_glb.py --check
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback


def fail(stage: str, message: str, detail: str | None = None) -> None:
    payload = {"ok": False, "stage": stage, "error": message}
    if detail:
        payload["detail"] = detail.strip().splitlines()[-1] if detail.strip() else None
    print(json.dumps(payload))
    sys.exit(2)


def preflight() -> dict:
    """Import-level check. Anything missing is reported, not guessed at."""
    result: dict = {"ok": True, "missing": [], "versions": {}}
    try:
        import torch  # noqa: F401

        result["versions"]["torch"] = torch.__version__
    except Exception as exc:  # pragma: no cover - environment dependent
        result["missing"].append(f"torch ({exc.__class__.__name__})")

    for module in ("tsr", "torchmcubes", "trimesh", "omegaconf", "transformers", "PIL", "numpy"):
        try:
            imported = __import__(module)
            version = getattr(imported, "__version__", "unknown")
            result["versions"][module] = str(version)
        except Exception as exc:
            result["missing"].append(f"{module} ({exc.__class__.__name__})")

    if result["missing"]:
        result["ok"] = False
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--image")
    parser.add_argument("--out")
    parser.add_argument("--mc-resolution", type=int, default=256)
    parser.add_argument("--grid-size", type=float, default=1.0)
    parser.add_argument("--chunk-size", type=int, default=8192)
    parser.add_argument("--no-remove-bg", action="store_true")
    parser.add_argument("--foreground-ratio", type=float, default=0.85)
    parser.add_argument("--debug-image", default=None)
    parser.add_argument("--model", default="stabilityai/TripoSR")
    # Inference is the expensive step; caching the raw mesh lets the export be
    # re-run and audited without paying for it again.
    parser.add_argument("--mesh-cache", default="/tmp/triposr_mesh.npz")
    parser.add_argument("--reuse-mesh", action="store_true")
    args = parser.parse_args()

    state = preflight()
    if args.check:
        print(json.dumps(state))
        sys.exit(0 if state["ok"] else 2)
    if not state["ok"]:
        fail("preflight", f"missing dependencies: {', '.join(state['missing'])}")
    if not args.image or not args.out:
        fail("arguments", "--image and --out are required unless --check is used")

    started = time.time()

    try:
        import numpy as np
        import torch
        from PIL import Image

        from glb_writer import write_glb
        from tsr.system import TSR
    except Exception as exc:
        fail("imports", str(exc), traceback.format_exc())

    try:
        image = Image.open(args.image)
        if image.mode == "RGBA":
            background = Image.new("RGBA", image.size, (255, 255, 255, 0))
            image = Image.alpha_composite(background, image)
        image = image.convert("RGB")
    except Exception as exc:
        fail("image", f"could not read image: {exc}")

    if not args.no_remove_bg:
        try:
            from rembg import remove
            from tsr.utils import resize_foreground

            # Follow upstream run.py exactly. TripoSR conditions on a
            # square image whose subject fills `foreground_ratio` of the
            # frame and sits on mid-grey; handing it the raw photograph
            # (dark studio backdrop, subject in the middle) makes it model
            # the backdrop as part of the object.
            rgba = remove(image)
            if rgba.mode != "RGBA":
                rgba = rgba.convert("RGBA")
            rgba = resize_foreground(rgba, args.foreground_ratio)
            arr = np.array(rgba).astype(np.float32) / 255.0
            alpha = arr[:, :, 3:4]
            composited = arr[:, :, :3] * alpha + (1.0 - alpha) * 0.5
            image = Image.fromarray((composited * 255.0).astype(np.uint8))
        except Exception as exc:
            # Background removal is optional: without it the mesh loses the
            # subject/background boundary, which is reported, not hidden.
            print(json.dumps({"warning": f"rembg unavailable, using the raw image: {exc}"}), file=sys.stderr)

    # What the model actually sees, for auditing the preprocessing chain.
    if args.debug_image:
        try:
            image.save(args.debug_image)
        except Exception as exc:
            print(json.dumps({"warning": f"could not save debug image: {exc}"}), file=sys.stderr)

    load_seconds = 0.0
    infer_seconds = 0.0
    cached = False
    vertices = faces = None

    if args.reuse_mesh:
        try:
            stored = np.load(args.mesh_cache)
            vertices = np.asarray(stored["vertices"], dtype=np.float64)
            faces = np.asarray(stored["faces"], dtype=np.int64)
            cached = True
        except Exception as exc:
            fail("cache", f"could not reuse mesh cache {args.mesh_cache}: {exc}")

    if not cached:
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

        infer_started = time.time()
        try:
            with torch.no_grad():
                scene_codes = model([image], device=device)
                meshes = model.extract_mesh(scene_codes, True, resolution=args.mc_resolution)
        except Exception as exc:
            fail("infer", f"reconstruction failed: {exc}", traceback.format_exc())
        infer_seconds = time.time() - infer_started

        mesh = meshes[0]
        vertices = np.asarray(mesh.vertices, dtype=np.float64)
        faces = np.asarray(mesh.faces, dtype=np.int64)
        try:
            np.savez(args.mesh_cache, vertices=vertices, faces=faces)
        except Exception:
            pass

    try:
        if vertices.size == 0 or faces.size == 0:
            fail("mesh", "TripoSR returned an empty mesh")
        vertices = vertices - 0.5 * (vertices.max(axis=0) + vertices.min(axis=0))
        scale = args.grid_size / (2.0 * float(np.max(np.abs(vertices))))
        vertices = vertices * scale
        export_stats = write_glb(args.out, vertices, faces)
    except Exception as exc:
        fail("export", f"could not export GLB: {exc}", traceback.format_exc())

    print(
        json.dumps(
            {
                "ok": True,
                "out": args.out,
                "model": args.model,
                "device": device if not cached else "cache",
                "meshCached": cached,
                "mcResolution": args.mc_resolution,
                "gridSizeMetres": args.grid_size,
                "vertices": int(len(vertices)),
                "triangles": int(len(faces)),
                "glbBytes": export_stats["bytes"],
                "loadSeconds": round(load_seconds, 2),
                "inferSeconds": round(infer_seconds, 2),
                "totalSeconds": round(time.time() - started, 2),
                "versions": state["versions"],
            }
        )
    )


if __name__ == "__main__":
    main()
