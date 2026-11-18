"""
LÉLU — hairline and baby-hair placement evidence (PCI-FR 1.0, WP06/WP08)

Draws three hairlines over her own reference, in the reference's frame:

  red    the measured reference hairline
  amber  the hairline measured on the current LÉLU render (v004), aligned
         through the landmark similarity
  green  the hairline measured on the PCI-FR reconstruction

and marks the baby-hair roots that were detected (yellow) and placed (cyan).

  python scripts/perception/lelu_hairline_figure.py --out artifacts/pci-fr-1.0
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_perception as P  # noqa: E402
import lelu_replicate as Rp  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF = "leluverse/assets/characters/lelu_character/references/ref10_face_primary.png"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "artifacts/pci-fr-1.0"))
    ap.add_argument("--reference", default=os.path.join(ROOT, REF))
    a = ap.parse_args()

    feats = P.extract(a.reference, None)
    rgb, pts = feats["_rgb"], feats["_landmarks"]
    H, W = rgb.shape[:2]
    fw = float(np.linalg.norm(pts[234] - pts[454]))
    frame = {"cx": float((pts[234, 0] + pts[454, 0]) / 2), "cy": float((pts[10, 1] + pts[152, 1]) / 2), "fw": fw, "fh": float(np.linalg.norm(pts[10] - pts[152]))}

    mp, lm = P._landmarker()
    baseline_path = os.path.join(ROOT, "leluverse/assets/characters/lelu_character/rig/v004_headswap_mvvnvqa1/preview_face_front.png")
    improved_path = os.path.join(a.out, "renders/improved_face.png")

    base_rgb = np.asarray(Image.open(baseline_path).convert("RGB"))
    base_pts = Rp.extract_face_landmarks(base_rgb, lm)
    sim_base = Rp.umeyama(base_pts[P.ALIGN], pts[P.ALIGN]) if base_pts is not None else None
    base_line = Rp.hairline_of(base_rgb, base_pts) if base_pts is not None else []
    base_line_ref = [Rp.transform(np.array([p], dtype=np.float64), sim_base)[0] for p in base_line] if base_line else []

    imp_rgb = np.asarray(Image.open(improved_path).convert("RGB"))
    imp_pts = Rp.extract_face_landmarks(imp_rgb, lm)
    sim_imp = Rp.umeyama(imp_pts[P.ALIGN], pts[P.ALIGN]) if imp_pts is not None else None
    imp_line = Rp.hairline_of(imp_rgb, imp_pts) if imp_pts is not None else []
    imp_line_ref = [Rp.transform(np.array([p], dtype=np.float64), sim_imp)[0] for p in imp_line] if imp_line else []

    ref_line = feats["features"]["hairline"]["points"]
    strands = feats["features"]["baby_hairs"]["strands"]
    lm.close()

    # Crop to the head and shoulders so the hairlines are legible.
    x0, y0 = int(frame["cx"] - fw * 1.15), int(frame["cy"] - fw * 0.95)
    x1, y1 = int(frame["cx"] + fw * 1.15), int(frame["cy"] + fw * 0.75)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(W, x1), min(H, y1)
    crop = Image.fromarray(rgb[y0:y1, x0:x1].copy())
    scale = 2
    crop = crop.resize((crop.width * scale, crop.height * scale), Image.LANCZOS)
    d = ImageDraw.Draw(crop)

    def draw(line, colour, width=3):
        pts_ = [((p[0] - x0) * scale, (p[1] - y0) * scale) for p in line]
        if len(pts_) > 2:
            d.line(pts_, fill=colour, width=width, joint="curve")
        return pts_

    draw(ref_line, (255, 70, 70), 3)
    draw(base_line_ref, (255, 170, 40), 3)
    draw(imp_line_ref, (70, 255, 130), 3)
    for s in strands:
        rx, ry = (s["root"][0] - x0) * scale, (s["root"][1] - y0) * scale
        tx, ty = (s["tip"][0] - x0) * scale, (s["tip"][1] - y0) * scale
        d.line([(rx, ry), (tx, ty)], fill=(255, 240, 0), width=2)
        d.ellipse([rx - 3, ry - 3, rx + 3, ry + 3], outline=(0, 220, 255), width=2)

    legend = [
        ("reference hairline", (255, 70, 70)),
        ("current v004 hairline", (255, 170, 40)),
        ("reconstructed hairline", (70, 255, 130)),
        ("measured baby hairs", (255, 240, 0)),
    ]
    for i, (label, colour) in enumerate(legend):
        y = 14 + i * 26
        d.rectangle([14, y + 5, 44, y + 13], fill=colour)
        d.text((52, y), label, fill=(245, 245, 245))

    metrics = json.load(open(os.path.join(a.out, "metrics.json"))) if os.path.exists(os.path.join(a.out, "metrics.json")) else {}
    hair = metrics.get("hair", {})
    d.text((52, 14 + len(legend) * 26 + 8), f"hairline RMS: {hair.get('hairline_rms_fw_before')} fw → {hair.get('hairline_rms_fw_after')} fw", fill=(235, 235, 235))

    path = os.path.join(a.out, "overlays", "hairline_comparison.png")
    crop.save(path)
    print(json.dumps({"out": path, "reference_points": len(ref_line), "baseline_points": len(base_line_ref), "reconstructed_points": len(imp_line_ref), "baby_hairs": len(strands)}))


if __name__ == "__main__":
    main()
