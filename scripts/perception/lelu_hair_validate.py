"""
LÉLU — hair validation (PCI-FR 2.1, WP01-D / WP08)

Measures the reconstruction against her reference instead of asserting that it
looks right:

  length        strand length in mm, and below-chin length in face widths
  curl          autocorrelation spacing of the rendered hair, compared with the
                documented 13 mm loose-ringlet diameter
  silhouette    IoU of the rendered hair mask with her reference's hair mask
  hairline      RMS distance to her measured hairline, with the overlap guard
  colour        hue/saturation distribution against the reference hair
  baby hairs    re-detection on the render (geometry alone does not count)
  headpiece     chain presence and position error against the modelled path

  python scripts/perception/lelu_hair_validate.py --out artifacts/pci-fr-2.1
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_perception as P  # noqa: E402
import lelu_hair as H  # noqa: E402
import lelu_hair3d as H3  # noqa: E402
import lelu_replicate as Rp  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF10 = os.path.join(ROOT, "leluverse/assets/characters/lelu_character/references/ref10_face_primary.png")
BASE = os.path.join(ROOT, "artifacts/pci-fr-1.0/renders/improved_face.png")


def hair_colour_stats(rgb: np.ndarray, mask: np.ndarray) -> dict:
    pix = rgb[mask > 0].astype(np.float32) / 255.0
    if len(pix) < 100:
        return {}
    hsv = cv2.cvtColor((pix[None, :, :] * 255).astype(np.uint8), cv2.COLOR_RGB2HSV)[0].astype(np.float32)
    return {
        "mean_rgb": [round(float(v) * 255, 1) for v in pix.mean(axis=0)],
        "mean_hue": round(float(hsv[:, 0].mean()), 1),
        "mean_sat": round(float(hsv[:, 1].mean() / 255), 3),
        "mean_val": round(float(hsv[:, 2].mean() / 255), 3),
        "sat_p90": round(float(np.percentile(hsv[:, 1], 90) / 255), 3),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "artifacts/pci-fr-2.1"))
    a = ap.parse_args()
    hair_dir = os.path.join(a.out, "hair")
    render_path = os.path.join(hair_dir, "shell_front.png")
    if not os.path.exists(render_path):
        raise SystemExit("run lelu_hair_shell.py first")

    rgb = np.asarray(Image.open(render_path).convert("RGB"))
    Hh, Ww = rgb.shape[:2]
    pts = Rp.extract_face_landmarks(rgb, None) if False else None

    lm_mod, lm = P._landmarker()
    base_pts = P.load_landmarks(BASE, lm)
    r_pts = P.load_landmarks(render_path, lm)
    ref_pts = P.load_landmarks(REF10, lm)

    bfw = float(np.linalg.norm(base_pts[234] - base_pts[454]))
    bcx = float((base_pts[234, 0] + base_pts[454, 0]) / 2)
    bcy = float((base_pts[10, 1] + base_pts[152, 1]) / 2)
    px_per_mm = bfw / H.HEAD_WIDTH_MM

    # --- hair mask of the render: everything dark and not skin -------------
    skin = P.skin_mask(rgb)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    hair_mask = ((gray < 110) & (skin == 0)).astype(np.uint8)
    hair_mask = cv2.morphologyEx(hair_mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    hair_mask = cv2.morphologyEx(hair_mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))

    ys, xs = np.nonzero(hair_mask)
    chin_y = float(base_pts[152, 1])
    length_below_chin_fw = (ys.max() - chin_y) / bfw if len(ys) else None
    length_below_chin_mm = length_below_chin_fw * H.HEAD_WIDTH_MM if length_below_chin_fw else None

    # --- curl spacing of the render --------------------------------------
    curl = H.curl_scale(rgb, hair_mask)
    curl_mm = curl["spacing_px"] / px_per_mm if curl.get("spacing_px") else None

    # --- silhouette against her reference --------------------------------
    ref_rgb = np.asarray(Image.open(REF10).convert("RGB"))
    ref_hair = P.hair_mask(ref_rgb, ref_pts)
    # Compare in face-relative coordinates: crop both to the same box around
    # the face and rescale the reference to the render's face size.
    def crop_face(img, pts_):
        fw = float(np.linalg.norm(pts_[234] - pts_[454]))
        cx = float((pts_[234, 0] + pts_[454, 0]) / 2)
        cy = float((pts_[10, 1] + pts_[152, 1]) / 2)
        x0, x1 = int(cx - 1.35 * fw), int(cx + 1.35 * fw)
        y0, y1 = int(cy - 1.1 * fw), int(cy + 2.2 * fw)
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(img.shape[1], x1), min(img.shape[0], y1)
        return img[y0:y1, x0:x1]
    ref_c = crop_face(ref_hair * 255, ref_pts)
    ren_c = crop_face(hair_mask * 255, r_pts)
    h = min(ref_c.shape[0], ren_c.shape[0])
    w = min(ref_c.shape[1], ren_c.shape[1])
    if h > 40 and w > 40:
        ref_r = cv2.resize(ref_c, (300, 360), interpolation=cv2.INTER_NEAREST) > 127
        ren_r = cv2.resize(ren_c, (300, 360), interpolation=cv2.INTER_NEAREST) > 127
        inter = np.logical_and(ref_r, ren_r).sum()
        union = np.logical_or(ref_r, ren_r).sum()
        iou = float(inter / max(union, 1))
        recall = float(inter / max(ref_r.sum(), 1))
        precision = float(inter / max(ren_r.sum(), 1))
    else:
        iou = recall = precision = None

    # --- hairline ---------------------------------------------------------
    ref_skin = P.skin_mask(ref_rgb)
    ref_line = P.hairline_path(ref_skin, ref_hair, ref_pts)
    ren_line = Rp.hairline_of(rgb, r_pts) if r_pts is not None else []
    # Both curves are in their own image's pixels; normalise to face widths
    # around the face centre before comparing.
    def normalise(line, pts_):
        fw = float(np.linalg.norm(pts_[234] - pts_[454]))
        cx = float((pts_[234, 0] + pts_[454, 0]) / 2)
        cy = float((pts_[10, 1] + pts_[152, 1]) / 2)
        return [[(x - cx) / fw, (y - cy) / fw] for x, y in line]
    hl_rms, hl_overlap = (None, 0.0)
    if ref_line and ren_line:
        hl_rms, hl_overlap = Rp.hairline_error(normalise(ren_line, r_pts), normalise(ref_line, ref_pts))

    # --- colour -----------------------------------------------------------
    ren_col = hair_colour_stats(rgb, hair_mask)
    ref_col = hair_colour_stats(ref_rgb, ref_hair)

    # --- baby hairs re-detected on the render -----------------------------
    baby = H.forehead_filaments(rgb, r_pts, ren_line) if r_pts is not None and ren_line else []

    # --- headpiece presence ----------------------------------------------
    chain = H3.gold_chain()
    expected = []
    for key in ("centre", "temple_left", "temple_right"):
        px, _ = H3.project(chain[key], 0, bfw, (bcx, bcy))
        expected.append(px)
    gold = ((rgb[:, :, 0] > 150) & (rgb[:, :, 1] > 100) & (rgb[:, :, 2] < 130) &
            (rgb[:, :, 0].astype(int) - rgb[:, :, 2] > 50)).astype(np.uint8)
    gold_frac = float(gold.sum()) / max(1, len(xs))
    # how close the gold pixels sit to the modelled path
    if gold.sum() > 50:
        gy, gx = np.nonzero(gold)
        gp = np.c_[gx, gy].astype(np.float32)
        dists = []
        for px in expected:
            d = np.sqrt(((gp[:, None, :] - px[None, ::-1][:, ::-1][None, :, :]) ** 2).sum(axis=2))
            dists.append(float(d.min()))
        chain_err = float(np.mean(dists))
    else:
        chain_err = None

    metrics = {
        "schema": "lelu.hair.metrics/1",
        "render": os.path.relpath(render_path, ROOT),
        "px_per_mm": round(px_per_mm, 3),
        "length": {
            "below_chin_fw": round(length_below_chin_fw, 2) if length_below_chin_fw else None,
            "below_chin_mm": round(length_below_chin_mm, 1) if length_below_chin_mm else None,
            "target_waist_fw": H3.WAIST_BELOW_CHIN_FW,
            "target_waist_mm": round(H3.WAIST_BELOW_CHIN_FW * H.HEAD_WIDTH_MM, 1),
            "hair_top_mm_above_face_top": round((float(base_pts[10, 1]) - ys.min()) / px_per_mm, 1) if len(ys) else None,
        },
        "curl": {
            "spacing_px": curl.get("spacing_px"),
            "spacing_mm": round(curl_mm, 1) if curl_mm else None,
            "spec_loose_diameter_mm": H.SPEC["ringlet_loose"]["curl_diameter_mm"],
            "spec_pitch_mm": H.SPEC["ringlet_loose"]["curl_pitch_mm"],
            "confidence": curl.get("confidence"),
        },
        "silhouette": {"iou": round(iou, 3) if iou is not None else None,
                       "recall": round(recall, 3) if recall is not None else None,
                       "precision": round(precision, 3) if precision is not None else None},
        "hairline": {"rms_fw": round(hl_rms, 4) if hl_rms is not None else None, "overlap": hl_overlap,
                     "measurable": hl_rms is not None},
        "colour": {"render": ren_col, "reference": ref_col},
        "baby_hairs": {"detected_on_render": len(baby),
                       "spirals_expected": len(H.SPEC["baby_swirls"]),
                       "spiral_count": sum(1 for b in baby if b["is_spiral"]),
                       "roots": [b["root"] for b in baby[:8]]},
        "headpiece": {"gold_pixel_fraction": round(gold_frac, 5), "mean_chain_error_px": round(chain_err, 1) if chain_err else None,
                      "chain_error_mm": round(chain_err / px_per_mm, 1) if chain_err else None},
    }
    lm.close()
    json.dump(metrics, open(os.path.join(hair_dir, "hair-metrics.json"), "w"), indent=1)
    print(json.dumps(metrics, indent=1))


if __name__ == "__main__":
    main()
