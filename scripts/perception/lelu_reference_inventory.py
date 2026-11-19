"""
LÉLU — authoritative reference inventory (PCI-FR 2.0, WP01/WP08 step 1)

Enumerates every committed reference photograph, hashes it, measures it, runs
the same detector the reconstruction uses, groups byte-identical duplicates and
writes a machine-readable inventory plus per-collection contact sheets that are
for human review only (they are not technical evidence).

  python scripts/perception/lelu_reference_inventory.py --out artifacts/pci-fr-2.0
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_perception as P  # noqa: E402
import lelu_replicate as Rp  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF_ROOT = os.path.join(ROOT, "leluverse/assets/characters/lelu_character/references")

COLLECTIONS = {
    "anatomy": os.path.join(REF_ROOT, "lelu-anatomy"),
    "expressions": os.path.join(REF_ROOT, "lelu-facial-expressions"),
    "hair": os.path.join(REF_ROOT, "lelu-hair"),
}


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def contact_sheet(paths: list[str], out: str, cols: int = 6, cell: int = 260) -> None:
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * cell), (24, 24, 26))
    for i, p in enumerate(paths):
        im = Image.open(p).convert("RGB")
        im.thumbnail((cell - 6, cell - 6), Image.LANCZOS)
        x = (i % cols) * cell + (cell - im.width) // 2
        y = (i // cols) * cell + (cell - im.height) // 2
        sheet.paste(im, (x, y))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "artifacts/pci-fr-2.0"))
    a = ap.parse_args()
    os.makedirs(os.path.join(a.out, "inventory"), exist_ok=True)

    mp, lm = P._landmarker()
    inventory: dict = {"schema": "lelu.reference.inventory/1", "root": os.path.relpath(REF_ROOT, ROOT), "collections": {}, "files": [], "duplicates": []}
    seen: dict[str, list[str]] = {}

    for name, d in COLLECTIONS.items():
        paths = sorted(os.path.join(d, f) for f in os.listdir(d) if f.lower().endswith(".png"))
        inventory["collections"][name] = {"directory": os.path.relpath(d, ROOT), "count": len(paths), "files": [os.path.basename(p) for p in paths]}
        for path in paths:
            rel = os.path.relpath(path, ROOT)
            pil = Image.open(path)
            rgb = np.asarray(pil.convert("RGB"))
            digest = sha256(path)
            seen.setdefault(digest, []).append(rel)
            gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
            pts = Rp.extract_face_landmarks(rgb, lm)
            entry = {
                "path": rel,
                "collection": name,
                "sha256": digest,
                "bytes": os.path.getsize(path),
                "width": int(pil.width),
                "height": int(pil.height),
                "mode": pil.mode,
                "mean_rgb": [int(round(v)) for v in rgb.reshape(-1, 3).mean(axis=0)],
                "sharpness": round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 1),
                "face": None,
            }
            if pts is not None:
                fw = float(np.linalg.norm(pts[234] - pts[454]))
                eye_mid = (pts[33] + pts[263]) / 2
                nose = pts[1]
                # Roll-and-scale-free yaw proxy: how far the nose sits from the
                # eye midpoint, in face widths.
                yaw = float((nose[0] - eye_mid[0]) / max(fw, 1e-6))
                entry["face"] = {
                    "detected": True,
                    "face_width_px": round(fw, 1),
                    "yaw_proxy": round(yaw, 3),
                    "framing": "frontal" if abs(yaw) <= 0.06 else ("three-quarter" if abs(yaw) <= 0.20 else "profile"),
                    "interocular_px": round(float(np.linalg.norm(pts[33] - pts[263])), 1),
                }
            else:
                entry["face"] = {"detected": False}
            inventory["files"].append(entry)
        contact_sheet(paths, os.path.join(a.out, "inventory", f"{name}_sheet.png"))

    inventory["duplicates"] = [{"sha256": k, "paths": v} for k, v in seen.items() if len(v) > 1]
    inventory["totals"] = {
        "files": len(inventory["files"]),
        "with_face": sum(1 for f in inventory["files"] if f["face"]["detected"]),
        "duplicate_groups": len(inventory["duplicates"]),
        "duplicate_extra_files": sum(len(g["paths"]) - 1 for g in inventory["duplicates"]),
    }
    path = os.path.join(a.out, "reference-inventory.json")
    json.dump(inventory, open(path, "w"), indent=1)
    lm.close()
    print(json.dumps(inventory["totals"]))
    for f in inventory["files"]:
        print(f"{os.path.basename(f['path']):32s} {f['width']:5d}x{f['height']:<5d} {str(f['face'].get('framing', '-')):14s} sharp={f['sharpness']:8.1f}")
    print("inventory:", path)


if __name__ == "__main__":
    main()
